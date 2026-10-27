import { fileURLToPath } from 'node:url';
import { and, asc, eq, gte, lte, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import type { StaffDirectory } from '../../../../shared/application/contracts/staff-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { code39Svg } from '../../../../shared/infrastructure/reports/code39.js';
import type { DiagnosticBillReadRepository } from '../../application/diagnostic.messages.js';
import { localToday } from '../../application/patient.handlers.js';
import { ageOn, uhidLabel } from '../../domain/patient.js';
import {
  diagnosticBillLines,
  diagnosticBills,
  diagnosticDepartments,
  diagnosticTests,
  doctors,
} from '../persistence/hospital.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const cents = (value: number) => Math.round(value * 100) / 100;
const sumOf = (column: AnyColumn | SQL) => sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);
const METHOD_LABELS = { cash: 'Cash', card: 'Card', mobile: 'Mobile wallet' } as const;

function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
}

/**
 * Old PrintInvestigationInvoiceDocument ("Cash Memo", QuestPDF): the diagnostic receipt on an 80 mm roll with a
 * barcode, the referring doctor, each test with where to go and when its report is due, PAID / DUE / CANCELLED.
 */
export function diagnosticReceiptReport(
  read: DiagnosticBillReadRepository,
  organization: OrganizationProfile,
  staff: StaffDirectory,
): ReportDefinition {
  return defineReport({
    key: 'hospital.diagnostic-receipt',
    title: 'Diagnostic receipt',
    group: 'Hospital',
    description: 'The diagnostic receipt: tests with room and report time, referring doctor, payer, paid and due.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const bill = await read.get(params.id);
      if (!bill) throw new NotFoundError('diagnostic_bill');
      const age = ageOn(bill.dateOfBirth, localToday(report.generatedAt, report.timeZone));
      const [member] = bill.staffId ? await staff.findSummaries([bill.staffId]) : [];
      return {
        organization: report.header,
        bill: {
          ...bill,
          uhidLabel: uhidLabel(await organization.patientIdPrefix(), bill.uhid),
          age: age.years > 0 ? `${age.years} y` : `${age.months} m ${age.days} d`,
          payerName: bill.corporateClientName ?? (member ? `Staff: ${member.fullName} (${member.employeeNo})` : null),
          payments: bill.payments.map((payment) => ({ ...payment, methodLabel: METHOD_LABELS[payment.method] })),
          live: cents(bill.net - bill.cancelled),
          stamp: bill.status === 'cancelled' ? 'CANCELLED' : bill.due > 0 ? 'DUE' : 'PAID',
        },
        barcode: code39Svg(bill.number),
        printedBy: report.printedBy,
      };
    },
    describe: (_params, data) => data.bill.number,
    pdf: {
      engine: 'html',
      template: template('diagnostic-receipt'),
      bare: true,
      paper: { width: '80mm', height: '220mm' },
    },
  });
}

/**
 * Old ReferDoctorWiseDiagnosticSalesReport / DoctorContributionDetail and the media commission statement: per
 * referring doctor, the tests they sent, what they were billed at and the commission earned and taken back.
 */
export function referralCommissionReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hospital.referral-commission',
    title: 'Referral commission',
    group: 'Hospital',
    description: 'Per referring doctor: tests sent, billed, cancelled and the commission earned and taken back.',
    params: z.strictObject({ from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const billed = await context.db
        .select({
          doctorName: doctors.name,
          tests: sql<number>`count(*)`.mapWith(Number),
          gross: sumOf(diagnosticBillLines.rate),
          commission: sumOf(diagnosticBillLines.referralAmount),
        })
        .from(diagnosticBillLines)
        .innerJoin(diagnosticBills, eq(diagnosticBills.id, diagnosticBillLines.billId))
        .innerJoin(doctors, eq(doctors.id, diagnosticBills.referredById))
        .where(and(gte(diagnosticBills.billedOn, params.from), lte(diagnosticBills.billedOn, params.to)))
        .groupBy(doctors.id, doctors.name);
      const cancelled = await context.db
        .select({
          doctorName: doctors.name,
          tests: sql<number>`count(*)`.mapWith(Number),
          gross: sumOf(diagnosticBillLines.rate),
          commission: sumOf(diagnosticBillLines.referralAmount),
        })
        .from(diagnosticBillLines)
        .innerJoin(diagnosticBills, eq(diagnosticBills.id, diagnosticBillLines.billId))
        .innerJoin(doctors, eq(doctors.id, diagnosticBills.referredById))
        .where(
          and(
            eq(diagnosticBillLines.status, 'cancelled'),
            gte(diagnosticBillLines.cancelledOn, params.from),
            lte(diagnosticBillLines.cancelledOn, params.to),
          ),
        )
        .groupBy(doctors.id, doctors.name);
      const names = [...new Set([...billed, ...cancelled].map((row) => row.doctorName))].sort();
      const rows = names.map((doctorName) => {
        const sent = billed.find((row) => row.doctorName === doctorName);
        const back = cancelled.find((row) => row.doctorName === doctorName);
        return {
          doctorName,
          tests: sent?.tests ?? 0,
          gross: cents(sent?.gross ?? 0),
          cancelledTests: back?.tests ?? 0,
          cancelledGross: cents(back?.gross ?? 0),
          earned: cents(sent?.commission ?? 0),
          reversed: cents(back?.commission ?? 0),
          net: cents((sent?.commission ?? 0) - (back?.commission ?? 0)),
        };
      });
      const total = { tests: 0, gross: 0, cancelledTests: 0, cancelledGross: 0, earned: 0, reversed: 0, net: 0 };
      for (const row of rows) {
        for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] = cents(total[key] + row[key]);
      }
      return { rows, total };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('referral-commission'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'doctorName', header: 'Referring doctor', width: 26 },
        { key: 'tests', header: 'Tests', format: 'integer' },
        { key: 'gross', header: 'Billed', format: 'money' },
        { key: 'cancelledTests', header: 'Cancelled tests', format: 'integer' },
        { key: 'cancelledGross', header: 'Cancelled', format: 'money' },
        { key: 'earned', header: 'Commission earned', format: 'money' },
        { key: 'reversed', header: 'Taken back', format: 'money' },
        { key: 'net', header: 'Net commission', format: 'money' },
      ],
      rows: [...data.rows, { doctorName: 'Total', ...data.total }],
    }),
  });
}

/**
 * Old DepartmentWiseCollectionDetails / DiagnosticDetailsReportDepartmentwise: per department, tests and income
 * billed, tests cancelled in the period (taken off on the day cancelled), and the discounts.
 */
export function diagnosticIncomeReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hospital.diagnostic-income',
    title: 'Diagnostic income',
    group: 'Hospital',
    description: 'Per department: tests and income billed and cancelled over a period, and the discounts.',
    params: z.strictObject({ from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const per = (cancelledOnly: boolean) =>
        context.db
          .select({
            department: diagnosticDepartments.name,
            tests: sql<number>`count(*)`.mapWith(Number),
            gross: sumOf(diagnosticBillLines.rate),
            discount: sumOf(diagnosticBillLines.discount),
          })
          .from(diagnosticBillLines)
          .innerJoin(diagnosticBills, eq(diagnosticBills.id, diagnosticBillLines.billId))
          .innerJoin(diagnosticTests, eq(diagnosticTests.id, diagnosticBillLines.testId))
          .innerJoin(diagnosticDepartments, eq(diagnosticDepartments.id, diagnosticTests.departmentId))
          .where(
            cancelledOnly
              ? and(
                  eq(diagnosticBillLines.status, 'cancelled'),
                  gte(diagnosticBillLines.cancelledOn, params.from),
                  lte(diagnosticBillLines.cancelledOn, params.to),
                )
              : and(gte(diagnosticBills.billedOn, params.from), lte(diagnosticBills.billedOn, params.to)),
          )
          .groupBy(diagnosticDepartments.name)
          .orderBy(asc(diagnosticDepartments.name));
      const billed = await per(false);
      const cancelled = await per(true);
      const names = [...new Set([...billed, ...cancelled].map((row) => row.department))].sort();
      const rows = names.map((department) => {
        const sold = billed.find((row) => row.department === department);
        const back = cancelled.find((row) => row.department === department);
        const gross = cents((sold?.gross ?? 0) - (back?.gross ?? 0));
        const discount = cents((sold?.discount ?? 0) - (back?.discount ?? 0));
        return {
          department,
          tests: sold?.tests ?? 0,
          billed: cents(sold?.gross ?? 0),
          cancelledTests: back?.tests ?? 0,
          cancelled: cents(back?.gross ?? 0),
          gross,
          discount,
          net: cents(gross - discount),
        };
      });
      const total = { tests: 0, billed: 0, cancelledTests: 0, cancelled: 0, gross: 0, discount: 0, net: 0 };
      for (const row of rows) {
        for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] = cents(total[key] + row[key]);
      }
      return { rows, total };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('diagnostic-income'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'department', header: 'Department', width: 22 },
        { key: 'tests', header: 'Tests', format: 'integer' },
        { key: 'billed', header: 'Billed', format: 'money' },
        { key: 'cancelledTests', header: 'Cancelled tests', format: 'integer' },
        { key: 'cancelled', header: 'Cancelled', format: 'money' },
        { key: 'gross', header: 'Income', format: 'money' },
        { key: 'discount', header: 'Discount', format: 'money' },
        { key: 'net', header: 'Net', format: 'money' },
      ],
      rows: [...data.rows, { department: 'Total', ...data.total }],
    }),
  });
}
