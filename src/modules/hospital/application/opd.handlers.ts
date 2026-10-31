import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { CorporateAccounts } from '../../../shared/application/contracts/corporate-accounts.js';
import { LedgerPosting, type LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { feeFor } from '../domain/appointment.js';
import { StaffDirectory } from '../../../shared/application/contracts/staff-directory.js';
import type { DiagnosticBill } from '../domain/diagnostic-bill.js';
import type { IpdBill } from '../domain/ipd-bill.js';
import { OpdBill, suggestedVisit, validMoney, type BillPayer } from '../domain/opd-bill.js';
import { text } from '../domain/patient.js';
import {
  AppointmentRepository,
  DiagnosticBillRepository,
  IpdBillingRepository,
  OpdBillRepository,
  type BillableDoctor,
  type CorporateClient,
  type DoctorLedgerEntry,
  type OpdPolicy,
} from '../domain/repositories.js';
import { DOCTOR_PAY, OPD_MANAGE, OPD_READ } from './hospital.constants.js';
import {
  CancelOpdBillCommand,
  CollectCorporateDueCommand,
  CollectOpdDueCommand,
  CONSULTANT_PAYABLE_ROLE,
  GetDoctorLedgerQuery,
  PayDoctorCommand,
  CORPORATE_RECEIVABLE_ROLE,
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
  OPD_SERVICE_INCOME_ROLE,
  OpdBillReadRepository,
  SetOpdPolicyCommand,
  STAFF_RECEIVABLE_ROLE,
  SuggestVisitQuery,
} from './opd.messages.js';
import { HOSPITAL_SETTINGS, localToday, type HospitalSettings } from './patient.handlers.js';

const serialNumber = (kind: string, year: number, serial: number) =>
  `${kind}-${year}-${String(serial).padStart(5, '0')}`;

/** Where what is not paid at the counter is owed: the patient, a corporate client or a staff member. */
function receivableRole(bill: OpdBill): string {
  switch (bill.payer.kind) {
    case 'corporate':
      return CORPORATE_RECEIVABLE_ROLE;
    case 'staff':
      return STAFF_RECEIVABLE_ROLE;
    case 'patient':
      return OPD_RECEIVABLE_ROLE;
  }
}

/** Each doctor's share on the bill, earned (+) or taken back (−). */
function shareEntries(bill: OpdBill, kind: 'share' | 'reversal', on: string): DoctorLedgerEntry[] {
  return bill.lines
    .filter((line) => line.shareAmount > 0 && line.doctorId !== null)
    .map((line) => ({
      doctorId: line.doctorId!,
      entryOn: on,
      kind,
      billId: bill.id,
      documentNumber: bill.number,
      amount: kind === 'share' ? line.shareAmount : -line.shareAmount,
    }));
}

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
    readonly staff: StaffDirectory,
    /** What a company owes across the hospital and the pharmacy, for its credit limit. */
    readonly corporate: CorporateAccounts,
    @Inject(HOSPITAL_SETTINGS) readonly settings: HospitalSettings,
  ) {}

  /** Who owes the due: the patient, an active corporate client or an active staff member. */
  async payer(
    corporateClientId: string | null,
    staffId: string | null,
  ): Promise<{ payer: BillPayer } & ({ kind: 'corporate'; client: CorporateClient } | { kind: 'patient' | 'staff' })> {
    if (corporateClientId) {
      const client = await this.bills.corporateClient(corporateClientId);
      if (!client) throw new NotFoundError('corporate_client');
      if (!client.isActive) throw new DomainError('inactive_client', `${client.name} is not active`);
      return {
        kind: 'corporate',
        client,
        payer: { kind: 'corporate', clientId: client.id, cash: client.payment === 'cash' },
      };
    }
    if (staffId) {
      const [member] = await this.staff.findSummaries([staffId]);
      if (!member) throw new NotFoundError('staff');
      if (member.status !== 'active') {
        throw new DomainError('inactive_staff', `${member.fullName} (${member.employeeNo}) is not in service`);
      }
      return { kind: 'staff', payer: { kind: 'staff', staffId } };
    }
    return { kind: 'patient', payer: { kind: 'patient' } };
  }

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
    if (input.discount !== null) validMoney(input.discount, 'discount');
    if (input.corporateClientId && input.staffId) {
      throw new DomainError('invalid_payer', 'A bill goes to a corporate client or to a staff member, not both');
    }
    const mayDiscountMore = await desk.access.isAllowed(actor.userId, { permissions: [OPD_DISCOUNT] });
    return desk.tx.run(async () => {
      const patient = await desk.appointments.patientContact(input.patientId);
      if (!patient) throw new NotFoundError('patient');
      const today = desk.today();
      const now = desk.clock.now();
      const consultations = input.lines.filter((line) => line.serviceId === null);
      const doctors = await desk.consultants(consultations.map((line) => line.doctorId ?? ''));
      const givers = await desk.bills.doctors(
        input.lines.flatMap((line) => (line.serviceId !== null && line.doctorId ? [line.doctorId] : [])),
      );
      const services = await desk.bills.services(
        input.lines.flatMap((line) => (line.serviceId ? [line.serviceId] : [])),
      );
      if (input.referredById && (await desk.bills.doctors([input.referredById])).size === 0) {
        throw new NotFoundError('referring_doctor');
      }
      const payer = await desk.payer(
        input.corporateClientId === undefined && !input.staffId
          ? patient.corporateClientId
          : (input.corporateClientId ?? null),
        input.staffId,
      );
      const appointment = input.appointmentId ? await desk.appointments.findForUpdate(input.appointmentId) : null;
      if (input.appointmentId && !appointment) throw new NotFoundError('appointment');
      if (appointment) {
        appointment.assertBillable();
        if (!consultations.some((line) => line.doctorId === appointment.doctorId)) {
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
          if (line.serviceId === null) {
            const doctor = doctors.get(line.doctorId!)!;
            const visitType =
              line.visitType ??
              suggestedVisit(await desk.bills.lastVisitOn(patient.id, doctor.id), today, policy.followUpDays);
            return {
              doctorId: doctor.id,
              visitType,
              serviceId: null,
              qty: 1,
              rate: feeFor(doctor, visitType),
              sharePercent: doctor.sharePercent ?? policy.defaultSharePercent,
            };
          }
          const service = services.get(line.serviceId);
          if (!service) throw new NotFoundError('service');
          if (!service.isActive || !service.isOpd) {
            throw new DomainError('not_billable', `${service.name} is not billed at the OPD`);
          }
          if (line.doctorId) {
            const giver = givers.get(line.doctorId);
            if (!giver) throw new NotFoundError('doctor');
            if (!giver.isActive) throw new DomainError('not_bookable', `${giver.name} is not active`);
          }
          return {
            doctorId: line.doctorId,
            visitType: null,
            serviceId: service.id,
            qty: line.qty,
            rate: service.rate,
            sharePercent: service.sharePercent ?? 0,
          };
        }),
      );
      // A corporate client's own discount is given unless another is asked for, and is not held to the counter's limit.
      const client = payer.kind === 'corporate' ? payer.client : null;
      const gross = lines.reduce((total, line) => total + Math.round(line.rate * 100) * line.qty, 0) / 100;
      const clientDiscount = client ? Math.floor(gross * client.discountPercent) / 100 : 0;
      const bill = OpdBill.create({
        id: randomUUID(),
        number: await desk.number(lines.some((line) => line.serviceId !== null) ? 'OS' : 'OC', today),
        patientId: patient.id,
        appointmentId: appointment?.id ?? null,
        billedOn: today,
        referredById: input.referredById,
        lines,
        payer: payer.payer,
        discount: input.discount ?? clientDiscount,
        discountReason:
          input.discountReason ?? (input.discount === null && clientDiscount > 0 ? `Corporate: ${client!.name}` : null),
        discountLimitPercent: Math.max(policy.counterDiscountPercent, client?.discountPercent ?? 0),
        mayDiscountMore,
        payment: input.payment,
        by: actor.userId,
        now,
      });
      if (client?.payment === 'credit' && client.creditLimit !== null) {
        const owed = await desk.corporate.owed(client.id);
        if (owed + bill.due > client.creditLimit) {
          throw new DomainError(
            'credit_limit',
            `${client.name} owes ${owed.toFixed(2)}; with ${bill.due.toFixed(2)} more it is over its limit of ${client.creditLimit.toFixed(2)}`,
          );
        }
      }
      const header = bill.toSnapshot();
      const income = bill.grossByKind;
      const narration = `OPD bill ${header.number}`;
      const voucher = await desk.post(
        narration,
        today,
        header.id,
        [
          ...(input.payment && header.paid > 0
            ? [{ account: { role: OPD_RECEIPT_ROLES[input.payment.method] }, debit: header.paid, credit: 0, narration }]
            : []),
          { account: { role: receivableRole(bill) }, debit: bill.due, credit: 0, narration },
          { account: { role: OPD_DISCOUNT_ROLE }, debit: header.discount, credit: 0, narration },
          { account: { role: OPD_INCOME_ROLE }, debit: 0, credit: income.consultations, narration },
          { account: { role: OPD_SERVICE_INCOME_ROLE }, debit: 0, credit: income.services, narration },
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
      await desk.bills.addLedger(shareEntries(bill, 'share', today));
      await desk.bills.addUhidUse({
        patientId: patient.id,
        usedOn: today,
        service: income.services > 0 || consultations.length === 0 ? 'opd_service' : 'opd_consultation',
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
          { account: { role: receivableRole(bill) }, debit: 0, credit: payment.amount, narration },
        ],
        actor,
      );
      await desk.bills.update(bill, actor.userId, voucher?.number ?? null);
      await desk.record('collected', actor, id, { number, amount: payment.amount, method });
      return { number };
    });
  }
}

/**
 * Old corporate client collection (diagnostics and pharmacy only; the OPD and the wards had none): what a company pays
 * settles its OPD, diagnostic and indoor bills together, oldest first, on one receipt and one voucher.
 */
@CommandHandler(CollectCorporateDueCommand)
export class CollectCorporateDueHandler implements ICommandHandler<CollectCorporateDueCommand> {
  constructor(
    private readonly desk: OpdDesk,
    private readonly indoor: IpdBillingRepository,
    private readonly diagnostics: DiagnosticBillRepository,
  ) {}

  async execute({ actor, clientId, amount, method, reference }: CollectCorporateDueCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [OPD_BILL] });
    validMoney(amount, 'amount');
    if (amount === 0) throw new DomainError('invalid_amount', 'Collect more than nothing');
    return desk.tx.run(async () => {
      const client = await desk.bills.corporateClient(clientId);
      if (!client) throw new NotFoundError('corporate_client');
      await desk.tx.lock(`hospital:corporate:${clientId}`);
      const owed = await desk.bills.corporateDue(clientId);
      if (amount > owed) throw new DomainError('overpayment', `${client.name} owes ${owed.toFixed(2)}`);
      const today = desk.today();
      const now = desk.clock.now();
      const number = await desk.number('OR', today);
      let left = Math.round(amount * 100);
      const settled: { kind: 'opd' | 'ipd' | 'diag'; billId: string; number: string; amount: number }[] = [];
      const opd: OpdBill[] = [];
      const ipd: IpdBill[] = [];
      const diag: DiagnosticBill[] = [];
      for (const due of await desk.bills.dueBills(clientId)) {
        if (left === 0) break;
        if (due.kind === 'opd') {
          const bill = (await desk.bills.findForUpdate(due.id))!;
          const part = Math.min(left, Math.round(bill.due * 100));
          if (part === 0) continue;
          bill.collect({ number, method, reference, amount: part / 100, on: today, now });
          opd.push(bill);
          settled.push({ kind: 'opd', billId: bill.id, number: bill.number, amount: part / 100 });
          left -= part;
        } else if (due.kind === 'diag') {
          const bill = (await this.diagnostics.findForUpdate(due.id))!;
          const part = Math.min(left, Math.round(bill.due * 100));
          if (part === 0) continue;
          bill.collect(part / 100, today, now);
          diag.push(bill);
          settled.push({ kind: 'diag', billId: bill.id, number: bill.number, amount: part / 100 });
          left -= part;
        } else {
          const bill = (await this.indoor.billForUpdate(due.id))!;
          const part = Math.min(left, Math.round(bill.due * 100));
          if (part === 0) continue;
          bill.collect(part / 100, today, now);
          ipd.push(bill);
          settled.push({ kind: 'ipd', billId: bill.id, number: bill.number, amount: part / 100 });
          left -= part;
        }
      }
      const narration = `${client.name} paid ${number}`;
      const voucher = await desk.post(
        narration,
        today,
        clientId,
        [
          { account: { role: OPD_RECEIPT_ROLES[method] }, debit: amount, credit: 0, narration },
          { account: { role: CORPORATE_RECEIVABLE_ROLE }, debit: 0, credit: amount, narration },
        ],
        actor,
      );
      for (const bill of opd) await desk.bills.update(bill, actor.userId, voucher?.number ?? null);
      for (const bill of diag) {
        await this.diagnostics.update(bill);
        await this.diagnostics.addPayment({
          billId: bill.id,
          kind: 'collection',
          number,
          method,
          reference: text(reference, 100, 'payment reference'),
          amount: settled.find((part) => part.billId === bill.id)!.amount,
          paidOn: today,
          receivedBy: actor.userId,
          voucherNumber: voucher?.number ?? null,
        });
      }
      // An indoor bill's part gets its own receipt row (the account's money), under the company's receipt number.
      for (const [index, bill] of ipd.entries()) {
        await this.indoor.updateBill(bill);
        await this.indoor.addPayment({
          admissionId: bill.admissionId,
          billId: bill.id,
          kind: 'collection',
          number: index === 0 ? number : `${number}/${index + 1}`,
          method,
          reference: text(reference, 100, 'payment reference'),
          amount: settled.find((part) => part.billId === bill.id)!.amount,
          paidOn: today,
          receivedBy: actor.userId,
          voucherNumber: voucher?.number ?? null,
        });
      }
      await desk.audit.record({
        action: 'hospital.corporate_collected',
        actorUserId: actor.userId,
        resourceType: 'corporate_client',
        resourceId: clientId,
        metadata: { number, amount, method, bills: settled.length },
      });
      return { number, settled };
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
      const narration = `Cancelled OPD bill ${header.number}`;
      const income = bill.grossByKind;
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
          { account: { role: receivableRole(bill) }, debit: 0, credit: dueCleared, narration },
          { account: { role: OPD_DISCOUNT_ROLE }, debit: 0, credit: header.discount, narration },
          { account: { role: OPD_INCOME_ROLE }, debit: income.consultations, credit: 0, narration },
          { account: { role: OPD_SERVICE_INCOME_ROLE }, debit: income.services, credit: 0, narration },
          { account: { role: CONSULTANT_PAYABLE_ROLE }, debit: bill.share, credit: 0, narration },
          { account: { role: DOCTOR_FEE_ROLE }, debit: 0, credit: bill.share, narration },
        ],
        actor,
      );
      bill.cancelPosted(voucher?.number ?? null);
      await desk.bills.update(bill, actor.userId, voucher?.number ?? null);
      await desk.bills.addLedger(shareEntries(bill, 'reversal', today));
      await desk.record('cancelled', actor, id, {
        reason,
        refunded: header.refunded,
        voucher: voucher?.number ?? null,
      });
      return { refunded: header.refunded };
    });
  }
}

/**
 * Old SaveConsultancyPaymentRecords (worked out in SPGetDoctorPayment per service, never posted; no page left): a doctor
 * paid any part of what their ledger says they are owed, with a receipt number and a voucher.
 */
@CommandHandler(PayDoctorCommand)
export class PayDoctorHandler implements ICommandHandler<PayDoctorCommand> {
  constructor(private readonly desk: OpdDesk) {}

  async execute({ actor, doctorId, payment }: PayDoctorCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [DOCTOR_PAY] });
    validMoney(payment.amount, 'amount');
    if (payment.amount === 0) throw new DomainError('invalid_amount', 'Pay more than nothing');
    return desk.tx.run(async () => {
      await desk.tx.lock(`hospital:doctor:${doctorId}`);
      const doctor = (await desk.bills.doctors([doctorId])).get(doctorId);
      if (!doctor) throw new NotFoundError('doctor');
      const owed = await desk.bills.doctorBalance(doctorId);
      if (payment.amount > owed) {
        throw new DomainError('overpayment', `${doctor.name} is owed ${owed.toFixed(2)}`);
      }
      const today = desk.today();
      const number = await desk.number('DP', today);
      const narration = `${doctor.name} paid ${number}`;
      const voucher = await desk.post(
        narration,
        today,
        doctorId,
        [
          { account: { role: CONSULTANT_PAYABLE_ROLE }, debit: payment.amount, credit: 0, narration },
          { account: { role: OPD_RECEIPT_ROLES[payment.method] }, debit: 0, credit: payment.amount, narration },
        ],
        actor,
      );
      await desk.bills.addDoctorPayment({
        number,
        doctorId,
        paidOn: today,
        amount: payment.amount,
        method: payment.method,
        reference: text(payment.reference, 100, 'payment reference'),
        note: text(payment.note, 200, 'note'),
        voucherNumber: voucher?.number ?? null,
        paidBy: actor.userId,
      });
      await desk.audit.record({
        action: 'hospital.doctor_paid',
        actorUserId: actor.userId,
        resourceType: 'doctor',
        resourceId: doctorId,
        metadata: { number, amount: payment.amount, method: payment.method },
      });
      return { number, balance: (Math.round(owed * 100) - Math.round(payment.amount * 100)) / 100 };
    });
  }
}

/** Old DoctorPaymentSheet: what a doctor earned, had taken back and was paid, with what they are owed. */
@QueryHandler(GetDoctorLedgerQuery)
export class GetDoctorLedgerHandler implements IQueryHandler<GetDoctorLedgerQuery> {
  constructor(private readonly desk: OpdDesk) {}

  async execute({ actor, doctorId, from, to }: GetDoctorLedgerQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [OPD_READ] });
    if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
    const ledger = await this.desk.read.doctorLedger(doctorId, from, to);
    if (!ledger) throw new NotFoundError('doctor');
    return ledger;
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
  CollectCorporateDueHandler,
  CancelOpdBillHandler,
  PayDoctorHandler,
  GetDoctorLedgerHandler,
  GetOpdPolicyHandler,
  SuggestVisitHandler,
  ListOpdBillsHandler,
  GetOpdBillHandler,
];
