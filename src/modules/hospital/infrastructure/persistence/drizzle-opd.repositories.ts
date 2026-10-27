import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, count, desc, eq, gte, inArray, isNotNull, lte, max, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  OpdBillReadRepository,
  type DoctorLedgerView,
  type OpdBillFilter,
  type OpdBillSummary,
  type OpdBillView,
} from '../../application/opd.messages.js';
import { OpdBill } from '../../domain/opd-bill.js';
import {
  OpdBillRepository,
  type BillableDoctor,
  type BillableService,
  type CorporateClient,
  type CorporateDueBill,
  type DoctorPayment,
  type DoctorLedgerEntry,
  type OpdPolicy,
} from '../../domain/repositories.js';
import {
  corporateClients,
  doctorLedger,
  doctorPayments,
  doctors,
  hospitalSequences,
  ipdBills,
  opdBillLines,
  opdBills,
  opdPayments,
  opdPolicy,
  patients,
  services,
  uhidUses,
} from './hospital.schema.js';

/** The policy before anyone set one: the old 40 % share, a month for follow-ups, 10 % at the counter. */
const DEFAULT_POLICY: OpdPolicy = { followUpDays: 30, defaultSharePercent: 40, counterDiscountPercent: 10 };

@Injectable()
export class DrizzleOpdBillRepository extends OpdBillRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<OpdBill | null> {
    const [row] = await this.context.db.select().from(opdBills).where(eq(opdBills.id, id)).for('update');
    if (!row) return null;
    const [lines, payments] = await Promise.all([
      this.context.db
        .select({
          doctorId: opdBillLines.doctorId,
          visitType: opdBillLines.visitType,
          serviceId: opdBillLines.serviceId,
          qty: opdBillLines.qty,
          rate: opdBillLines.rate,
          fee: opdBillLines.fee,
          sharePercent: opdBillLines.sharePercent,
          shareAmount: opdBillLines.shareAmount,
        })
        .from(opdBillLines)
        .where(eq(opdBillLines.billId, id))
        .orderBy(asc(opdBillLines.position)),
      this.context.db
        .select({
          kind: opdPayments.kind,
          number: opdPayments.number,
          method: opdPayments.method,
          reference: opdPayments.reference,
          amount: opdPayments.amount,
          paidOn: opdPayments.paidOn,
        })
        .from(opdPayments)
        .where(eq(opdPayments.billId, id))
        .orderBy(asc(opdPayments.createdAt)),
    ]);
    return OpdBill.restore({ ...row, lines }, payments);
  }

  async insert(bill: OpdBill, by: string): Promise<void> {
    const { lines, ...row } = bill.toSnapshot();
    await this.context.db.insert(opdBills).values(row);
    await this.context.db
      .insert(opdBillLines)
      .values(lines.map((line, position) => ({ ...line, billId: row.id, position })));
    await this.savePayments(bill, by, row.voucherNumber);
  }

  async update(bill: OpdBill, by: string, voucherNumber: string | null): Promise<void> {
    const { lines: _lines, id, ...row } = bill.toSnapshot();
    await this.context.db.update(opdBills).set(row).where(eq(opdBills.id, id));
    await this.savePayments(bill, by, voucherNumber);
  }

  private async savePayments(bill: OpdBill, by: string, voucherNumber: string | null): Promise<void> {
    const fresh = bill.newPayments;
    if (fresh.length > 0) {
      await this.context.db.insert(opdPayments).values(
        fresh.map((payment) => ({
          ...payment,
          id: randomUUID(),
          billId: bill.id,
          receivedBy: by,
          voucherNumber,
        })),
      );
    }
    bill.paymentsSaved();
  }

  async nextSerial(kind: string, year: number): Promise<number> {
    const [row] = await this.context.db
      .insert(hospitalSequences)
      .values({ kind, year, last: 1 })
      .onConflictDoUpdate({
        target: [hospitalSequences.kind, hospitalSequences.year],
        set: { last: sql`${hospitalSequences.last} + 1` },
      })
      .returning({ last: hospitalSequences.last });
    return row!.last;
  }

  async policy(): Promise<OpdPolicy> {
    const [row] = await this.context.db
      .select({
        followUpDays: opdPolicy.followUpDays,
        defaultSharePercent: opdPolicy.defaultSharePercent,
        counterDiscountPercent: opdPolicy.counterDiscountPercent,
      })
      .from(opdPolicy)
      .where(eq(opdPolicy.id, 1));
    return row ?? DEFAULT_POLICY;
  }

  async savePolicy(policy: OpdPolicy, by: string, now: Date): Promise<void> {
    const values = { ...policy, updatedAt: now, updatedBy: by };
    await this.context.db
      .insert(opdPolicy)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: opdPolicy.id, set: values });
  }

  async doctors(ids: readonly string[]): Promise<Map<string, BillableDoctor>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        id: doctors.id,
        name: doctors.name,
        isActive: doctors.isActive,
        isConsultant: doctors.isConsultant,
        firstVisitFee: doctors.firstVisitFee,
        newVisitFee: doctors.newVisitFee,
        followUpFee: doctors.followUpFee,
        reportFee: doctors.reportFee,
        sharePercent: doctors.sharePercent,
      })
      .from(doctors)
      .where(inArray(doctors.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async services(ids: readonly string[]): Promise<Map<string, BillableService>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        id: services.id,
        name: services.name,
        rate: services.rate,
        sharePercent: services.sharePercent,
        isOpd: services.isOpd,
        isIpd: services.isIpd,
        isActive: services.isActive,
      })
      .from(services)
      .where(inArray(services.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async corporateClient(id: string): Promise<CorporateClient | null> {
    const [row] = await this.context.db
      .select({
        id: corporateClients.id,
        name: corporateClients.name,
        payment: corporateClients.payment,
        creditLimit: corporateClients.creditLimit,
        discountPercent: corporateClients.discountPercent,
        isActive: corporateClients.isActive,
      })
      .from(corporateClients)
      .where(eq(corporateClients.id, id));
    return row ?? null;
  }

  async corporateDue(clientId: string): Promise<number> {
    const owed = (await this.dueBills(clientId)).reduce((total, bill) => total + Math.round(bill.due * 100), 0);
    return owed / 100;
  }

  async dueBills(clientId: string): Promise<CorporateDueBill[]> {
    const rows = await this.context.db.execute<{ kind: 'opd' | 'ipd'; id: string; due: string }>(sql`
      select 'opd' as kind, ${opdBills.id} as id, ${opdBills.billedOn} as billed_on, ${opdBills.number} as number,
        ${opdBills.net} - ${opdBills.paid} - ${opdBills.collected} as due
      from ${opdBills}
      where ${opdBills.corporateClientId} = ${clientId} and ${opdBills.status} = 'billed'
        and ${opdBills.net} - ${opdBills.paid} - ${opdBills.collected} > 0
      union all
      select 'ipd', ${ipdBills.id}, ${ipdBills.billedOn}, ${ipdBills.number},
        ${ipdBills.net} - ${ipdBills.deposit} - ${ipdBills.paid} - ${ipdBills.collected}
      from ${ipdBills}
      where ${ipdBills.corporateClientId} = ${clientId} and ${ipdBills.status} = 'billed'
        and ${ipdBills.net} - ${ipdBills.deposit} - ${ipdBills.paid} - ${ipdBills.collected} > 0
      order by billed_on, number`);
    return rows.rows.map((row) => ({ kind: row.kind, id: row.id, due: Number(row.due) }));
  }

  async doctorBalance(doctorId: string): Promise<number> {
    const [row] = await this.context.db
      .select({ balance: sql<number>`coalesce(sum(${doctorLedger.amount}), 0)`.mapWith(Number) })
      .from(doctorLedger)
      .where(eq(doctorLedger.doctorId, doctorId));
    return Math.round((row?.balance ?? 0) * 100) / 100;
  }

  async addDoctorPayment(payment: DoctorPayment): Promise<void> {
    await this.context.db.insert(doctorPayments).values({ ...payment, id: randomUUID() });
    await this.context.db.insert(doctorLedger).values({
      id: randomUUID(),
      doctorId: payment.doctorId,
      entryOn: payment.paidOn,
      kind: 'payment',
      billId: null,
      documentNumber: payment.number,
      amount: -payment.amount,
    });
  }

  async lastVisitOn(patientId: string, doctorId: string): Promise<string | null> {
    const [row] = await this.context.db
      .select({ on: max(opdBills.billedOn) })
      .from(opdBillLines)
      .innerJoin(opdBills, eq(opdBills.id, opdBillLines.billId))
      .where(
        and(
          eq(opdBills.patientId, patientId),
          eq(opdBillLines.doctorId, doctorId),
          // Consultations only: a service the doctor gave is not a visit to them.
          isNotNull(opdBillLines.visitType),
          eq(opdBills.status, 'billed'),
        ),
      );
    return row?.on ?? null;
  }

  async addLedger(entries: readonly DoctorLedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.context.db.insert(doctorLedger).values(entries.map((entry) => ({ ...entry, id: randomUUID() })));
  }

  async addUhidUse(use: { patientId: string; usedOn: string; service: string; documentNumber: string }) {
    await this.context.db.insert(uhidUses).values({ ...use, id: randomUUID() });
  }
}

const referrers = aliasedTable(doctors, 'referrers');
const due = sql<number>`${opdBills.net} - ${opdBills.paid} - ${opdBills.collected}`.mapWith(Number);

@Injectable()
export class DrizzleOpdBillReadRepository extends OpdBillReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async doctorLedger(doctorId: string, from: string, to: string): Promise<DoctorLedgerView | null> {
    const [doctor] = await this.context.db.select({ name: doctors.name }).from(doctors).where(eq(doctors.id, doctorId));
    if (!doctor) return null;
    const [before] = await this.context.db
      .select({ amount: sql<number>`coalesce(sum(${doctorLedger.amount}), 0)`.mapWith(Number) })
      .from(doctorLedger)
      .where(and(eq(doctorLedger.doctorId, doctorId), sql`${doctorLedger.entryOn} < ${from}`));
    const rows = await this.context.db
      .select({
        entryOn: doctorLedger.entryOn,
        kind: doctorLedger.kind,
        documentNumber: doctorLedger.documentNumber,
        amount: doctorLedger.amount,
      })
      .from(doctorLedger)
      .where(and(eq(doctorLedger.doctorId, doctorId), gte(doctorLedger.entryOn, from), lte(doctorLedger.entryOn, to)))
      .orderBy(asc(doctorLedger.entryOn), asc(doctorLedger.createdAt));
    const cents = (value: number) => Math.round(value * 100);
    let balance = cents(before?.amount ?? 0);
    const totals = { share: 0, reversal: 0, payment: 0 };
    const entries = rows.map((row) => {
      balance += cents(row.amount);
      totals[row.kind] += cents(row.amount);
      return { ...row, balance: balance / 100 };
    });
    return {
      doctorId,
      doctorName: doctor.name,
      from,
      to,
      opening: cents(before?.amount ?? 0) / 100,
      entries,
      earned: totals.share / 100,
      reversed: -totals.reversal / 100,
      paid: -totals.payment / 100,
      closing: balance / 100,
    };
  }

  private summaries() {
    return this.context.db
      .select({
        id: opdBills.id,
        number: opdBills.number,
        billedOn: opdBills.billedOn,
        patientId: opdBills.patientId,
        uhid: patients.uhid,
        patientName: patients.fullName,
        gross: opdBills.gross,
        discount: opdBills.discount,
        net: opdBills.net,
        paid: opdBills.paid,
        collected: opdBills.collected,
        due,
        status: opdBills.status,
        corporateClientId: opdBills.corporateClientId,
        corporateClientName: corporateClients.name,
        staffId: opdBills.staffId,
        version: opdBills.version,
      })
      .from(opdBills)
      .innerJoin(patients, eq(patients.id, opdBills.patientId))
      .leftJoin(corporateClients, eq(corporateClients.id, opdBills.corporateClientId));
  }

  async list(filter: OpdBillFilter): Promise<Page<OpdBillSummary>> {
    const where = and(
      filter.patientId ? eq(opdBills.patientId, filter.patientId) : undefined,
      filter.doctorId
        ? sql`exists (select 1 from ${opdBillLines} where ${opdBillLines.billId} = ${opdBills.id} and ${opdBillLines.doctorId} = ${filter.doctorId})`
        : undefined,
      filter.from ? gte(opdBills.billedOn, filter.from) : undefined,
      filter.to ? lte(opdBills.billedOn, filter.to) : undefined,
      filter.status ? eq(opdBills.status, filter.status) : undefined,
      filter.withDue ? and(eq(opdBills.status, 'billed'), sql`${due} > 0`) : undefined,
      filter.corporateClientId ? eq(opdBills.corporateClientId, filter.corporateClientId) : undefined,
      filter.staffId ? eq(opdBills.staffId, filter.staffId) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.summaries()
        .where(where)
        .orderBy(desc(opdBills.billedOn), desc(opdBills.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db
        .select({ n: count() })
        .from(opdBills)
        .innerJoin(patients, eq(patients.id, opdBills.patientId))
        .where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async get(id: string): Promise<OpdBillView | null> {
    const [header] = await this.context.db
      .select({
        id: opdBills.id,
        number: opdBills.number,
        billedOn: opdBills.billedOn,
        patientId: opdBills.patientId,
        uhid: patients.uhid,
        patientName: patients.fullName,
        mobileNo: sql<string | null>`coalesce(${patients.mobileNo}, ${patients.contactMobileNo})`,
        sex: patients.sex,
        dateOfBirth: patients.dateOfBirth,
        appointmentId: opdBills.appointmentId,
        referredById: opdBills.referredById,
        referredByName: referrers.name,
        gross: opdBills.gross,
        discount: opdBills.discount,
        discountReason: opdBills.discountReason,
        net: opdBills.net,
        paid: opdBills.paid,
        collected: opdBills.collected,
        due,
        status: opdBills.status,
        corporateClientId: opdBills.corporateClientId,
        corporateClientName: corporateClients.name,
        staffId: opdBills.staffId,
        cancelReason: opdBills.cancelReason,
        cancelledOn: opdBills.cancelledOn,
        refunded: opdBills.refunded,
        voucherNumber: opdBills.voucherNumber,
        cancelVoucherNumber: opdBills.cancelVoucherNumber,
        billedBy: opdBills.billedBy,
        createdAt: opdBills.createdAt,
        version: opdBills.version,
      })
      .from(opdBills)
      .innerJoin(patients, eq(patients.id, opdBills.patientId))
      .leftJoin(referrers, eq(referrers.id, opdBills.referredById))
      .leftJoin(corporateClients, eq(corporateClients.id, opdBills.corporateClientId))
      .where(eq(opdBills.id, id));
    if (!header) return null;
    const [lines, payments] = await Promise.all([
      this.context.db
        .select({
          position: opdBillLines.position,
          doctorId: opdBillLines.doctorId,
          doctorName: doctors.name,
          roomNo: doctors.roomNo,
          visitType: opdBillLines.visitType,
          serviceId: opdBillLines.serviceId,
          serviceName: services.name,
          qty: opdBillLines.qty,
          rate: opdBillLines.rate,
          fee: opdBillLines.fee,
          sharePercent: opdBillLines.sharePercent,
          shareAmount: opdBillLines.shareAmount,
        })
        .from(opdBillLines)
        .leftJoin(doctors, eq(doctors.id, opdBillLines.doctorId))
        .leftJoin(services, eq(services.id, opdBillLines.serviceId))
        .where(eq(opdBillLines.billId, id))
        .orderBy(asc(opdBillLines.position)),
      this.context.db
        .select({
          kind: opdPayments.kind,
          number: opdPayments.number,
          method: opdPayments.method,
          reference: opdPayments.reference,
          amount: opdPayments.amount,
          paidOn: opdPayments.paidOn,
          receivedBy: opdPayments.receivedBy,
        })
        .from(opdPayments)
        .where(eq(opdPayments.billId, id))
        .orderBy(asc(opdPayments.createdAt)),
    ]);
    return {
      ...header,
      lines: lines.map(({ position, ...line }) => ({ line: position + 1, ...line })),
      payments,
    };
  }
}
