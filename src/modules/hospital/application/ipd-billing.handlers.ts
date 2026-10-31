import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { InpatientBlood } from '../../../shared/application/contracts/inpatient-blood.js';
import { InpatientMedicine } from '../../../shared/application/contracts/inpatient-medicine.js';
import type { LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import type { Admission } from '../domain/admission.js';
import { bedNights, billLines, chargeOf, IpdBill, type IpdBillLine } from '../domain/ipd-bill.js';
import type { BillPayer } from '../domain/opd-bill.js';
import { text } from '../domain/patient.js';
import {
  DiagnosticBillRepository,
  OtCaseRepository,
  type DoctorLedgerEntry,
  type IpdPolicy,
} from '../domain/repositories.js';
import {
  AddIpdChargeCommand,
  CancelIpdBillCommand,
  CancelIpdChargeCommand,
  CollectIpdDueCommand,
  GetIpdAccountQuery,
  GetIpdBillQuery,
  GetIpdPolicyQuery,
  IPD_ADVANCE_ROLE,
  IPD_BILL,
  IPD_DISCOUNT,
  IPD_DISCOUNT_ROLE,
  IPD_INCOME_ROLES,
  IPD_RECEIVABLE_ROLE,
  IpdBillingReadRepository,
  ListIpdBillsQuery,
  MakeIpdBillCommand,
  MoveIpdAdvanceCommand,
  SetIpdPolicyCommand,
  type IpdAccount,
  type IpdBillLineView,
} from './ipd-billing.messages.js';
import { IpdDesk } from './ipd.handlers.js';
import { IPD_MANAGE, IPD_READ } from './ipd.messages.js';
import {
  CONSULTANT_PAYABLE_ROLE,
  CORPORATE_RECEIVABLE_ROLE,
  DOCTOR_FEE_ROLE,
  OPD_RECEIPT_ROLES,
  STAFF_RECEIVABLE_ROLE,
} from './opd.messages.js';
import { localToday } from './patient.handlers.js';

/** Where what is not paid is owed: the patient, a corporate client or a staff member. */
function receivableRole(payer: BillPayer): string {
  switch (payer.kind) {
    case 'corporate':
      return CORPORATE_RECEIVABLE_ROLE;
    case 'staff':
      return STAFF_RECEIVABLE_ROLE;
    case 'patient':
      return IPD_RECEIVABLE_ROLE;
  }
}

/** The income of each head, credited on a bill (+) or taken back on its cancellation (−). */
function incomeLines(bill: IpdBill, narration: string, side: 'credit' | 'debit'): LedgerPostingLine[] {
  return Object.entries(bill.income).map(([head, amount]) => ({
    account: { role: IPD_INCOME_ROLES[head as keyof typeof IPD_INCOME_ROLES] },
    debit: side === 'debit' ? amount : 0,
    credit: side === 'credit' ? amount : 0,
    narration,
  }));
}

/** Each doctor's share on the bill, earned (+) or taken back (−). */
function shareEntries(bill: IpdBill, kind: 'share' | 'reversal', on: string): DoctorLedgerEntry[] {
  return bill.lines
    .filter((line) => line.shareAmount > 0 && line.doctorId !== null)
    .map((line) => ({
      doctorId: line.doctorId!,
      entryOn: on,
      kind,
      billId: null,
      ipdBillId: bill.id,
      documentNumber: bill.number,
      amount: kind === 'share' ? line.shareAmount : -line.shareAmount,
    }));
}

@Injectable()
export class IpdCashier {
  constructor(
    readonly desk: IpdDesk,
    readonly read: IpdBillingReadRepository,
    readonly medicine: InpatientMedicine,
    readonly tests: DiagnosticBillRepository,
    readonly bloodBank: InpatientBlood,
  ) {}

  get opd() {
    return this.desk.opd;
  }

  get billing() {
    return this.desk.billing;
  }

  /** The admission, locked for a change to its account; charges and advances only while the patient is in. */
  async admitted(id: string): Promise<Admission> {
    const admission = await this.desk.admissions.findForUpdate(id);
    if (!admission) throw new NotFoundError('admission');
    if (admission.status !== 'admitted') {
      throw new DomainError('admission_state', `The admission is ${admission.status}`);
    }
    return admission;
  }

  /** No charge or advance once the bill is made: cancel it first (or collect against it). */
  async assertUnbilled(admissionId: string): Promise<void> {
    if (await this.billing.liveBill(admissionId)) {
      throw new ConflictError('bill_made', 'The final bill is made; cancel it first');
    }
  }

  /** The lines of the bill if it were made on that day. */
  async draft(admission: Admission, on: string): Promise<{ nights: number; lines: IpdBillLine[] }> {
    // One query at a time: this runs inside the transaction, on its one connection.
    const stays = await this.billing.stays(admission.id);
    const charges = await this.billing.activeCharges(admission.id);
    const policy = await this.billing.policy();
    const medicine = await this.medicine.charges(admission.id);
    const investigations = await this.tests.indoorCharges(admission.id);
    const blood = await this.bloodBank.charges(admission.id);
    const runs = bedNights(stays, on);
    return {
      nights: runs.reduce((total, run) => total + run.nights, 0),
      lines: billLines({
        nights: runs,
        admissionFee: admission.toSnapshot().admissionFee,
        roundFeePerNight: policy.roundFeePerNight,
        serviceChargePercent: policy.serviceChargePercent,
        charges,
        medicine,
        investigations,
        blood,
      }),
    };
  }

  /** The bill and the admission it is on, locked in that order (as every change to the account locks them). */
  async bill(id: string, version: number): Promise<{ bill: IpdBill; admission: Admission }> {
    const view = await this.read.get(id);
    if (!view) throw new NotFoundError('ipd_bill');
    const admission = await this.desk.admissions.findForUpdate(view.admissionId);
    const bill = await this.billing.billForUpdate(id);
    if (!admission || !bill) throw new NotFoundError('ipd_bill');
    bill.assertVersion(version);
    return { bill, admission };
  }

  /** The bill in force, or what it would be on its last day (today while the patient is in). */
  async account(admissionId: string): Promise<IpdAccount> {
    const admission = await this.desk.admissions.findById(admissionId);
    if (!admission) throw new NotFoundError('admission');
    const snapshot = admission.toSnapshot();
    const [charges, payments, billId] = await Promise.all([
      this.read.charges(admissionId),
      this.read.payments(admissionId),
      this.read.liveBillId(admissionId),
    ]);
    const bill = billId ? await this.read.get(billId) : null;
    let asOf: string;
    let nights = 0;
    let lines: IpdBillLineView[] = [];
    if (bill) {
      asOf = bill.billedOn;
      nights = bill.nights;
      lines = bill.lines;
    } else {
      asOf = snapshot.dischargedAt ? localToday(snapshot.dischargedAt, this.opd.settings.timeZone) : this.opd.today();
      if (snapshot.status !== 'cancelled') {
        const draft = await this.draft(admission, asOf);
        const names = await this.read.doctorNames(
          draft.lines.flatMap((line) => (line.doctorId ? [line.doctorId] : [])),
        );
        nights = draft.nights;
        lines = draft.lines.map((line) => ({
          head: line.head,
          description: line.description,
          doctorId: line.doctorId,
          doctorName: line.doctorId ? (names.get(line.doctorId) ?? null) : null,
          fromOn: line.fromOn,
          toOn: line.toOn,
          qty: line.qty,
          rate: line.rate,
          amount: line.amount,
          serviceCharge: line.serviceCharge,
          shareAmount: line.shareAmount,
        }));
      }
    }
    const cents = (values: number[]) => values.reduce((total, value) => total + Math.round(value * 100), 0);
    const gross = cents(lines.map((line) => line.amount)) / 100;
    const serviceCharge = cents(lines.map((line) => line.serviceCharge)) / 100;
    const total = (Math.round(gross * 100) + Math.round(serviceCharge * 100)) / 100;
    const received =
      cents(payments.filter((payment) => payment.kind !== 'refund').map((payment) => payment.amount)) -
      cents(payments.filter((payment) => payment.kind === 'refund').map((payment) => payment.amount));
    const held = bill ? 0 : received / 100;
    return {
      admissionId,
      admissionNumber: snapshot.number,
      admissionStatus: snapshot.status,
      asOf,
      nights,
      lines,
      gross,
      serviceCharge,
      total,
      held,
      balance: bill ? bill.due : (Math.round(total * 100) - received) / 100,
      bill: bill
        ? {
            id: bill.id,
            number: bill.number,
            billedOn: bill.billedOn,
            discount: bill.discount,
            net: bill.net,
            deposit: bill.deposit,
            paid: bill.paid,
            collected: bill.collected,
            due: bill.due,
            version: bill.version,
          }
        : null,
      charges,
      payments,
      openIndents: snapshot.status === 'admitted' ? await this.medicine.openIndents(admissionId) : 0,
    };
  }

  record(action: string, actor: Actor, id: string, metadata: Record<string, string | number | null> = {}) {
    return this.opd.audit.record({
      action: `hospital.ipd_bill_${action}`,
      actorUserId: actor.userId,
      resourceType: 'ipd_bill',
      resourceId: id,
      metadata,
    });
  }
}

@CommandHandler(SetIpdPolicyCommand)
export class SetIpdPolicyHandler implements ICommandHandler<SetIpdPolicyCommand> {
  constructor(private readonly cashier: IpdCashier) {}

  async execute({ actor, policy }: SetIpdPolicyCommand): Promise<void> {
    const { opd, billing } = this.cashier;
    await opd.access.authorize(actor.userId, { permissions: [IPD_MANAGE] });
    for (const percent of [policy.serviceChargePercent, policy.counterDiscountPercent]) {
      if (!(percent >= 0 && percent <= 100)) throw new DomainError('invalid_policy', 'Percentages are 0 to 100');
    }
    await opd.tx.run(async () => {
      await billing.savePolicy(policy, actor.userId, opd.clock.now());
      await opd.audit.record({
        action: 'hospital.ipd_policy_set',
        actorUserId: actor.userId,
        resourceType: 'ipd_policy',
        resourceId: '1',
        metadata: { ...policy },
      });
    });
  }
}

@QueryHandler(GetIpdPolicyQuery)
export class GetIpdPolicyHandler implements IQueryHandler<GetIpdPolicyQuery> {
  constructor(private readonly cashier: IpdCashier) {}

  async execute({ actor }: GetIpdPolicyQuery): Promise<IpdPolicy> {
    await this.cashier.opd.access.authorize(actor.userId, { permissions: [IPD_READ] });
    return this.cashier.billing.policy();
  }
}

/**
 * Old IPD Service Records and IPD Consultancy Service pages (no role check, a 30-second duplicate guard): a service or
 * a consultant's visit given to an admitted patient, at the service's rate, on a day of the stay.
 */
@CommandHandler(AddIpdChargeCommand)
export class AddIpdChargeHandler implements ICommandHandler<AddIpdChargeCommand> {
  constructor(
    private readonly cashier: IpdCashier,
    private readonly operations: OtCaseRepository,
  ) {}

  async execute({ actor, admissionId, input }: AddIpdChargeCommand) {
    const { cashier } = this;
    const { opd } = cashier;
    await opd.access.authorize(actor.userId, { permissions: [IPD_BILL] });
    return opd.tx.run(async () => {
      const admission = await cashier.admitted(admissionId);
      await cashier.assertUnbilled(admissionId);
      const service = (await opd.bills.services([input.serviceId])).get(input.serviceId);
      if (!service) throw new NotFoundError('service');
      if (!service.isActive || !service.isIpd) {
        throw new DomainError('not_billable', `${service.name} is not given on the wards`);
      }
      if (input.doctorId) await cashier.desk.doctors([input.doctorId]);
      if (input.otCaseId) {
        const operation = (await this.operations.findById(input.otCaseId))?.toSnapshot();
        if (!operation) throw new NotFoundError('ot_case');
        if (operation.admissionId !== admissionId || operation.status === 'cancelled') {
          throw new DomainError('invalid_ot_case', 'Charge an operation of this stay that is not cancelled');
        }
      }
      const today = opd.today();
      const chargedOn = input.chargedOn ?? today;
      const admittedOn = localToday(admission.toSnapshot().admittedAt, opd.settings.timeZone);
      if (chargedOn < admittedOn || chargedOn > today) {
        throw new DomainError('invalid_date', `A charge is on a day from ${admittedOn} to today`);
      }
      const charge = chargeOf({
        id: randomUUID(),
        serviceId: service.id,
        serviceName: service.name,
        doctorId: input.doctorId,
        chargedOn,
        qty: input.qty,
        rate: service.rate,
        sharePercent: service.sharePercent ?? 0,
      });
      await cashier.billing.insertCharge({
        ...charge,
        admissionId,
        otCaseId: input.otCaseId ?? null,
        note: text(input.note, 200, 'note'),
        chargedBy: actor.userId,
      });
      await cashier.desk.record('charged', actor, admissionId, {
        service: service.name,
        qty: charge.qty,
        amount: charge.amount,
      });
      return { id: charge.id, amount: charge.amount };
    });
  }
}

/** Old DeleteIPDServiceCommand (a soft delete, no reason): a charge taken off before the bill, with a reason. */
@CommandHandler(CancelIpdChargeCommand)
export class CancelIpdChargeHandler implements ICommandHandler<CancelIpdChargeCommand> {
  constructor(private readonly cashier: IpdCashier) {}

  async execute({ actor, admissionId, chargeId, reason }: CancelIpdChargeCommand): Promise<void> {
    const { cashier } = this;
    const { opd } = cashier;
    await opd.access.authorize(actor.userId, { permissions: [IPD_BILL] });
    const why = text(reason, 200, 'reason');
    if (!why) throw new DomainError('invalid_remarks', 'Give a reason');
    await opd.tx.run(async () => {
      await cashier.admitted(admissionId);
      await cashier.assertUnbilled(admissionId);
      const charge = await cashier.billing.charge(chargeId);
      if (!charge || charge.admissionId !== admissionId) throw new NotFoundError('charge');
      if (charge.status === 'cancelled') throw new DomainError('charge_state', 'The charge is cancelled already');
      await cashier.billing.cancelCharge(chargeId, why, actor.userId, opd.clock.now());
      await cashier.desk.record('charge_cancelled', actor, admissionId, { chargeId, reason: why });
    });
  }
}

/** Old Advance Payment and Return Advance Payment pages. */
@CommandHandler(MoveIpdAdvanceCommand)
export class MoveIpdAdvanceHandler implements ICommandHandler<MoveIpdAdvanceCommand> {
  constructor(private readonly cashier: IpdCashier) {}

  async execute({ actor, admissionId, kind, money }: MoveIpdAdvanceCommand) {
    const { cashier } = this;
    const { opd } = cashier;
    await opd.access.authorize(actor.userId, { permissions: [IPD_BILL] });
    return opd.tx.run(async () => {
      const admission = await cashier.admitted(admissionId);
      await cashier.assertUnbilled(admissionId);
      return cashier.desk.moveAdvance(admission, kind, money, actor);
    });
  }
}

/**
 * Old Generate Final Billing page (recomputed from the source tables, saved as head summaries, the settlement never
 * posted): the bed nights to today, the admission fee, the round fee, the service charge and the charges, less the
 * discount; the advance held is taken against it and the rest is paid or owed. One voucher posts it all, and each
 * doctor is credited their share.
 */
@CommandHandler(MakeIpdBillCommand)
export class MakeIpdBillHandler implements ICommandHandler<MakeIpdBillCommand> {
  constructor(private readonly cashier: IpdCashier) {}

  async execute({ actor, admissionId, input }: MakeIpdBillCommand) {
    const { cashier } = this;
    const { opd } = cashier;
    await opd.access.authorize(actor.userId, { permissions: [IPD_BILL] });
    const mayDiscountMore = await opd.access.isAllowed(actor.userId, { permissions: [IPD_DISCOUNT] });
    return opd.tx.run(async () => {
      const admission = await cashier.admitted(admissionId);
      await cashier.assertUnbilled(admissionId);
      const snapshot = admission.toSnapshot();
      const today = opd.today();
      const now = opd.clock.now();
      const { nights, lines } = await cashier.draft(admission, today);
      const client = snapshot.corporateClientId ? await opd.bills.corporateClient(snapshot.corporateClientId) : null;
      const payer: BillPayer = client
        ? { kind: 'corporate', clientId: client.id, cash: client.payment === 'cash' }
        : snapshot.staffId
          ? { kind: 'staff', staffId: snapshot.staffId }
          : { kind: 'patient' };
      const total = lines.reduce(
        (sum, line) => sum + Math.round(line.amount * 100) + Math.round(line.serviceCharge * 100),
        0,
      );
      const clientDiscount = client ? Math.floor((total * client.discountPercent) / 100) / 100 : 0;
      const policy = await cashier.billing.policy();
      const bill = IpdBill.create({
        id: randomUUID(),
        number: await opd.number('IB', today),
        admissionId,
        patientId: snapshot.patientId,
        billedOn: today,
        payer,
        nights,
        lines,
        discount: input.discount ?? clientDiscount,
        discountReason:
          input.discountReason ?? (input.discount === null && clientDiscount > 0 ? `Corporate: ${client!.name}` : null),
        discountLimitPercent: Math.max(policy.counterDiscountPercent, client?.discountPercent ?? 0),
        mayDiscountMore,
        deposit: await cashier.billing.received(admissionId),
        payment: input.payment,
        by: actor.userId,
        now,
      });
      const header = bill.toSnapshot();
      const narration = `Final bill ${header.number} (${snapshot.number})`;
      const payment = input.payment && header.paid > 0 ? input.payment : null;
      const voucher = await opd.post(
        narration,
        today,
        bill.id,
        [
          ...(payment
            ? [{ account: { role: OPD_RECEIPT_ROLES[payment.method] }, debit: header.paid, credit: 0, narration }]
            : []),
          { account: { role: IPD_ADVANCE_ROLE }, debit: header.deposit, credit: 0, narration },
          { account: { role: receivableRole(payer) }, debit: bill.due, credit: 0, narration },
          { account: { role: IPD_DISCOUNT_ROLE }, debit: header.discount, credit: 0, narration },
          ...incomeLines(bill, narration, 'credit'),
          { account: { role: DOCTOR_FEE_ROLE }, debit: bill.share, credit: 0, narration },
          { account: { role: CONSULTANT_PAYABLE_ROLE }, debit: 0, credit: bill.share, narration },
        ],
        actor,
      );
      bill.posted(voucher?.number ?? null);
      await cashier.billing.insertBill(bill);
      let receipt: string | null = null;
      if (payment) {
        receipt = await opd.number('IR', today);
        await cashier.billing.addPayment({
          admissionId,
          billId: bill.id,
          kind: 'payment',
          number: receipt,
          method: payment.method,
          reference: text(payment.reference, 100, 'payment reference'),
          amount: header.paid,
          paidOn: today,
          receivedBy: actor.userId,
          voucherNumber: voucher?.number ?? null,
        });
      }
      await opd.bills.addLedger(shareEntries(bill, 'share', today));
      await cashier.record('made', actor, bill.id, {
        number: header.number,
        net: header.net,
        discount: header.discount,
        due: bill.due,
        voucher: voucher?.number ?? null,
      });
      return { id: bill.id, number: header.number, net: header.net, due: bill.due, receipt };
    });
  }
}

/** A final bill taken back while the patient is still in; what was put in against it is held as advance again. */
@CommandHandler(CancelIpdBillCommand)
export class CancelIpdBillHandler implements ICommandHandler<CancelIpdBillCommand> {
  constructor(private readonly cashier: IpdCashier) {}

  async execute({ actor, id, version, reason }: CancelIpdBillCommand) {
    const { cashier } = this;
    const { opd } = cashier;
    await opd.access.authorize(actor.userId, { permissions: [IPD_BILL] });
    const mayCancelLater = await opd.access.isAllowed(actor.userId, { permissions: [IPD_MANAGE] });
    return opd.tx.run(async () => {
      const { bill, admission } = await cashier.bill(id, version);
      if (admission.status !== 'admitted') {
        throw new DomainError('admission_state', `The patient is ${admission.status}; the bill stands`);
      }
      const today = opd.today();
      const { held, dueCleared } = bill.cancel({
        reason,
        on: today,
        by: actor.userId,
        mayCancelLater,
        now: opd.clock.now(),
      });
      const header = bill.toSnapshot();
      const narration = `Cancelled final bill ${header.number}`;
      const voucher = await opd.post(
        narration,
        today,
        bill.id,
        [
          ...incomeLines(bill, narration, 'debit'),
          { account: { role: IPD_DISCOUNT_ROLE }, debit: 0, credit: header.discount, narration },
          { account: { role: receivableRole(bill.payer) }, debit: 0, credit: dueCleared, narration },
          { account: { role: IPD_ADVANCE_ROLE }, debit: 0, credit: held, narration },
          { account: { role: CONSULTANT_PAYABLE_ROLE }, debit: bill.share, credit: 0, narration },
          { account: { role: DOCTOR_FEE_ROLE }, debit: 0, credit: bill.share, narration },
        ],
        actor,
      );
      bill.cancelPosted(voucher?.number ?? null);
      await cashier.billing.updateBill(bill);
      await opd.bills.addLedger(shareEntries(bill, 'reversal', today));
      await cashier.record('cancelled', actor, id, { reason, held, voucher: voucher?.number ?? null });
      return { held };
    });
  }
}

/** Old IPD Due Collection For Discharged Patient: a due collected against the bill, with its receipt and voucher. */
@CommandHandler(CollectIpdDueCommand)
export class CollectIpdDueHandler implements ICommandHandler<CollectIpdDueCommand> {
  constructor(private readonly cashier: IpdCashier) {}

  async execute({ actor, id, version, money }: CollectIpdDueCommand) {
    const { cashier } = this;
    const { opd } = cashier;
    await opd.access.authorize(actor.userId, { permissions: [IPD_BILL] });
    return opd.tx.run(async () => {
      const { bill, admission } = await cashier.bill(id, version);
      const today = opd.today();
      const amount = bill.collect(money.amount, today, opd.clock.now());
      const number = await opd.number('IR', today);
      const narration = `Due collected on ${bill.number} (${number})`;
      const voucher = await opd.post(
        narration,
        today,
        bill.id,
        [
          { account: { role: OPD_RECEIPT_ROLES[money.method] }, debit: amount, credit: 0, narration },
          { account: { role: receivableRole(bill.payer) }, debit: 0, credit: amount, narration },
        ],
        actor,
      );
      await cashier.billing.updateBill(bill);
      await cashier.billing.addPayment({
        admissionId: admission.id,
        billId: bill.id,
        kind: 'collection',
        number,
        method: money.method,
        reference: text(money.reference, 100, 'payment reference'),
        amount,
        paidOn: today,
        receivedBy: actor.userId,
        voucherNumber: voucher?.number ?? null,
      });
      await cashier.record('collected', actor, id, { number, amount, method: money.method });
      return { number, due: bill.due };
    });
  }
}

/** Old Hospital Billing grid (recomputed on every open): the bill in force, or what it would be today. */
@QueryHandler(GetIpdAccountQuery)
export class GetIpdAccountHandler implements IQueryHandler<GetIpdAccountQuery> {
  constructor(private readonly cashier: IpdCashier) {}

  async execute({ actor, admissionId }: GetIpdAccountQuery): Promise<IpdAccount> {
    await this.cashier.opd.access.authorize(actor.userId, { permissions: [IPD_READ] });
    return this.cashier.account(admissionId);
  }
}

@QueryHandler(ListIpdBillsQuery)
export class ListIpdBillsHandler implements IQueryHandler<ListIpdBillsQuery> {
  constructor(private readonly cashier: IpdCashier) {}

  async execute({ actor, filter }: ListIpdBillsQuery) {
    await this.cashier.opd.access.authorize(actor.userId, { permissions: [IPD_READ] });
    return this.cashier.read.list(filter);
  }
}

@QueryHandler(GetIpdBillQuery)
export class GetIpdBillHandler implements IQueryHandler<GetIpdBillQuery> {
  constructor(private readonly cashier: IpdCashier) {}

  async execute({ actor, id }: GetIpdBillQuery) {
    await this.cashier.opd.access.authorize(actor.userId, { permissions: [IPD_READ] });
    const bill = await this.cashier.read.get(id);
    if (!bill) throw new NotFoundError('ipd_bill');
    return bill;
  }
}

export const IPD_BILLING_HANDLERS = [
  IpdCashier,
  SetIpdPolicyHandler,
  GetIpdPolicyHandler,
  AddIpdChargeHandler,
  CancelIpdChargeHandler,
  MoveIpdAdvanceHandler,
  MakeIpdBillHandler,
  CancelIpdBillHandler,
  CollectIpdDueHandler,
  GetIpdAccountHandler,
  ListIpdBillsHandler,
  GetIpdBillHandler,
];
