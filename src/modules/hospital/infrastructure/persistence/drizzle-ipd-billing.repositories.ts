import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  IpdBillingReadRepository,
  type IpdBillFilter,
  type IpdBillSummary,
  type IpdBillView,
  type IpdChargeView,
  type IpdPaymentView,
  type IpdReceipt,
} from '../../application/ipd-billing.messages.js';
import { HOSPITAL_SETTINGS, type HospitalSettings } from '../../application/patient.handlers.js';
import { IpdBill, type IpdBillLine, type IpdCharge, type StayDays } from '../../domain/ipd-bill.js';
import { IpdBillingRepository, type ChargeEntry, type IpdPayment, type IpdPolicy } from '../../domain/repositories.js';
import {
  admissions,
  bedCategories,
  beds,
  bedStays,
  corporateClients,
  doctors,
  ipdBillLines,
  ipdBills,
  ipdCharges,
  ipdPayments,
  ipdPolicy,
  patients,
  services,
} from './hospital.schema.js';

/** The policy before anyone set one: no round fee or service charge, 10 % at the counter (as at the OPD). */
const DEFAULT_POLICY: IpdPolicy = {
  roundFeePerNight: 0,
  serviceChargePercent: 0,
  counterDiscountPercent: 10,
  visitorPassLimit: 2,
};

const lineColumns = {
  head: ipdBillLines.head,
  description: ipdBillLines.description,
  bedId: ipdBillLines.bedId,
  chargeId: ipdBillLines.chargeId,
  serviceId: ipdBillLines.serviceId,
  doctorId: ipdBillLines.doctorId,
  fromOn: ipdBillLines.fromOn,
  toOn: ipdBillLines.toOn,
  qty: ipdBillLines.qty,
  rate: ipdBillLines.rate,
  amount: ipdBillLines.amount,
  serviceCharge: ipdBillLines.serviceCharge,
  shareAmount: ipdBillLines.shareAmount,
};

@Injectable()
export class DrizzleIpdBillingRepository extends IpdBillingRepository {
  constructor(
    private readonly context: DbContext,
    @Inject(HOSPITAL_SETTINGS) private readonly settings: HospitalSettings,
  ) {
    super();
  }

  async policy(): Promise<IpdPolicy> {
    const [row] = await this.context.db
      .select({
        roundFeePerNight: ipdPolicy.roundFeePerNight,
        serviceChargePercent: ipdPolicy.serviceChargePercent,
        counterDiscountPercent: ipdPolicy.counterDiscountPercent,
        visitorPassLimit: ipdPolicy.visitorPassLimit,
      })
      .from(ipdPolicy)
      .where(eq(ipdPolicy.id, 1));
    return row ?? DEFAULT_POLICY;
  }

  async savePolicy(policy: IpdPolicy, by: string, now: Date): Promise<void> {
    const values = { ...policy, updatedAt: now, updatedBy: by };
    await this.context.db
      .insert(ipdPolicy)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: ipdPolicy.id, set: values });
  }

  async insertCharge(charge: ChargeEntry): Promise<void> {
    const { serviceName: _name, ...row } = charge;
    await this.context.db.insert(ipdCharges).values({ ...row, status: 'active' });
  }

  async charge(id: string) {
    const [row] = await this.context.db
      .select({ admissionId: ipdCharges.admissionId, status: ipdCharges.status })
      .from(ipdCharges)
      .where(eq(ipdCharges.id, id));
    return row ?? null;
  }

  async cancelCharge(id: string, reason: string, by: string, at: Date): Promise<void> {
    await this.context.db
      .update(ipdCharges)
      .set({ status: 'cancelled', cancelReason: reason, cancelledBy: by, cancelledAt: at })
      .where(eq(ipdCharges.id, id));
  }

  async activeCharges(admissionId: string): Promise<IpdCharge[]> {
    return this.context.db
      .select({
        id: ipdCharges.id,
        serviceId: ipdCharges.serviceId,
        serviceName: services.name,
        doctorId: ipdCharges.doctorId,
        chargedOn: ipdCharges.chargedOn,
        qty: ipdCharges.qty,
        rate: ipdCharges.rate,
        amount: ipdCharges.amount,
        sharePercent: ipdCharges.sharePercent,
      })
      .from(ipdCharges)
      .innerJoin(services, eq(services.id, ipdCharges.serviceId))
      .where(and(eq(ipdCharges.admissionId, admissionId), eq(ipdCharges.status, 'active')))
      .orderBy(asc(ipdCharges.chargedOn), asc(ipdCharges.createdAt));
  }

  async stays(admissionId: string): Promise<StayDays[]> {
    const local = (at: typeof bedStays.fromAt | typeof bedStays.toAt) =>
      sql<string>`to_char(${at} at time zone ${this.settings.timeZone}, 'YYYY-MM-DD')`;
    return this.context.db
      .select({
        bedId: bedStays.bedId,
        bedCode: beds.code,
        fromOn: local(bedStays.fromAt),
        toOn: sql<string | null>`case when ${bedStays.toAt} is null then null else ${local(bedStays.toAt)} end`,
        rate: bedStays.dailyRate,
        intensive: bedCategories.isIntensive,
      })
      .from(bedStays)
      .innerJoin(beds, eq(beds.id, bedStays.bedId))
      .innerJoin(bedCategories, eq(bedCategories.id, beds.categoryId))
      .where(eq(bedStays.admissionId, admissionId))
      .orderBy(asc(bedStays.fromAt));
  }

  async received(admissionId: string): Promise<number> {
    const [row] = await this.context.db
      .select({
        total:
          sql<number>`coalesce(sum(case when ${ipdPayments.kind} = 'refund' then -${ipdPayments.amount} else ${ipdPayments.amount} end), 0)`.mapWith(
            Number,
          ),
      })
      .from(ipdPayments)
      .where(eq(ipdPayments.admissionId, admissionId));
    return row?.total ?? 0;
  }

  async addPayment(payment: IpdPayment): Promise<void> {
    await this.context.db.insert(ipdPayments).values({ ...payment, id: randomUUID() });
  }

  async liveBill(admissionId: string): Promise<IpdBill | null> {
    const [row] = await this.context.db
      .select({ id: ipdBills.id })
      .from(ipdBills)
      .where(and(eq(ipdBills.admissionId, admissionId), eq(ipdBills.status, 'billed')));
    return row ? this.billForUpdate(row.id) : null;
  }

  async billForUpdate(id: string): Promise<IpdBill | null> {
    const [row] = await this.context.db.select().from(ipdBills).where(eq(ipdBills.id, id)).for('update');
    if (!row) return null;
    const lines: IpdBillLine[] = await this.context.db
      .select(lineColumns)
      .from(ipdBillLines)
      .where(eq(ipdBillLines.billId, id))
      .orderBy(asc(ipdBillLines.position));
    return IpdBill.restore({ ...row, lines });
  }

  async insertBill(bill: IpdBill): Promise<void> {
    const { lines, ...row } = bill.toSnapshot();
    await this.context.db.insert(ipdBills).values(row);
    if (lines.length > 0) {
      await this.context.db
        .insert(ipdBillLines)
        .values(lines.map((line, index) => ({ ...line, billId: row.id, position: index + 1 })));
    }
  }

  async updateBill(bill: IpdBill): Promise<void> {
    const { lines: _lines, id, ...row } = bill.toSnapshot();
    await this.context.db.update(ipdBills).set(row).where(eq(ipdBills.id, id));
  }
}

const due = sql<number>`${ipdBills.net} - ${ipdBills.deposit} - ${ipdBills.paid} - ${ipdBills.collected}`.mapWith(
  Number,
);

@Injectable()
export class DrizzleIpdBillingReadRepository extends IpdBillingReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async charges(admissionId: string): Promise<IpdChargeView[]> {
    return this.context.db
      .select({
        id: ipdCharges.id,
        serviceId: ipdCharges.serviceId,
        serviceName: services.name,
        doctorId: ipdCharges.doctorId,
        doctorName: doctors.name,
        chargedOn: ipdCharges.chargedOn,
        qty: ipdCharges.qty,
        rate: ipdCharges.rate,
        amount: ipdCharges.amount,
        note: ipdCharges.note,
        status: ipdCharges.status,
        cancelReason: ipdCharges.cancelReason,
      })
      .from(ipdCharges)
      .innerJoin(services, eq(services.id, ipdCharges.serviceId))
      .leftJoin(doctors, eq(doctors.id, ipdCharges.doctorId))
      .where(eq(ipdCharges.admissionId, admissionId))
      .orderBy(asc(ipdCharges.chargedOn), asc(ipdCharges.createdAt));
  }

  async payments(admissionId: string): Promise<IpdPaymentView[]> {
    return this.context.db
      .select({
        number: ipdPayments.number,
        kind: ipdPayments.kind,
        method: ipdPayments.method,
        reference: ipdPayments.reference,
        amount: ipdPayments.amount,
        paidOn: ipdPayments.paidOn,
        billNumber: ipdBills.number,
      })
      .from(ipdPayments)
      .leftJoin(ipdBills, eq(ipdBills.id, ipdPayments.billId))
      .where(eq(ipdPayments.admissionId, admissionId))
      .orderBy(asc(ipdPayments.createdAt));
  }

  async doctorNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({ id: doctors.id, name: doctors.name })
      .from(doctors)
      .where(inArray(doctors.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  async liveBillId(admissionId: string): Promise<string | null> {
    const [row] = await this.context.db
      .select({ id: ipdBills.id })
      .from(ipdBills)
      .where(and(eq(ipdBills.admissionId, admissionId), eq(ipdBills.status, 'billed')));
    return row?.id ?? null;
  }

  private summaries() {
    return this.context.db
      .select({
        id: ipdBills.id,
        number: ipdBills.number,
        billedOn: ipdBills.billedOn,
        admissionId: ipdBills.admissionId,
        admissionNumber: admissions.number,
        patientId: ipdBills.patientId,
        uhid: patients.uhid,
        patientName: patients.fullName,
        net: ipdBills.net,
        deposit: ipdBills.deposit,
        paid: ipdBills.paid,
        collected: ipdBills.collected,
        due,
        status: ipdBills.status,
        corporateClientId: ipdBills.corporateClientId,
        corporateClientName: corporateClients.name,
        staffId: ipdBills.staffId,
        version: ipdBills.version,
      })
      .from(ipdBills)
      .innerJoin(admissions, eq(admissions.id, ipdBills.admissionId))
      .innerJoin(patients, eq(patients.id, ipdBills.patientId))
      .leftJoin(corporateClients, eq(corporateClients.id, ipdBills.corporateClientId));
  }

  async list(filter: IpdBillFilter): Promise<Page<IpdBillSummary>> {
    const where = and(
      filter.patientId ? eq(ipdBills.patientId, filter.patientId) : undefined,
      filter.from ? gte(ipdBills.billedOn, filter.from) : undefined,
      filter.to ? lte(ipdBills.billedOn, filter.to) : undefined,
      filter.status ? eq(ipdBills.status, filter.status) : undefined,
      filter.withDue ? and(eq(ipdBills.status, 'billed'), sql`${due} > 0`) : undefined,
      filter.corporateClientId ? eq(ipdBills.corporateClientId, filter.corporateClientId) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.summaries()
        .where(where)
        .orderBy(desc(ipdBills.billedOn), desc(ipdBills.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(ipdBills).where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async get(id: string): Promise<IpdBillView | null> {
    const [summary] = await this.summaries().where(eq(ipdBills.id, id));
    if (!summary) return null;
    // One query at a time: this is also read inside a transaction, on its one connection.
    const [header] = await this.context.db
      .select({
        nights: ipdBills.nights,
        gross: ipdBills.gross,
        serviceCharge: ipdBills.serviceCharge,
        discount: ipdBills.discount,
        discountReason: ipdBills.discountReason,
        cancelReason: ipdBills.cancelReason,
        cancelledOn: ipdBills.cancelledOn,
        voucherNumber: ipdBills.voucherNumber,
        cancelVoucherNumber: ipdBills.cancelVoucherNumber,
        billedBy: ipdBills.billedBy,
        createdAt: ipdBills.createdAt,
      })
      .from(ipdBills)
      .where(eq(ipdBills.id, id));
    const lines = await this.context.db
      .select({
        head: ipdBillLines.head,
        description: ipdBillLines.description,
        doctorId: ipdBillLines.doctorId,
        doctorName: doctors.name,
        fromOn: ipdBillLines.fromOn,
        toOn: ipdBillLines.toOn,
        qty: ipdBillLines.qty,
        rate: ipdBillLines.rate,
        amount: ipdBillLines.amount,
        serviceCharge: ipdBillLines.serviceCharge,
        shareAmount: ipdBillLines.shareAmount,
      })
      .from(ipdBillLines)
      .leftJoin(doctors, eq(doctors.id, ipdBillLines.doctorId))
      .where(eq(ipdBillLines.billId, id))
      .orderBy(asc(ipdBillLines.position));
    return { ...summary, ...header!, lines };
  }

  async receipt(number: string): Promise<IpdReceipt | null> {
    const [row] = await this.context.db
      .select({
        number: ipdPayments.number,
        kind: ipdPayments.kind,
        method: ipdPayments.method,
        reference: ipdPayments.reference,
        amount: ipdPayments.amount,
        paidOn: ipdPayments.paidOn,
        billNumber: ipdBills.number,
        admissionNumber: admissions.number,
        patientName: patients.fullName,
        uhid: patients.uhid,
        receivedBy: ipdPayments.receivedBy,
        createdAt: ipdPayments.createdAt,
      })
      .from(ipdPayments)
      .innerJoin(admissions, eq(admissions.id, ipdPayments.admissionId))
      .innerJoin(patients, eq(patients.id, admissions.patientId))
      .leftJoin(ipdBills, eq(ipdBills.id, ipdPayments.billId))
      .where(eq(ipdPayments.number, number));
    return row ?? null;
  }
}
