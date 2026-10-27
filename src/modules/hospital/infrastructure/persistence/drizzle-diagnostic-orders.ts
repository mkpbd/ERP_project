import { Injectable } from '@nestjs/common';
import { aliasedTable, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { DiagnosticOrders, type DiagnosticOrder } from '../../../../shared/application/contracts/diagnostic-orders.js';
import {
  diagnosticBillLines,
  diagnosticBills,
  diagnosticDepartments,
  diagnosticTests,
  doctors,
  patients,
} from './hospital.schema.js';

const referrers = aliasedTable(doctors, 'referrers');

/** The hospital's diagnostic bills as the lab works from them. */
@Injectable()
export class DrizzleDiagnosticOrders extends DiagnosticOrders {
  constructor(private readonly context: DbContext) {
    super();
  }

  private async load(where: SQL): Promise<DiagnosticOrder[]> {
    const bills = await this.context.db
      .select({
        billId: diagnosticBills.id,
        billNumber: diagnosticBills.number,
        billedAt: diagnosticBills.billedAt,
        patientId: patients.id,
        uhid: patients.uhid,
        name: patients.fullName,
        sex: patients.sex,
        dateOfBirth: patients.dateOfBirth,
        mobileNo: sql<string | null>`coalesce(${patients.mobileNo}, ${patients.contactMobileNo})`,
        referredByName: referrers.name,
        admissionId: diagnosticBills.admissionId,
        corporateClientId: diagnosticBills.corporateClientId,
        staffId: diagnosticBills.staffId,
        due: sql<number>`${diagnosticBills.net} - ${diagnosticBills.cancelled} - ${diagnosticBills.paid} - ${diagnosticBills.collected} + ${diagnosticBills.refunded}`.mapWith(
          Number,
        ),
      })
      .from(diagnosticBills)
      .innerJoin(patients, eq(patients.id, diagnosticBills.patientId))
      .leftJoin(referrers, eq(referrers.id, diagnosticBills.referredById))
      .where(where);
    if (bills.length === 0) return [];
    const lines = await this.context.db
      .select({
        billId: diagnosticBillLines.billId,
        line: diagnosticBillLines.position,
        testId: diagnosticBillLines.testId,
        testName: diagnosticTests.name,
        departmentId: diagnosticDepartments.id,
        departmentName: diagnosticDepartments.name,
        departmentKind: diagnosticDepartments.kind,
        specimen: diagnosticTests.specimen,
        status: diagnosticBillLines.status,
        reportDueAt: diagnosticBillLines.reportDueAt,
      })
      .from(diagnosticBillLines)
      .innerJoin(diagnosticTests, eq(diagnosticTests.id, diagnosticBillLines.testId))
      .innerJoin(diagnosticDepartments, eq(diagnosticDepartments.id, diagnosticTests.departmentId))
      .where(
        inArray(
          diagnosticBillLines.billId,
          bills.map((bill) => bill.billId),
        ),
      )
      .orderBy(asc(diagnosticBillLines.position));
    return bills.map((bill) => ({
      billId: bill.billId,
      billNumber: bill.billNumber,
      billedAt: bill.billedAt,
      patient: {
        id: bill.patientId,
        uhid: bill.uhid,
        name: bill.name,
        sex: bill.sex,
        dateOfBirth: bill.dateOfBirth,
        mobileNo: bill.mobileNo,
      },
      referredByName: bill.referredByName,
      admissionId: bill.admissionId,
      payer: bill.admissionId ? 'indoor' : bill.corporateClientId ? 'corporate' : bill.staffId ? 'staff' : 'patient',
      due: bill.due,
      tests: lines.filter((line) => line.billId === bill.billId).map(({ billId: _bill, ...line }) => line),
    }));
  }

  find(billIds: readonly string[]): Promise<DiagnosticOrder[]> {
    if (billIds.length === 0) return Promise.resolve([]);
    return this.load(inArray(diagnosticBills.id, [...new Set(billIds)]));
  }

  async byNumber(number: string): Promise<DiagnosticOrder | null> {
    const [order] = await this.load(eq(diagnosticBills.number, number.trim().toUpperCase()));
    return order ?? null;
  }

  async departments(ids: readonly string[]) {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({ id: diagnosticDepartments.id, name: diagnosticDepartments.name, kind: diagnosticDepartments.kind })
      .from(diagnosticDepartments)
      .where(inArray(diagnosticDepartments.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async doctors(ids: readonly string[]) {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({ id: doctors.id, name: doctors.name, isActive: doctors.isActive })
      .from(doctors)
      .where(inArray(doctors.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async tests(testIds: readonly string[]) {
    if (testIds.length === 0) return new Map();
    const rows = await this.context.db
      .select({ id: diagnosticTests.id, name: diagnosticTests.name, departmentKind: diagnosticDepartments.kind })
      .from(diagnosticTests)
      .innerJoin(diagnosticDepartments, eq(diagnosticDepartments.id, diagnosticTests.departmentId))
      .where(inArray(diagnosticTests.id, [...new Set(testIds)]));
    return new Map(rows.map((row) => [row.id, row]));
  }
}
