import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import {
  InpatientRegister,
  type ChargeableAdmission,
} from '../../../shared/application/contracts/inpatient-register.js';
import { OutpatientClinic } from '../../../shared/application/contracts/outpatient-clinic.js';
import { PatientDirectory } from '../../../shared/application/contracts/patient-directory.js';
import { UserDirectory } from '../../../shared/application/contracts/user-directory.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { assertDuringStay, checkedBirth, checkedDeath, ClinicalNote, DOCTOR_NOTES, voidReason } from '../domain/emr.js';
import { ClinicalRepository, EmrRepository } from '../domain/repositories.js';
import {
  AcknowledgeHandoverCommand,
  CorrectNoteCommand,
  EMR_CERTIFY,
  EMR_READ,
  EMR_WRITE,
  EmrReadRepository,
  GetRecordsQuery,
  ListNotesQuery,
  PendingHandoversQuery,
  RecordBirthCommand,
  RecordDeathCommand,
  VoidRecordCommand,
  WriteNoteCommand,
  type NoteRow,
} from './emr.messages.js';
import { CLINICAL_SETTINGS, type ClinicalSettings } from './rx.messages.js';

@Injectable()
export class EmrDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly emr: EmrRepository,
    readonly read: EmrReadRepository,
    readonly sequences: ClinicalRepository,
    readonly inpatients: InpatientRegister,
    readonly patients: PatientDirectory,
    readonly clinic: OutpatientClinic,
    readonly users: UserDirectory,
    @Inject(CLINICAL_SETTINGS) readonly settings: ClinicalSettings,
  ) {}

  /** The day of a moment in the organisation's time zone. */
  dayOf = (at: Date): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: this.settings.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);

  async number(kind: 'DTH' | 'BRT'): Promise<string> {
    const year = Number(this.dayOf(this.clock.now()).slice(0, 4));
    return `${kind}-${year}-${String(await this.sequences.nextSerial(kind, year)).padStart(5, '0')}`;
  }

  /** An admission still in (notes and certificates are written during the stay). */
  async admitted(admissionId: string): Promise<ChargeableAdmission> {
    const [admission] = await this.inpatients.find([admissionId]);
    if (!admission) throw new NotFoundError('admission');
    if (admission.status !== 'admitted') {
      throw new DomainError('admission_state', `Admission ${admission.number} is ${admission.status}`);
    }
    return admission;
  }

  async activeDoctor(id: string): Promise<void> {
    const doctor = (await this.clinic.doctors([id])).get(id);
    if (!doctor) throw new NotFoundError('doctor');
    if (!doctor.isActive) throw new DomainError('doctor_inactive', `${doctor.name} is not active`);
  }

  /** Notes with the names of their doctors, writers and the nurses taking over. */
  async named(rows: readonly NoteRow[]) {
    const doctors = await this.clinic.doctors(rows.flatMap((row) => (row.doctorId ? [row.doctorId] : [])));
    const userIds = [...new Set(rows.flatMap((row) => [row.writtenBy, ...(row.handedTo ? [row.handedTo] : [])]))];
    const users = new Map((userIds.length ? await this.users.findSummaries(userIds) : []).map((u) => [u.id, u]));
    return rows.map((row) => ({
      ...row,
      doctorName: row.doctorId ? (doctors.get(row.doctorId)?.name ?? null) : null,
      handedToName: row.handedTo ? (users.get(row.handedTo)?.displayName ?? null) : null,
      writerName: users.get(row.writtenBy)?.displayName ?? '',
    }));
  }

  record(type: string, action: string, actor: Actor, id: string, metadata: Record<string, string | null> = {}) {
    return this.audit.record({
      action: `clinical.${type}_${action}`,
      actorUserId: actor.userId,
      resourceType: type,
      resourceId: id,
      metadata,
    });
  }
}

/** Old EMR notes on an admitted patient: rounds, consultations, procedures, transfers, ICU course, handovers. */
@CommandHandler(WriteNoteCommand)
export class WriteNoteHandler implements ICommandHandler<WriteNoteCommand> {
  constructor(private readonly desk: EmrDesk) {}

  async execute({ actor, admissionId, input }: WriteNoteCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [EMR_WRITE] });
    const admission = await desk.admitted(admissionId);
    let doctorId = input.doctorId;
    if (!doctorId && DOCTOR_NOTES.includes(input.kind)) {
      doctorId = (await desk.clinic.doctorOfUser(actor.userId))?.id ?? null;
    }
    if (doctorId) await desk.activeDoctor(doctorId);
    if (input.handedTo) {
      const [taker] = await desk.users.findSummaries([input.handedTo]);
      if (!taker?.isActive) throw new NotFoundError('user');
    }
    const now = desk.clock.now();
    const notedAt = input.notedAt ?? now;
    assertDuringStay(notedAt, now, desk.dayOf, admission.admittedOn, 'time noted');
    const note = ClinicalNote.write({
      id: randomUUID(),
      admissionId,
      patientId: admission.patientId,
      kind: input.kind,
      doctorId,
      notedAt,
      note: input.note,
      handedTo: input.handedTo,
      by: actor.userId,
      at: now,
    });
    await desk.emr.insertNote(note);
    return { id: note.id };
  }
}

@CommandHandler(CorrectNoteCommand)
export class CorrectNoteHandler implements ICommandHandler<CorrectNoteCommand> {
  constructor(private readonly desk: EmrDesk) {}

  async execute({ actor, id, version, note: text }: CorrectNoteCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [EMR_WRITE] });
    return desk.tx.run(async () => {
      const note = await desk.emr.noteForUpdate(id);
      if (!note) throw new NotFoundError('note');
      note.assertVersion(version);
      note.correct(text, actor.userId, desk.clock.now());
      await desk.emr.updateNote(note);
      await desk.record('note', 'corrected', actor, id);
      return { version: note.toSnapshot().version };
    });
  }
}

/** Old NurseToNursePatientHandOverRecord.IsReceipantAcknowledged. */
@CommandHandler(AcknowledgeHandoverCommand)
export class AcknowledgeHandoverHandler implements ICommandHandler<AcknowledgeHandoverCommand> {
  constructor(private readonly desk: EmrDesk) {}

  async execute({ actor, id }: AcknowledgeHandoverCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [EMR_WRITE] });
    await desk.tx.run(async () => {
      const note = await desk.emr.noteForUpdate(id);
      if (!note) throw new NotFoundError('note');
      note.acknowledge(actor.userId, desk.clock.now());
      await desk.emr.updateNote(note);
    });
  }
}

/** Old DeathRecord: one per admission, certified by a doctor, during the stay. The stay is billed and closed as usual. */
@CommandHandler(RecordDeathCommand)
export class RecordDeathHandler implements ICommandHandler<RecordDeathCommand> {
  constructor(private readonly desk: EmrDesk) {}

  async execute({ actor, admissionId, doctorId, details }: RecordDeathCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [EMR_CERTIFY] });
    const admission = await desk.admitted(admissionId);
    await desk.activeDoctor(doctorId);
    const checked = checkedDeath(details);
    const now = desk.clock.now();
    assertDuringStay(checked.diedAt, now, desk.dayOf, admission.admittedOn, 'time of death');
    return desk.tx.run(async () => {
      await desk.tx.lock(`clinical:death:${admissionId}`);
      const existing = await desk.emr.liveDeath(admissionId);
      if (existing) throw new ConflictError('death_recorded', `Death record ${existing.number} is in force`);
      const id = randomUUID();
      const number = await desk.number('DTH');
      await desk.emr.insertDeath({
        ...checked,
        id,
        number,
        admissionId,
        patientId: admission.patientId,
        doctorId,
        recordedBy: actor.userId,
        voidedAt: null,
        voidReason: null,
        version: 1,
        createdAt: now,
      });
      await desk.record('death_record', 'recorded', actor, id, { number, admission: admission.number });
      return { id, number };
    });
  }
}

/** Old BirthCertificate: a child born to a mother admitted here (twins: one record each). */
@CommandHandler(RecordBirthCommand)
export class RecordBirthHandler implements ICommandHandler<RecordBirthCommand> {
  constructor(private readonly desk: EmrDesk) {}

  async execute({ actor, admissionId, doctorId, details }: RecordBirthCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [EMR_CERTIFY] });
    const admission = await desk.admitted(admissionId);
    const mother = (await desk.patients.find([admission.patientId])).get(admission.patientId);
    if (mother?.sex !== 'female') throw new DomainError('not_a_mother', 'The admitted patient is not a woman');
    await desk.activeDoctor(doctorId);
    const checked = checkedBirth(details);
    const now = desk.clock.now();
    assertDuringStay(checked.bornAt, now, desk.dayOf, admission.admittedOn, 'time of birth');
    return desk.tx.run(async () => {
      const id = randomUUID();
      const number = await desk.number('BRT');
      await desk.emr.insertBirth({
        ...checked,
        id,
        number,
        admissionId,
        motherId: admission.patientId,
        doctorId,
        recordedBy: actor.userId,
        voidedAt: null,
        voidReason: null,
        version: 1,
        createdAt: now,
      });
      await desk.record('birth_record', 'recorded', actor, id, { number, admission: admission.number });
      return { id, number };
    });
  }
}

/** A death or birth recorded in error, taken back with a reason (kept, marked void). */
@CommandHandler(VoidRecordCommand)
export class VoidRecordHandler implements ICommandHandler<VoidRecordCommand> {
  constructor(private readonly desk: EmrDesk) {}

  async execute({ actor, kind, id, version, reason }: VoidRecordCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [EMR_CERTIFY] });
    const why = voidReason(reason);
    await desk.tx.run(async () => {
      const record = kind === 'death' ? await desk.emr.deathForUpdate(id) : await desk.emr.birthForUpdate(id);
      if (!record) throw new NotFoundError(`${kind}_record`);
      if (record.version !== version) throw new ConflictError('stale_record', 'The record was changed; reload it');
      if (record.voidedAt) throw new DomainError('record_void', `${record.number} is void already`);
      await desk.emr.voidRecord(kind, id, why, desk.clock.now());
      await desk.record(`${kind}_record`, 'voided', actor, id, { number: record.number, reason: why });
    });
  }
}

@QueryHandler(ListNotesQuery)
export class ListNotesHandler implements IQueryHandler<ListNotesQuery> {
  constructor(private readonly desk: EmrDesk) {}

  async execute({ actor, admissionId, kind }: ListNotesQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [EMR_READ] });
    const [admission] = await desk.inpatients.find([admissionId]);
    if (!admission) throw new NotFoundError('admission');
    return desk.named(await desk.read.notes(admissionId, kind));
  }
}

@QueryHandler(PendingHandoversQuery)
export class PendingHandoversHandler implements IQueryHandler<PendingHandoversQuery> {
  constructor(private readonly desk: EmrDesk) {}

  async execute({ actor }: PendingHandoversQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [EMR_READ] });
    const notes = await desk.named(await desk.read.pendingHandovers(actor.userId));
    const admissions = new Map(
      (await desk.inpatients.find(notes.map((note) => note.admissionId))).map((entry) => [entry.id, entry]),
    );
    return notes.map((note) => ({
      ...note,
      admissionNumber: admissions.get(note.admissionId)?.number ?? '',
      patientName: admissions.get(note.admissionId)?.patientName ?? '',
    }));
  }
}

@QueryHandler(GetRecordsQuery)
export class GetRecordsHandler implements IQueryHandler<GetRecordsQuery> {
  constructor(private readonly desk: EmrDesk) {}

  async execute({ actor, admissionId }: GetRecordsQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [EMR_READ] });
    return this.desk.read.records(admissionId);
  }
}

export const EMR_HANDLERS = [
  EmrDesk,
  WriteNoteHandler,
  CorrectNoteHandler,
  AcknowledgeHandoverHandler,
  RecordDeathHandler,
  RecordBirthHandler,
  VoidRecordHandler,
  ListNotesHandler,
  PendingHandoversHandler,
  GetRecordsHandler,
];
