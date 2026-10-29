import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Command, CommandHandler, Query, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { DocumentPrinter, type PrintedDocument } from '../../../shared/application/contracts/document-printer.js';
import { PatientDirectory } from '../../../shared/application/contracts/patient-directory.js';
import { PatientDocumentRegistry } from '../../../shared/application/patient-documents.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { NotificationQueue } from '../../../shared/application/ports/notification-queue.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { AuthenticationError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  channelFor,
  LOCKOUT_FAILURES,
  LOCKOUT_MINUTES,
  mask,
  normalizeEmail,
  normalizeMobile,
  OTP_ATTEMPTS,
  OTP_MINUTES,
  OTP_PER_HOUR,
  OTP_RESEND_SECONDS,
  SESSION_MINUTES,
} from '../domain/otp.js';
import { OtpHasher, PortalRepository, PortalTokens, SmsSender, type PortalClaims } from './portal.ports.js';

const MINUTE = 60_000;

export interface OtpSent {
  readonly challengeId: string;
  readonly sentTo: string;
  readonly expiresAt: Date;
}

export class RequestOtpCommand extends Command<OtpSent> {
  constructor(
    readonly uhid: number,
    readonly contact: string,
  ) {
    super();
  }
}

export class StartSessionCommand extends Command<{
  accessToken: string;
  expiresAt: Date;
  patient: { name: string; uhid: number };
}> {
  constructor(
    readonly challengeId: string,
    readonly code: string,
  ) {
    super();
  }
}

export class EndSessionCommand extends Command<void> {
  constructor(readonly patient: PortalClaims) {
    super();
  }
}

export class PortalProfileQuery extends Query<{
  name: string;
  uhid: number;
  sex: string;
  dateOfBirth: string;
  bloodGroup: string | null;
}> {
  constructor(readonly patient: PortalClaims) {
    super();
  }
}

export interface PortalDocumentView {
  readonly ref: string;
  readonly kind: string;
  readonly title: string;
  readonly number: string;
  readonly on: string;
  readonly available: boolean;
  readonly heldReason: string | null;
}

export class PortalDocumentsQuery extends Query<PortalDocumentView[]> {
  constructor(readonly patient: PortalClaims) {
    super();
  }
}

export class PrintDocumentQuery extends Query<PrintedDocument> {
  constructor(
    readonly patient: PortalClaims,
    readonly ref: string,
  ) {
    super();
  }
}

@Injectable()
export class PortalDesk {
  constructor(
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly portal: PortalRepository,
    readonly tokens: PortalTokens,
    readonly hasher: OtpHasher,
    readonly sms: SmsSender,
    readonly notifications: NotificationQueue,
    readonly patients: PatientDirectory,
    readonly documents: PatientDocumentRegistry,
    readonly printer: DocumentPrinter,
  ) {}
}

/**
 * Old AnonymousUser sign-in: a code to the patient's mobile (or their contact's) or email, for the UHID given. The
 * answer is the same whether or not the details match, a code was just sent, or the patient is locked out, so the
 * endpoint tells a stranger nothing.
 */
@CommandHandler(RequestOtpCommand)
export class RequestOtpHandler implements ICommandHandler<RequestOtpCommand> {
  constructor(private readonly desk: PortalDesk) {}

  async execute({ uhid, contact }: RequestOtpCommand): Promise<OtpSent> {
    const { desk } = this;
    const now = desk.clock.now();
    const expiresAt = new Date(now.getTime() + OTP_MINUTES * MINUTE);
    const decoy: OtpSent = {
      challengeId: randomUUID(),
      sentTo: mask(normalizeMobile(contact) ?? normalizeEmail(contact) ?? contact.trim()),
      expiresAt,
    };
    const patient = await desk.patients.contactsByUhid(uhid);
    const target = patient?.isActive ? channelFor(contact, patient) : null;
    if (!patient || !target) return decoy;
    const code = desk.hasher.newCode();
    const sent = await desk.tx.run(async () => {
      await desk.tx.lock(`portal:otp:${patient.id}`);
      const recent = await desk.portal.recentChallenges(patient.id, new Date(now.getTime() - 60 * MINUTE));
      const failures = recent
        .filter((entry) => entry.createdAt.getTime() >= now.getTime() - LOCKOUT_MINUTES * MINUTE)
        .reduce((sum, entry) => sum + entry.attempts, 0);
      const tooSoon = recent[0] && now.getTime() - recent[0].createdAt.getTime() < OTP_RESEND_SECONDS * 1000;
      if (failures >= LOCKOUT_FAILURES || recent.length >= OTP_PER_HOUR || tooSoon) return null;
      const id = randomUUID();
      await desk.portal.insertChallenge({
        id,
        patientId: patient.id,
        channel: target.channel,
        sentTo: mask(target.to),
        codeHash: desk.hasher.hash(id, code),
        expiresAt,
        attempts: 0,
        consumedAt: null,
        createdAt: now,
      });
      if (target.channel === 'email') {
        await desk.notifications.enqueueEmail({
          to: target.to,
          content: { template: 'portal-otp', code, minutes: OTP_MINUTES, patientName: patient.name },
        });
      }
      await desk.audit.record({
        action: 'portal.otp_sent',
        actorUserId: null,
        resourceType: 'patient',
        resourceId: patient.id,
        metadata: { channel: target.channel },
      });
      return { challengeId: id, sentTo: mask(target.to), expiresAt };
    });
    if (!sent) return decoy;
    if (target.channel === 'sms') {
      await desk.sms.send(
        target.to,
        `Your code to see your reports is ${code}. It works once, for ${OTP_MINUTES} minutes.`,
      );
    }
    return sent;
  }
}

/** The code checked (5 wrong codes kill the challenge); a 30-minute patient token, with no refresh. */
@CommandHandler(StartSessionCommand)
export class StartSessionHandler implements ICommandHandler<StartSessionCommand> {
  constructor(private readonly desk: PortalDesk) {}

  async execute({ challengeId, code }: StartSessionCommand) {
    const { desk } = this;
    const now = desk.clock.now();
    const outcome = await desk.tx.run(async () => {
      const challenge = await desk.portal.challengeForUpdate(challengeId);
      if (
        !challenge ||
        challenge.consumedAt ||
        challenge.expiresAt.getTime() <= now.getTime() ||
        challenge.attempts >= OTP_ATTEMPTS
      ) {
        return null;
      }
      if (!desk.hasher.matches(challenge.id, code, challenge.codeHash)) {
        await desk.portal.countFailure(challenge.id);
        await desk.audit.record({
          action: 'portal.otp_failed',
          actorUserId: null,
          resourceType: 'patient',
          resourceId: challenge.patientId,
          outcome: 'failure',
        });
        return null;
      }
      await desk.portal.consume(challenge.id, now);
      const session = {
        id: randomUUID(),
        patientId: challenge.patientId,
        challengeId: challenge.id,
        expiresAt: new Date(now.getTime() + SESSION_MINUTES * MINUTE),
      };
      await desk.portal.insertSession(session);
      await desk.audit.record({
        action: 'portal.signed_in',
        actorUserId: null,
        resourceType: 'patient',
        resourceId: challenge.patientId,
        metadata: { channel: challenge.channel },
      });
      return session;
    });
    if (!outcome) throw new AuthenticationError('invalid_code', 'The code is wrong or has expired');
    const patient = (await desk.patients.find([outcome.patientId])).get(outcome.patientId);
    if (!patient) throw new AuthenticationError('invalid_code', 'The code is wrong or has expired');
    const accessToken = await desk.tokens.issue(
      { patientId: outcome.patientId, sessionId: outcome.id },
      outcome.expiresAt,
    );
    return { accessToken, expiresAt: outcome.expiresAt, patient: { name: patient.name, uhid: patient.uhid } };
  }
}

@CommandHandler(EndSessionCommand)
export class EndSessionHandler implements ICommandHandler<EndSessionCommand> {
  constructor(private readonly desk: PortalDesk) {}

  async execute({ patient }: EndSessionCommand): Promise<void> {
    await this.desk.portal.revokeSession(patient.sessionId, this.desk.clock.now());
  }
}

@QueryHandler(PortalProfileQuery)
export class PortalProfileHandler implements IQueryHandler<PortalProfileQuery> {
  constructor(private readonly desk: PortalDesk) {}

  async execute({ patient }: PortalProfileQuery) {
    const found = (await this.desk.patients.find([patient.patientId])).get(patient.patientId);
    if (!found) throw new NotFoundError('patient');
    return {
      name: found.name,
      uhid: found.uhid,
      sex: found.sex,
      dateOfBirth: found.dateOfBirth,
      bloodGroup: found.bloodGroup,
    };
  }
}

/** The patient's own documents of every module, newest first; those held say why. */
@QueryHandler(PortalDocumentsQuery)
export class PortalDocumentsHandler implements IQueryHandler<PortalDocumentsQuery> {
  constructor(private readonly desk: PortalDesk) {}

  async execute({ patient }: PortalDocumentsQuery) {
    return (await this.desk.documents.list(patient.patientId)).map((document) => ({
      ref: document.ref,
      kind: document.kind,
      title: document.title,
      number: document.number,
      on: document.on,
      available: document.heldReason === null,
      heldReason: document.heldReason,
    }));
  }
}

/** A document printed only when it is among the patient's own and not held. */
@QueryHandler(PrintDocumentQuery)
export class PrintDocumentHandler implements IQueryHandler<PrintDocumentQuery> {
  constructor(private readonly desk: PortalDesk) {}

  async execute({ patient, ref }: PrintDocumentQuery) {
    const { desk } = this;
    const document = (await desk.documents.list(patient.patientId)).find((entry) => entry.ref === ref);
    if (!document) throw new NotFoundError('document');
    if (document.heldReason) throw new ForbiddenError('document_held', document.heldReason);
    const printed = await desk.printer.printPdf(document.reportKey, document.params, 'Patient portal');
    await desk.audit.record({
      action: 'portal.document_printed',
      actorUserId: null,
      resourceType: 'patient',
      resourceId: patient.patientId,
      metadata: { ref },
    });
    return printed;
  }
}

export const PORTAL_HANDLERS = [
  PortalDesk,
  RequestOtpHandler,
  StartSessionHandler,
  EndSessionHandler,
  PortalProfileHandler,
  PortalDocumentsHandler,
  PrintDocumentHandler,
];
