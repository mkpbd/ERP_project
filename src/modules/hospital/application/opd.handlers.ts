import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { LedgerPosting, type LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { feeFor } from '../domain/appointment.js';
import { OpdBill, suggestedVisit, validMoney } from '../domain/opd-bill.js';
import {
  AppointmentRepository,
  OpdBillRepository,
  type BillableDoctor,
  type OpdPolicy,
} from '../domain/repositories.js';
import { OPD_MANAGE, OPD_READ } from './hospital.constants.js';
import {
  CancelOpdBillCommand,
  CollectOpdDueCommand,
  CONSULTANT_PAYABLE_ROLE,
  CreateOpdBillCommand,
  DOCTOR_FEE_ROLE,
  GetOpdBillQuery,
  GetOpdPolicyQuery,
  ListOpdBillsQuery,
  OPD_BILL,
  OPD_DISCOUNT,
  OPD_DISCOUNT_ROLE,
  OPD_INCOME_ROLE,
  OPD_JOURNAL,
  OPD_RECEIPT_ROLES,
  OPD_RECEIVABLE_ROLE,
  OpdBillReadRepository,
  SetOpdPolicyCommand,
  SuggestVisitQuery,
} from './opd.messages.js';
import { HOSPITAL_SETTINGS, localToday, type HospitalSettings } from './patient.handlers.js';

const serialNumber = (kind: string, year: number, serial: number) =>
  `${kind}-${year}-${String(serial).padStart(5, '0')}`;

@Injectable()
export class OpdDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly posting: LedgerPosting,
    readonly bills: OpdBillRepository,
    readonly appointments: AppointmentRepository,
    readonly read: OpdBillReadRepository,
    @Inject(HOSPITAL_SETTINGS) readonly settings: HospitalSettings,
  ) {}

  today(): string {
    return localToday(this.clock.now(), this.settings.timeZone);
  }

  async number(kind: string, on: string): Promise<string> {
    const year = Number(on.slice(0, 4));
    return serialNumber(kind, year, await this.bills.nextSerial(kind, year));
  }

  record(action: string, actor: Actor, id: string, metadata: Record<string, string | number | null> = {}) {
    return this.audit.record({
      action: `hospital.opd_bill_${action}`,
      actorUserId: actor.userId,
      resourceType: 'opd_bill',
      resourceId: id,
      metadata,
    });
  }

  async bill(id: string, version: number): Promise<OpdBill> {
    const bill = await this.bills.findForUpdate(id);
    if (!bill) throw new NotFoundError('opd_bill');
    bill.assertVersion(version);
    return bill;
  }

  /** Consultants who see patients here, by id. */
  async consultants(ids: readonly string[]): Promise<Map<string, BillableDoctor>> {
    const doctors = await this.bills.doctors(ids);
    for (const id of ids) {
      const doctor = doctors.get(id);
      if (!doctor) throw new NotFoundError('doctor');
      if (!doctor.isActive || !doctor.isConsultant) {
        throw new DomainError('not_bookable', `${doctor.name} does not see patients here`);
      }
    }
    return doctors;
  }

  /** Posts the voucher; a bill of nothing (a free consultation) has none. */
  async post(narration: string, on: string, reference: string, lines: LedgerPostingLine[], actor: Actor) {
    const posted = lines.filter((line) => line.debit > 0 || line.credit > 0);
    if (posted.length === 0) return null;
    return this.posting.post({
      journal: OPD_JOURNAL,
      voucherDate: on,
      narration,
      source: { module: 'hospital', reference },
      lines: posted,
      postedBy: actor.userId,
    });
  }
}

@CommandHandler(SetOpdPolicyCommand)
export class SetOpdPolicyHandler implements ICommandHandler<SetOpdPolicyCommand> {
  constructor(private readonly desk: OpdDesk) {}

  async execute({ actor, policy }: SetOpdPolicyCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [OPD_MANAGE] });
    if (!Number.isInteger(policy.followUpDays) || policy.followUpDays < 0 || policy.followUpDays > 365) {
      throw new DomainError('invalid_policy', 'Follow-up days are 0 to 365');
    }
    for (const percent of [policy.defaultSharePercent, policy.counterDiscountPercent]) {
      if (!(percent >= 0 && percent <= 100)) throw new DomainError('invalid_policy', 'Percentages are 0 to 100');
    }
    await desk.tx.run(async () => {
      await desk.bills.savePolicy(policy, actor.userId, desk.clock.now());
      await desk.audit.record({
        action: 'hospital.opd_policy_set',
        actorUserId: actor.userId,
        resourceType: 'opd_policy',
        resourceId: '1',
        metadata: { ...policy },
      });
    });
  }
}

/**
 * Old Consultation Fee page, saved step by step without a transaction (a failed invoice number became 0, the doctor's
 * share went against the bill line id): one transaction that numbers the bill, bills the appointment it came from,
 * posts the voucher, credits each doctor's share to them and logs the UHID's use.
 */
@CommandHandler(CreateOpdBillCommand)
export class CreateOpdBillHandler implements ICommandHandler<CreateOpdBillCommand> {
  constructor(private readonly desk: OpdDesk) {}

  async execute({ actor, input }: CreateOpdBillCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [OPD_BILL] });
    validMoney(input.discount, 'discount');
    const mayDiscountMore =
      input.discount > 0 && (await desk.access.isAllowed(actor.userId, { permissions: [OPD_DISCOUNT] }));
    return desk.tx.run(async () => {
      const patient = await desk.appointments.patientContact(input.patientId);
      if (!patient) throw new NotFoundError('patient');
      const today = desk.today();
      const now = desk.clock.now();
      const doctorIds = input.lines.map((line) => line.doctorId);
      const doctors = await desk.consultants(doctorIds);
      if (input.referredById && (await desk.bills.doctors([input.referredById])).size === 0) {
        throw new NotFoundError('referring_doctor');
      }
      const appointment = input.appointmentId ? await desk.appointments.findForUpdate(input.appointmentId) : null;
      if (input.appointmentId && !appointment) throw new NotFoundError('appointment');
      if (appointment) {
        appointment.assertBillable();
        if (!doctorIds.includes(appointment.doctorId)) {
          throw new DomainError('appointment_mismatch', "The appointment's doctor is not on the bill");
        }
        if (appointment.patientId === null) appointment.attach(patient, now);
        else if (appointment.patientId !== patient.id) {
          throw new DomainError('appointment_mismatch', 'The appointment is for another patient');
        }
      }
      const policy = await desk.bills.policy();
      const lines = await Promise.all(
        input.lines.map(async (line) => {
          const doctor = doctors.get(line.doctorId)!;
          const visitType =
            line.visitType ??
            suggestedVisit(await desk.bills.lastVisitOn(patient.id, doctor.id), today, policy.followUpDays);
          return {
            doctorId: doctor.id,
            visitType,
            fee: feeFor(doctor, visitType),
            sharePercent: doctor.sharePercent ?? policy.defaultSharePercent,
          };
        }),
      );
      const bill = OpdBill.create({
        id: randomUUID(),
        number: await desk.number('OC', today),
        patientId: patient.id,
        appointmentId: appointment?.id ?? null,
        billedOn: today,
        referredById: input.referredById,
        lines,
        discount: input.discount,
        discountReason: input.discountReason,
        discountLimitPercent: policy.counterDiscountPercent,
        mayDiscountMore,
        payment: input.payment,
        by: actor.userId,
        now,
      });
      const header = bill.toSnapshot();
      const narration = `OPD consultation ${header.number}`;
      const voucher = await desk.post(
        narration,
        today,
        header.id,
        [
          ...(input.payment && header.paid > 0
            ? [{ account: { role: OPD_RECEIPT_ROLES[input.payment.method] }, debit: header.paid, credit: 0, narration }]
            : []),
          { account: { role: OPD_RECEIVABLE_ROLE }, debit: bill.due, credit: 0, narration },
          { account: { role: OPD_DISCOUNT_ROLE }, debit: header.discount, credit: 0, narration },
          { account: { role: OPD_INCOME_ROLE }, debit: 0, credit: header.gross, narration },
          { account: { role: DOCTOR_FEE_ROLE }, debit: bill.share, credit: 0, narration },
          { account: { role: CONSULTANT_PAYABLE_ROLE }, debit: 0, credit: bill.share, narration },
        ],
        actor,
      );
      bill.posted(voucher?.number ?? null);
      await desk.bills.insert(bill, actor.userId);
      if (appointment) {
        appointment.billed(bill.id, today, now);
        await desk.appointments.update(appointment);
      }
      await desk.bills.addLedger(
        bill.lines
          .filter((line) => line.shareAmount > 0)
          .map((line) => ({
            doctorId: line.doctorId,
            entryOn: today,
            kind: 'share' as const,
            billId: bill.id,
            documentNumber: header.number,
            amount: line.shareAmount,
          })),
      );
      await desk.bills.addUhidUse({
        patientId: patient.id,
        usedOn: today,
        service: 'opd_consultation',
        documentNumber: header.number,
      });
      await desk.record('created', actor, bill.id, {
        number: header.number,
        net: header.net,
        discount: header.discount,
        voucher: voucher?.number ?? null,
      });
      return { id: bill.id, number: header.number, net: header.net, due: bill.due };
    });
  }
}

/** Old /opd/bill-collection, Consultation tab: a due collected later, with its own receipt number and voucher. */
@CommandHandler(CollectOpdDueCommand)
export class CollectOpdDueHandler implements ICommandHandler<CollectOpdDueCommand> {
  constructor(private readonly desk: OpdDesk) {}

  async execute({ actor, id, version, amount, method, reference }: CollectOpdDueCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [OPD_BILL] });
    return desk.tx.run(async () => {
      const bill = await desk.bill(id, version);
      const today = desk.today();
      const number = await desk.number('OR', today);
      const payment = bill.collect({ number, method, reference, amount, on: today, now: desk.clock.now() });
      const narration = `Due collected on ${bill.number} (${number})`;
      const voucher = await desk.post(
        narration,
        today,
        bill.id,
        [
          { account: { role: OPD_RECEIPT_ROLES[method] }, debit: payment.amount, credit: 0, narration },
          { account: { role: OPD_RECEIVABLE_ROLE }, debit: 0, credit: payment.amount, narration },
        ],
        actor,
      );
      await desk.bills.update(bill, actor.userId, voucher?.number ?? null);
      await desk.record('collected', actor, id, { number, amount: payment.amount, method });
      return { number };
    });
  }
}

/** Old ConsultancyCancelService: the whole bill, its money back by how it came in, and the doctors' shares back. */
@CommandHandler(CancelOpdBillCommand)
export class CancelOpdBillHandler implements ICommandHandler<CancelOpdBillCommand> {
  constructor(private readonly desk: OpdDesk) {}

  async execute({ actor, id, version, reason }: CancelOpdBillCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [OPD_BILL] });
    const mayCancelLater = await desk.access.isAllowed(actor.userId, { permissions: [OPD_MANAGE] });
    return desk.tx.run(async () => {
      const bill = await desk.bill(id, version);
      const today = desk.today();
      const { refunds, dueCleared } = bill.cancel({
        reason,
        on: today,
        by: actor.userId,
        mayCancelLater,
        now: desk.clock.now(),
      });
      const header = bill.toSnapshot();
      const narration = `Cancelled OPD consultation ${header.number}`;
      const voucher = await desk.post(
        narration,
        today,
        bill.id,
        [
          ...[...refunds].map(([method, amount]) => ({
            account: { role: OPD_RECEIPT_ROLES[method] },
            debit: 0,
            credit: amount,
            narration,
          })),
          { account: { role: OPD_RECEIVABLE_ROLE }, debit: 0, credit: dueCleared, narration },
          { account: { role: OPD_DISCOUNT_ROLE }, debit: 0, credit: header.discount, narration },
          { account: { role: OPD_INCOME_ROLE }, debit: header.gross, credit: 0, narration },
          { account: { role: CONSULTANT_PAYABLE_ROLE }, debit: bill.share, credit: 0, narration },
          { account: { role: DOCTOR_FEE_ROLE }, debit: 0, credit: bill.share, narration },
        ],
        actor,
      );
      bill.cancelPosted(voucher?.number ?? null);
      await desk.bills.update(bill, actor.userId, voucher?.number ?? null);
      await desk.bills.addLedger(
        bill.lines
          .filter((line) => line.shareAmount > 0)
          .map((line) => ({
            doctorId: line.doctorId,
            entryOn: today,
            kind: 'reversal' as const,
            billId: bill.id,
            documentNumber: header.number,
            amount: -line.shareAmount,
          })),
      );
      await desk.record('cancelled', actor, id, {
        reason,
        refunded: header.refunded,
        voucher: voucher?.number ?? null,
      });
      return { refunded: header.refunded };
    });
  }
}

@QueryHandler(GetOpdPolicyQuery)
export class GetOpdPolicyHandler implements IQueryHandler<GetOpdPolicyQuery> {
  constructor(private readonly desk: OpdDesk) {}

  async execute({ actor }: GetOpdPolicyQuery): Promise<OpdPolicy> {
    await this.desk.access.authorize(actor.userId, { permissions: [OPD_READ] });
    return this.desk.bills.policy();
  }
}

@QueryHandler(SuggestVisitQuery)
export class SuggestVisitHandler implements IQueryHandler<SuggestVisitQuery> {
  constructor(private readonly desk: OpdDesk) {}

  async execute({ actor, patientId, doctorId }: SuggestVisitQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [OPD_READ] });
    const doctor = (await desk.bills.doctors([doctorId])).get(doctorId);
    if (!doctor) throw new NotFoundError('doctor');
    const [lastVisitOn, policy] = await Promise.all([desk.bills.lastVisitOn(patientId, doctorId), desk.bills.policy()]);
    const visitType = suggestedVisit(lastVisitOn, desk.today(), policy.followUpDays);
    return { visitType, lastVisitOn, fee: feeFor(doctor, visitType) };
  }
}

@QueryHandler(ListOpdBillsQuery)
export class ListOpdBillsHandler implements IQueryHandler<ListOpdBillsQuery> {
  constructor(private readonly desk: OpdDesk) {}

  async execute({ actor, filter }: ListOpdBillsQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [OPD_READ] });
    return this.desk.read.list(filter);
  }
}

@QueryHandler(GetOpdBillQuery)
export class GetOpdBillHandler implements IQueryHandler<GetOpdBillQuery> {
  constructor(private readonly desk: OpdDesk) {}

  async execute({ actor, id }: GetOpdBillQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [OPD_READ] });
    const bill = await this.desk.read.get(id);
    if (!bill) throw new NotFoundError('opd_bill');
    return bill;
  }
}

export const OPD_HANDLERS = [
  OpdDesk,
  SetOpdPolicyHandler,
  CreateOpdBillHandler,
  CollectOpdDueHandler,
  CancelOpdBillHandler,
  GetOpdPolicyHandler,
  SuggestVisitHandler,
  ListOpdBillsHandler,
  GetOpdBillHandler,
];
