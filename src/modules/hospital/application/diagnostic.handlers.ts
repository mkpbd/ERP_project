import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { ConflictError, DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { DiagnosticBill, MAX_DIAGNOSTIC_LINES } from '../domain/diagnostic-bill.js';
import { validMoney, type BillPayer } from '../domain/opd-bill.js';
import { text } from '../domain/patient.js';
import {
  AdmissionRepository,
  DiagnosticBillRepository,
  DiagnosticBookingRepository,
  IpdBillingRepository,
  type DiagnosticPolicy,
  type DoctorLedgerEntry,
} from '../domain/repositories.js';
import { DIAG_BILL, DIAG_DISCOUNT, DIAG_MANAGE, DIAG_READ } from './hospital.constants.js';
import {
  CancelDiagnosticTestsCommand,
  CollectDiagnosticDueCommand,
  CreateDiagnosticBillCommand,
  DIAGNOSTIC_DISCOUNT_ROLE,
  DIAGNOSTIC_INCOME_ROLE,
  DiagnosticBillReadRepository,
  GetDiagnosticBillQuery,
  GetDiagnosticPolicyQuery,
  GetPackageTestsQuery,
  ListDiagnosticBillsQuery,
  REFERRAL_COMMISSION_ROLE,
  SetDiagnosticPolicyCommand,
  SetPackageTestsCommand,
} from './diagnostic.messages.js';
import { OpdDesk } from './opd.handlers.js';
import {
  CONSULTANT_PAYABLE_ROLE,
  CORPORATE_RECEIVABLE_ROLE,
  OPD_RECEIPT_ROLES,
  STAFF_RECEIVABLE_ROLE,
} from './opd.messages.js';

/** What patients owe on their own diagnostic bills. */
export const DIAGNOSTIC_RECEIVABLE_ROLE = 'diagnostic_receivable';
/** An admitted patient's tests, charged to the stay until its final bill takes them. */
export const IPD_INVESTIGATION_ROLE = 'ipd_investigation_unbilled';

function receivableRole(bill: { payer: BillPayer; admissionId: string | null }): string {
  if (bill.admissionId) return IPD_INVESTIGATION_ROLE;
  const { payer } = bill;
  switch (payer.kind) {
    case 'corporate':
      return CORPORATE_RECEIVABLE_ROLE;
    case 'staff':
      return STAFF_RECEIVABLE_ROLE;
    case 'patient':
      return DIAGNOSTIC_RECEIVABLE_ROLE;
  }
}

/** What the diagnostic handlers share on top of the OPD desk (patients, payers, numbers, posting). */
@Injectable()
export class DiagnosticDesk {
  constructor(
    readonly opd: OpdDesk,
    readonly bills: DiagnosticBillRepository,
    readonly read: DiagnosticBillReadRepository,
    readonly admissions: AdmissionRepository,
    readonly indoor: IpdBillingRepository,
    readonly bookings: DiagnosticBookingRepository,
  ) {}

  /**
   * The booking a bill is made for, locked: a home collection's charge as a line (the policy's service at the area's
   * charge, no discount beyond the test's, no referral commission), and the booking marked billed once the bill is in.
   */
  async booking(
    input: { testAppointmentId?: string | null | undefined; homeCollectionId?: string | null | undefined },
    patient: { id: string; fullName: string; mobileNo: string },
    homeCollectionTestId: string | null,
  ): Promise<{
    lines: {
      testId: string;
      packageId: null;
      rate: number;
      discountAllowed: boolean;
      referralPercent: number;
      reportHours: null;
    }[];
    billed: (billId: string, today: string, now: Date) => Promise<void>;
  } | null> {
    if (input.testAppointmentId) {
      const appointment = await this.bookings.appointmentForUpdate(input.testAppointmentId);
      if (!appointment) throw new NotFoundError('test_appointment');
      return {
        lines: [],
        billed: async (billId, today, now) => {
          appointment.billed(billId, patient, today, now);
          await this.bookings.updateAppointment(appointment);
        },
      };
    }
    if (!input.homeCollectionId) return null;
    const collection = await this.bookings.homeCollectionForUpdate(input.homeCollectionId);
    if (!collection) throw new NotFoundError('home_collection');
    let lines: {
      testId: string;
      packageId: null;
      rate: number;
      discountAllowed: boolean;
      referralPercent: number;
      reportHours: null;
    }[] = [];
    if (collection.charge > 0) {
      if (!homeCollectionTestId) {
        throw new DomainError(
          'home_collection_service_unset',
          'Name the home collection service in the diagnostic policy',
        );
      }
      const service = (await this.bills.tests([homeCollectionTestId])).get(homeCollectionTestId);
      if (!service?.isActive) throw new DomainError('inactive_test', 'The home collection service is not in use');
      lines = [
        {
          testId: service.id,
          packageId: null,
          rate: collection.charge,
          discountAllowed: service.discountAllowed,
          referralPercent: 0,
          reportHours: null,
        },
      ];
    }
    return {
      lines,
      billed: async (billId, _today, now) => {
        collection.billed(billId, patient, now);
        await this.bookings.updateHomeCollection(collection);
      },
    };
  }

  /** The admission, locked as every charge to it and its final bill lock it: still in, and not billed. */
  async chargeable(admissionId: string, patientId: string): Promise<void> {
    const admission = await this.admissions.findForUpdate(admissionId);
    if (!admission) throw new NotFoundError('admission');
    if (admission.patientId !== patientId) {
      throw new DomainError('admission_mismatch', 'The admission is of another patient');
    }
    if (admission.status !== 'admitted') {
      throw new DomainError('admission_state', `Admission ${admission.number} is ${admission.status}`);
    }
    if (await this.indoor.liveBill(admissionId)) {
      throw new ConflictError('bill_made', `The final bill of ${admission.number} is made; it must be cancelled first`);
    }
  }

  /** A bank card's discount is for a patient paying their own (outpatient) bill, with a card in use. */
  async card(id: string, payer: 'corporate' | 'staff' | 'patient', admissionId: string | null) {
    if (payer !== 'patient' || admissionId) {
      throw new DomainError('invalid_payer', 'A card discount is for a patient paying their own bill');
    }
    const card = await this.bills.cardProvider(id);
    if (!card) throw new NotFoundError('card_provider');
    if (!card.isActive) throw new DomainError('inactive_card', `${card.name} cards are not taken now`);
    return card;
  }

  record(action: string, actorUserId: string, id: string, metadata: Record<string, string | number | null> = {}) {
    return this.opd.audit.record({
      action: `hospital.diagnostic_bill_${action}`,
      actorUserId,
      resourceType: 'diagnostic_bill',
      resourceId: id,
      metadata,
    });
  }

  /** The referring doctor's commission earned (+) or taken back (−) on the bill. */
  ledger(bill: DiagnosticBill, doctorId: string | null, amount: number, on: string): DoctorLedgerEntry[] {
    if (!doctorId || amount === 0) return [];
    return [
      {
        doctorId,
        entryOn: on,
        kind: amount > 0 ? 'share' : 'reversal',
        billId: null,
        diagnosticBillId: bill.id,
        documentNumber: bill.number,
        amount,
      },
    ];
  }
}

@CommandHandler(SetDiagnosticPolicyCommand)
export class SetDiagnosticPolicyHandler implements ICommandHandler<SetDiagnosticPolicyCommand> {
  constructor(private readonly desk: DiagnosticDesk) {}

  async execute({ actor, policy }: SetDiagnosticPolicyCommand): Promise<void> {
    const { opd } = this.desk;
    await opd.access.authorize(actor.userId, { permissions: [DIAG_MANAGE] });
    for (const percent of [policy.counterDiscountPercent, policy.defaultReferralPercent]) {
      if (!(percent >= 0 && percent <= 100)) throw new DomainError('invalid_policy', 'Percentages are 0 to 100');
    }
    await opd.tx.run(async () => {
      if (policy.homeCollectionTestId) {
        const service = (await this.desk.bookings.tests([policy.homeCollectionTestId])).get(
          policy.homeCollectionTestId,
        );
        if (!service) throw new NotFoundError('diagnostic_test');
        if (service.departmentKind !== 'other') {
          throw new DomainError(
            'not_a_service',
            `${service.name} is a test; the home collection charge is a service (a test of an 'other' department)`,
          );
        }
      }
      await this.desk.bills.savePolicy(policy, actor.userId, opd.clock.now());
      await opd.audit.record({
        action: 'hospital.diagnostic_policy_set',
        actorUserId: actor.userId,
        resourceType: 'diagnostic_policy',
        resourceId: '1',
        metadata: { ...policy },
      });
    });
  }
}

@QueryHandler(GetDiagnosticPolicyQuery)
export class GetDiagnosticPolicyHandler implements IQueryHandler<GetDiagnosticPolicyQuery> {
  constructor(private readonly desk: DiagnosticDesk) {}

  async execute({ actor }: GetDiagnosticPolicyQuery): Promise<DiagnosticPolicy> {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [DIAG_READ] });
    return this.desk.bills.policy();
  }
}

/** Old OPD Package Item page: the package's tests, each at its rate inside the package. */
@CommandHandler(SetPackageTestsCommand)
export class SetPackageTestsHandler implements ICommandHandler<SetPackageTestsCommand> {
  constructor(private readonly desk: DiagnosticDesk) {}

  async execute({ actor, packageId, tests }: SetPackageTestsCommand): Promise<void> {
    const { opd, bills } = this.desk;
    await opd.access.authorize(actor.userId, { permissions: [DIAG_MANAGE] });
    if (tests.length === 0 || tests.length > MAX_DIAGNOSTIC_LINES) {
      throw new DomainError('invalid_lines', `A package has 1 to ${MAX_DIAGNOSTIC_LINES} tests`);
    }
    if (new Set(tests.map((test) => test.testId)).size !== tests.length) {
      throw new DomainError('duplicate_test', 'A test is in the package twice');
    }
    tests.forEach((test) => validMoney(test.rate, 'rate'));
    await opd.tx.run(async () => {
      if (!(await bills.package(packageId))) throw new NotFoundError('diagnostic_package');
      const found = await bills.tests(tests.map((test) => test.testId));
      for (const test of tests) {
        const known = found.get(test.testId);
        if (!known) throw new NotFoundError('diagnostic_test');
        if (!known.isActive) throw new DomainError('inactive_test', `${known.name} is not in use`);
      }
      await bills.setPackageTests(packageId, tests);
      await opd.audit.record({
        action: 'hospital.diagnostic_package_tests_set',
        actorUserId: actor.userId,
        resourceType: 'diagnostic_package',
        resourceId: packageId,
        metadata: { tests: tests.length },
      });
    });
  }
}

@QueryHandler(GetPackageTestsQuery)
export class GetPackageTestsHandler implements IQueryHandler<GetPackageTestsQuery> {
  constructor(private readonly desk: DiagnosticDesk) {}

  async execute({ actor, packageId }: GetPackageTestsQuery) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [DIAG_READ] });
    const found = await this.desk.read.packageTests(packageId);
    if (!found) throw new NotFoundError('diagnostic_package');
    return found;
  }
}

/**
 * Old Investigation Invoice (CreateInvestigationInvoiceFullCommand, with a walk-in registered on the spot and no
 * voucher posted): tests and packages billed to a registered patient in one transaction. The referring doctor's
 * commission is theirs at once (the doctor's own percentage, else the test's, else the policy's); one voucher posts
 * the bill, the discount and the commission.
 */
@CommandHandler(CreateDiagnosticBillCommand)
export class CreateDiagnosticBillHandler implements ICommandHandler<CreateDiagnosticBillCommand> {
  constructor(private readonly desk: DiagnosticDesk) {}

  async execute({ actor, input }: CreateDiagnosticBillCommand) {
    const { desk } = this;
    const { opd, bills } = desk;
    await opd.access.authorize(actor.userId, { permissions: [DIAG_BILL] });
    if (input.discount !== null) validMoney(input.discount, 'discount');
    if (input.corporateClientId && input.staffId) {
      throw new DomainError('invalid_payer', 'A bill goes to a corporate client or to a staff member, not both');
    }
    if (input.testAppointmentId && input.homeCollectionId) {
      throw new DomainError('invalid_booking', 'A bill is for one booking at most');
    }
    if (input.admissionId && (input.testAppointmentId || input.homeCollectionId)) {
      throw new DomainError('indoor_bill', "An admitted patient's tests are not booked");
    }
    const mayDiscountMore = await opd.access.isAllowed(actor.userId, { permissions: [DIAG_DISCOUNT] });
    return opd.tx.run(async () => {
      const patient = await opd.appointments.patientContact(input.patientId);
      if (!patient) throw new NotFoundError('patient');
      if (input.admissionId) await desk.chargeable(input.admissionId, patient.id);
      const referrer = input.referredById
        ? (await opd.bills.doctors([input.referredById])).get(input.referredById)
        : null;
      if (input.referredById && !referrer) throw new NotFoundError('referring_doctor');
      if (referrer && !referrer.isActive) throw new DomainError('not_bookable', `${referrer.name} is not active`);
      // An admitted patient's tests go on the stay, whoever pays its final bill.
      const payer = input.admissionId
        ? await opd.payer(null, null)
        : await opd.payer(
            input.corporateClientId === undefined && !input.staffId
              ? patient.corporateClientId
              : (input.corporateClientId ?? null),
            input.staffId,
          );
      const policy = await bills.policy();
      const booking = await desk.booking(input, patient, policy.homeCollectionTestId);
      const picked: { testId: string; packageId: string | null; rate: number | null }[] = input.testIds.map(
        (testId) => ({ testId, packageId: null, rate: null }),
      );
      for (const packageId of new Set(input.packageIds)) {
        const found = await bills.package(packageId);
        if (!found) throw new NotFoundError('diagnostic_package');
        if (!found.isActive || found.tests.length === 0) {
          throw new DomainError('inactive_package', `${found.name} is not sold`);
        }
        picked.push(...found.tests.map((test) => ({ testId: test.testId, packageId, rate: test.rate })));
      }
      const tests = await bills.tests(picked.map((line) => line.testId));
      const lines = picked.map((line) => {
        const test = tests.get(line.testId);
        if (!test) throw new NotFoundError('diagnostic_test');
        if (!test.isActive) throw new DomainError('inactive_test', `${test.name} is not done now`);
        return {
          testId: test.id,
          packageId: line.packageId,
          rate: line.rate ?? test.rate,
          discountAllowed: test.discountAllowed,
          referralPercent: referrer?.referralPercent ?? test.referralPercent ?? policy.defaultReferralPercent,
          reportHours: test.reportHours,
        };
      });
      if (booking) lines.push(...booking.lines);
      // A corporate client's or a bank card's own discount is given on what may be discounted unless another is asked
      // for; it is also how far the counter may go.
      const client = payer.kind === 'corporate' ? payer.client : null;
      const card = input.cardProviderId ? await desk.card(input.cardProviderId, payer.kind, input.admissionId) : null;
      const own = client
        ? { label: `Corporate: ${client.name}`, percent: client.discountPercent }
        : card
          ? { label: `Card: ${card.name}`, percent: card.discountPercent }
          : null;
      const discountable = lines
        .filter((line) => line.discountAllowed)
        .reduce((total, line) => total + Math.round(line.rate * 100), 0);
      const ownDiscount = own ? Math.floor((discountable * own.percent) / 100) / 100 : 0;
      const today = opd.today();
      const bill = DiagnosticBill.create({
        id: randomUUID(),
        number: await opd.number('DB', today),
        patientId: patient.id,
        billedOn: today,
        referredById: referrer?.id ?? null,
        payer: payer.payer,
        admissionId: input.admissionId,
        cardProviderId: card?.id ?? null,
        lines,
        discount: input.discount ?? (input.admissionId ? 0 : ownDiscount),
        discountReason: input.discountReason ?? (input.discount === null && ownDiscount > 0 ? own!.label : null),
        discountLimitPercent: Math.max(policy.counterDiscountPercent, own?.percent ?? 0),
        mayDiscountMore,
        payment: input.payment,
        by: actor.userId,
        now: opd.clock.now(),
      });
      if (client?.payment === 'credit' && client.creditLimit !== null) {
        const owed = await opd.corporate.owed(client.id);
        if (owed + bill.due > client.creditLimit) {
          throw new DomainError(
            'credit_limit',
            `${client.name} owes ${owed.toFixed(2)}; with ${bill.due.toFixed(2)} more it is over its limit of ${client.creditLimit.toFixed(2)}`,
          );
        }
      }
      const header = bill.toSnapshot();
      const narration = `Diagnostic bill ${header.number}`;
      const voucher = await opd.post(
        narration,
        today,
        header.id,
        [
          ...(input.payment && header.paid > 0
            ? [{ account: { role: OPD_RECEIPT_ROLES[input.payment.method] }, debit: header.paid, credit: 0, narration }]
            : []),
          { account: { role: receivableRole(bill) }, debit: bill.due, credit: 0, narration },
          { account: { role: DIAGNOSTIC_DISCOUNT_ROLE }, debit: header.discount, credit: 0, narration },
          { account: { role: DIAGNOSTIC_INCOME_ROLE }, debit: 0, credit: header.gross, narration },
          { account: { role: REFERRAL_COMMISSION_ROLE }, debit: bill.commission, credit: 0, narration },
          { account: { role: CONSULTANT_PAYABLE_ROLE }, debit: 0, credit: bill.commission, narration },
        ],
        actor,
      );
      bill.posted(voucher?.number ?? null);
      await bills.insert(bill);
      if (input.payment && header.paid > 0) {
        await bills.addPayment({
          billId: bill.id,
          kind: 'payment',
          number: null,
          method: input.payment.method,
          reference: text(input.payment.reference, 100, 'payment reference'),
          amount: header.paid,
          paidOn: today,
          receivedBy: actor.userId,
          voucherNumber: voucher?.number ?? null,
        });
      }
      await booking?.billed(bill.id, today, opd.clock.now());
      await opd.bills.addLedger(desk.ledger(bill, header.referredById, bill.commission, today));
      await opd.bills.addUhidUse({
        patientId: patient.id,
        usedOn: today,
        service: 'diagnostic',
        documentNumber: header.number,
      });
      await desk.record('created', actor.userId, bill.id, {
        number: header.number,
        net: header.net,
        tests: lines.length,
        voucher: voucher?.number ?? null,
        booking: input.testAppointmentId ?? input.homeCollectionId ?? null,
      });
      return { id: bill.id, number: header.number, net: header.net, due: bill.due };
    });
  }
}

/** Old Diagnostic Due Collection: a due collected later, with its own receipt number and voucher. */
@CommandHandler(CollectDiagnosticDueCommand)
export class CollectDiagnosticDueHandler implements ICommandHandler<CollectDiagnosticDueCommand> {
  constructor(private readonly desk: DiagnosticDesk) {}

  async execute({ actor, id, version, money }: CollectDiagnosticDueCommand) {
    const { desk } = this;
    const { opd } = desk;
    await opd.access.authorize(actor.userId, { permissions: [DIAG_BILL] });
    return opd.tx.run(async () => {
      const bill = await desk.bills.findForUpdate(id);
      if (!bill) throw new NotFoundError('diagnostic_bill');
      bill.assertVersion(version);
      const today = opd.today();
      const amount = bill.collect(money.amount, today, opd.clock.now());
      const number = await opd.number('DR', today);
      const narration = `Due collected on ${bill.number} (${number})`;
      const voucher = await opd.post(
        narration,
        today,
        bill.id,
        [
          { account: { role: OPD_RECEIPT_ROLES[money.method] }, debit: amount, credit: 0, narration },
          { account: { role: receivableRole(bill) }, debit: 0, credit: amount, narration },
        ],
        actor,
      );
      await desk.bills.update(bill);
      await desk.bills.addPayment({
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
      await desk.record('collected', actor.userId, id, { number, amount, method: money.method });
      return { number, due: bill.due };
    });
  }
}

/**
 * Old investigation cancel (approved, then done; Cancel, DiscountAdjustment and Refund rows): named tests, or all,
 * cancelled with a reason. Their income, discount and commission come back; what they were worth comes off the due,
 * and money beyond what is left is given back by the method asked for.
 */
@CommandHandler(CancelDiagnosticTestsCommand)
export class CancelDiagnosticTestsHandler implements ICommandHandler<CancelDiagnosticTestsCommand> {
  constructor(private readonly desk: DiagnosticDesk) {}

  async execute({ actor, id, version, lines, reason, refundMethod }: CancelDiagnosticTestsCommand) {
    const { desk } = this;
    const { opd } = desk;
    await opd.access.authorize(actor.userId, { permissions: [DIAG_BILL] });
    const mayCancelLater = await opd.access.isAllowed(actor.userId, { permissions: [DIAG_MANAGE] });
    return opd.tx.run(async () => {
      const bill = await desk.bills.findForUpdate(id);
      if (!bill) throw new NotFoundError('diagnostic_bill');
      bill.assertVersion(version);
      const header = bill.toSnapshot();
      if (header.admissionId) await desk.chargeable(header.admissionId, header.patientId);
      const today = opd.today();
      const cancelled = bill.cancelTests({ lines, reason, on: today, mayCancelLater, now: opd.clock.now() });
      const narration = `Tests cancelled on ${header.number}`;
      const voucher = await opd.post(
        narration,
        today,
        bill.id,
        [
          { account: { role: DIAGNOSTIC_INCOME_ROLE }, debit: cancelled.gross, credit: 0, narration },
          { account: { role: DIAGNOSTIC_DISCOUNT_ROLE }, debit: 0, credit: cancelled.discount, narration },
          { account: { role: receivableRole(bill) }, debit: 0, credit: cancelled.dueCleared, narration },
          { account: { role: OPD_RECEIPT_ROLES[refundMethod] }, debit: 0, credit: cancelled.refund, narration },
          { account: { role: CONSULTANT_PAYABLE_ROLE }, debit: cancelled.commission, credit: 0, narration },
          { account: { role: REFERRAL_COMMISSION_ROLE }, debit: 0, credit: cancelled.commission, narration },
        ],
        actor,
      );
      await desk.bills.update(bill);
      if (cancelled.refund > 0) {
        await desk.bills.addPayment({
          billId: bill.id,
          kind: 'refund',
          number: null,
          method: refundMethod,
          reference: null,
          amount: cancelled.refund,
          paidOn: today,
          receivedBy: actor.userId,
          voucherNumber: voucher?.number ?? null,
        });
      }
      await opd.bills.addLedger(desk.ledger(bill, header.referredById, -cancelled.commission, today));
      await desk.record('tests_cancelled', actor.userId, id, {
        lines: cancelled.positions.join(','),
        reason,
        refunded: cancelled.refund,
        voucher: voucher?.number ?? null,
      });
      return { refunded: cancelled.refund, due: bill.due };
    });
  }
}

@QueryHandler(ListDiagnosticBillsQuery)
export class ListDiagnosticBillsHandler implements IQueryHandler<ListDiagnosticBillsQuery> {
  constructor(private readonly desk: DiagnosticDesk) {}

  async execute({ actor, filter }: ListDiagnosticBillsQuery) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [DIAG_READ] });
    return this.desk.read.list(filter);
  }
}

@QueryHandler(GetDiagnosticBillQuery)
export class GetDiagnosticBillHandler implements IQueryHandler<GetDiagnosticBillQuery> {
  constructor(private readonly desk: DiagnosticDesk) {}

  async execute({ actor, id }: GetDiagnosticBillQuery) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [DIAG_READ] });
    const bill = await this.desk.read.get(id);
    if (!bill) throw new NotFoundError('diagnostic_bill');
    return bill;
  }
}

export const DIAGNOSTIC_HANDLERS = [
  DiagnosticDesk,
  SetDiagnosticPolicyHandler,
  GetDiagnosticPolicyHandler,
  SetPackageTestsHandler,
  GetPackageTestsHandler,
  CreateDiagnosticBillHandler,
  CollectDiagnosticDueHandler,
  CancelDiagnosticTestsHandler,
  ListDiagnosticBillsHandler,
  GetDiagnosticBillHandler,
];
