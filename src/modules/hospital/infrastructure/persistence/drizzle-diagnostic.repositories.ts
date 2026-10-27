import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, count, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  DiagnosticBillReadRepository,
  type DiagnosticBillFilter,
  type DiagnosticBillSummary,
  type DiagnosticBillView,
  type PackageTestsView,
} from '../../application/diagnostic.messages.js';
import { DiagnosticBill } from '../../domain/diagnostic-bill.js';
import type { InvestigationBill } from '../../domain/ipd-bill.js';
import {
  DiagnosticBillRepository,
  type BillableTest,
  type DiagnosticPayment,
  type DiagnosticPolicy,
} from '../../domain/repositories.js';
import {
  corporateClients,
  diagnosticBillLines,
  diagnosticBills,
  diagnosticDepartments,
  diagnosticPackages,
  diagnosticPackageTests,
  diagnosticPayments,
  diagnosticPolicy,
  diagnosticTests,
  doctors,
  patients,
} from './hospital.schema.js';

/** The policy before anyone set one: 10 % at the counter (as at the OPD), no referral commission. */
const DEFAULT_POLICY: DiagnosticPolicy = { counterDiscountPercent: 10, defaultReferralPercent: 0 };

const due =
  sql<number>`${diagnosticBills.net} - ${diagnosticBills.cancelled} - ${diagnosticBills.paid} - ${diagnosticBills.collected} + ${diagnosticBills.refunded}`.mapWith(
    Number,
  );

@Injectable()
export class DrizzleDiagnosticBillRepository extends DiagnosticBillRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async policy(): Promise<DiagnosticPolicy> {
    const [row] = await this.context.db
      .select({
        counterDiscountPercent: diagnosticPolicy.counterDiscountPercent,
        defaultReferralPercent: diagnosticPolicy.defaultReferralPercent,
      })
      .from(diagnosticPolicy)
      .where(eq(diagnosticPolicy.id, 1));
    return row ?? DEFAULT_POLICY;
  }

  async savePolicy(policy: DiagnosticPolicy, by: string, now: Date): Promise<void> {
    const values = { ...policy, updatedAt: now, updatedBy: by };
    await this.context.db
      .insert(diagnosticPolicy)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: diagnosticPolicy.id, set: values });
  }

  async tests(ids: readonly string[]): Promise<Map<string, BillableTest>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        id: diagnosticTests.id,
        name: diagnosticTests.name,
        rate: diagnosticTests.rate,
        reportHours: diagnosticTests.reportHours,
        discountAllowed: diagnosticTests.discountAllowed,
        referralPercent: diagnosticTests.referralPercent,
        isActive: diagnosticTests.isActive,
      })
      .from(diagnosticTests)
      .where(inArray(diagnosticTests.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async package(id: string) {
    const [row] = await this.context.db
      .select({ id: diagnosticPackages.id, name: diagnosticPackages.name, isActive: diagnosticPackages.isActive })
      .from(diagnosticPackages)
      .where(eq(diagnosticPackages.id, id));
    if (!row) return null;
    const tests = await this.context.db
      .select({ testId: diagnosticPackageTests.testId, rate: diagnosticPackageTests.rate })
      .from(diagnosticPackageTests)
      .innerJoin(diagnosticTests, eq(diagnosticTests.id, diagnosticPackageTests.testId))
      .where(eq(diagnosticPackageTests.packageId, id))
      .orderBy(asc(diagnosticTests.name));
    return { ...row, tests };
  }

  async setPackageTests(packageId: string, tests: readonly { testId: string; rate: number }[]): Promise<void> {
    await this.context.db.delete(diagnosticPackageTests).where(eq(diagnosticPackageTests.packageId, packageId));
    await this.context.db.insert(diagnosticPackageTests).values(tests.map((test) => ({ ...test, packageId })));
  }

  async findForUpdate(id: string): Promise<DiagnosticBill | null> {
    const [row] = await this.context.db.select().from(diagnosticBills).where(eq(diagnosticBills.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select({
        testId: diagnosticBillLines.testId,
        packageId: diagnosticBillLines.packageId,
        rate: diagnosticBillLines.rate,
        discountAllowed: diagnosticBillLines.discountAllowed,
        discount: diagnosticBillLines.discount,
        referralPercent: diagnosticBillLines.referralPercent,
        referralAmount: diagnosticBillLines.referralAmount,
        reportDueAt: diagnosticBillLines.reportDueAt,
        status: diagnosticBillLines.status,
        cancelledOn: diagnosticBillLines.cancelledOn,
        cancelReason: diagnosticBillLines.cancelReason,
      })
      .from(diagnosticBillLines)
      .where(eq(diagnosticBillLines.billId, id))
      .orderBy(asc(diagnosticBillLines.position));
    return DiagnosticBill.restore({ ...row, lines });
  }

  async insert(bill: DiagnosticBill): Promise<void> {
    const { lines, ...row } = bill.toSnapshot();
    await this.context.db.insert(diagnosticBills).values(row);
    await this.context.db
      .insert(diagnosticBillLines)
      .values(lines.map((line, index) => ({ ...line, billId: row.id, position: index + 1 })));
  }

  async update(bill: DiagnosticBill): Promise<void> {
    const { lines, id, ...row } = bill.toSnapshot();
    await this.context.db.update(diagnosticBills).set(row).where(eq(diagnosticBills.id, id));
    for (const [index, line] of lines.entries()) {
      await this.context.db
        .update(diagnosticBillLines)
        .set({ status: line.status, cancelledOn: line.cancelledOn, cancelReason: line.cancelReason })
        .where(and(eq(diagnosticBillLines.billId, id), eq(diagnosticBillLines.position, index + 1)));
    }
  }

  async addPayment(payment: DiagnosticPayment): Promise<void> {
    await this.context.db.insert(diagnosticPayments).values({ ...payment, id: randomUUID() });
  }

  async reportingFee(billId: string, line: number) {
    const [row] = await this.context.db
      .select({
        rate: diagnosticBillLines.rate,
        percent: diagnosticTests.reportingFeePercent,
        amount: diagnosticTests.reportingFeeAmount,
      })
      .from(diagnosticBillLines)
      .innerJoin(diagnosticTests, eq(diagnosticTests.id, diagnosticBillLines.testId))
      .where(and(eq(diagnosticBillLines.billId, billId), eq(diagnosticBillLines.position, line)));
    return row ?? null;
  }

  async indoorCharges(admissionId: string): Promise<InvestigationBill[]> {
    const live = sql<number>`${diagnosticBills.net} - ${diagnosticBills.cancelled}`.mapWith(Number);
    return this.context.db
      .select({
        billId: diagnosticBills.id,
        number: diagnosticBills.number,
        billedOn: diagnosticBills.billedOn,
        amount: live,
      })
      .from(diagnosticBills)
      .where(and(eq(diagnosticBills.admissionId, admissionId), eq(diagnosticBills.status, 'billed'), sql`${live} > 0`))
      .orderBy(asc(diagnosticBills.billedOn), asc(diagnosticBills.number));
  }
}

const referrers = aliasedTable(doctors, 'referrers');

@Injectable()
export class DrizzleDiagnosticBillReadRepository extends DiagnosticBillReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private summaries() {
    return this.context.db
      .select({
        id: diagnosticBills.id,
        number: diagnosticBills.number,
        billedOn: diagnosticBills.billedOn,
        patientId: diagnosticBills.patientId,
        uhid: patients.uhid,
        patientName: patients.fullName,
        referredByName: referrers.name,
        gross: diagnosticBills.gross,
        discount: diagnosticBills.discount,
        net: diagnosticBills.net,
        cancelled: diagnosticBills.cancelled,
        paid: diagnosticBills.paid,
        collected: diagnosticBills.collected,
        refunded: diagnosticBills.refunded,
        due,
        status: diagnosticBills.status,
        corporateClientId: diagnosticBills.corporateClientId,
        corporateClientName: corporateClients.name,
        staffId: diagnosticBills.staffId,
        admissionId: diagnosticBills.admissionId,
        version: diagnosticBills.version,
      })
      .from(diagnosticBills)
      .innerJoin(patients, eq(patients.id, diagnosticBills.patientId))
      .leftJoin(referrers, eq(referrers.id, diagnosticBills.referredById))
      .leftJoin(corporateClients, eq(corporateClients.id, diagnosticBills.corporateClientId));
  }

  async list(filter: DiagnosticBillFilter): Promise<Page<DiagnosticBillSummary>> {
    const where = and(
      filter.patientId ? eq(diagnosticBills.patientId, filter.patientId) : undefined,
      filter.referredById ? eq(diagnosticBills.referredById, filter.referredById) : undefined,
      filter.from ? gte(diagnosticBills.billedOn, filter.from) : undefined,
      filter.to ? lte(diagnosticBills.billedOn, filter.to) : undefined,
      filter.status ? eq(diagnosticBills.status, filter.status) : undefined,
      // An admitted patient's tests are paid with the final bill, never a due of their own.
      filter.withDue
        ? and(eq(diagnosticBills.status, 'billed'), isNull(diagnosticBills.admissionId), sql`${due} > 0`)
        : undefined,
      filter.admissionId ? eq(diagnosticBills.admissionId, filter.admissionId) : undefined,
      filter.corporateClientId ? eq(diagnosticBills.corporateClientId, filter.corporateClientId) : undefined,
    );
    const rows = await this.summaries()
      .where(where)
      .orderBy(desc(diagnosticBills.billedOn), desc(diagnosticBills.number))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    const [total] = await this.context.db.select({ n: count() }).from(diagnosticBills).where(where);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async get(id: string): Promise<DiagnosticBillView | null> {
    const [summary] = await this.summaries().where(eq(diagnosticBills.id, id));
    if (!summary) return null;
    const [header] = await this.context.db
      .select({
        billedAt: diagnosticBills.billedAt,
        sex: patients.sex,
        dateOfBirth: patients.dateOfBirth,
        mobileNo: sql<string | null>`coalesce(${patients.mobileNo}, ${patients.contactMobileNo})`,
        referredById: diagnosticBills.referredById,
        discountReason: diagnosticBills.discountReason,
        voucherNumber: diagnosticBills.voucherNumber,
        billedBy: diagnosticBills.billedBy,
      })
      .from(diagnosticBills)
      .innerJoin(patients, eq(patients.id, diagnosticBills.patientId))
      .where(eq(diagnosticBills.id, id));
    const lines = await this.context.db
      .select({
        line: diagnosticBillLines.position,
        testId: diagnosticBillLines.testId,
        testName: diagnosticTests.name,
        departmentName: diagnosticDepartments.name,
        roomNo: diagnosticTests.roomNo,
        specimen: diagnosticTests.specimen,
        packageName: diagnosticPackages.name,
        rate: diagnosticBillLines.rate,
        discount: diagnosticBillLines.discount,
        referralAmount: diagnosticBillLines.referralAmount,
        reportDueAt: diagnosticBillLines.reportDueAt,
        status: diagnosticBillLines.status,
        cancelledOn: diagnosticBillLines.cancelledOn,
        cancelReason: diagnosticBillLines.cancelReason,
      })
      .from(diagnosticBillLines)
      .innerJoin(diagnosticTests, eq(diagnosticTests.id, diagnosticBillLines.testId))
      .innerJoin(diagnosticDepartments, eq(diagnosticDepartments.id, diagnosticTests.departmentId))
      .leftJoin(diagnosticPackages, eq(diagnosticPackages.id, diagnosticBillLines.packageId))
      .where(eq(diagnosticBillLines.billId, id))
      .orderBy(asc(diagnosticBillLines.position));
    const payments = await this.context.db
      .select({
        kind: diagnosticPayments.kind,
        number: diagnosticPayments.number,
        method: diagnosticPayments.method,
        reference: diagnosticPayments.reference,
        amount: diagnosticPayments.amount,
        paidOn: diagnosticPayments.paidOn,
      })
      .from(diagnosticPayments)
      .where(eq(diagnosticPayments.billId, id))
      .orderBy(asc(diagnosticPayments.createdAt));
    return { ...summary, ...header!, lines, payments };
  }

  async packageTests(packageId: string): Promise<PackageTestsView | null> {
    const [row] = await this.context.db
      .select({ name: diagnosticPackages.name, isActive: diagnosticPackages.isActive })
      .from(diagnosticPackages)
      .where(eq(diagnosticPackages.id, packageId));
    if (!row) return null;
    const tests = await this.context.db
      .select({
        testId: diagnosticPackageTests.testId,
        testName: diagnosticTests.name,
        listRate: diagnosticTests.rate,
        rate: diagnosticPackageTests.rate,
      })
      .from(diagnosticPackageTests)
      .innerJoin(diagnosticTests, eq(diagnosticTests.id, diagnosticPackageTests.testId))
      .where(eq(diagnosticPackageTests.packageId, packageId))
      .orderBy(asc(diagnosticTests.name));
    const total = tests.reduce((sum, test) => sum + Math.round(test.rate * 100), 0) / 100;
    return { packageId, ...row, tests, total };
  }
}
