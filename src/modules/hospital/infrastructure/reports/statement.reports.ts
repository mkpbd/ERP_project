import { fileURLToPath } from 'node:url';
import { and, asc, eq, gt, gte, isNull, lte, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import type { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import type { OpdBillReadRepository } from '../../application/opd.messages.js';
import { localToday } from '../../application/patient.handlers.js';
import { uhidLabel } from '../../domain/patient.js';
import {
  corporateClients,
  diagnosticBillLines,
  diagnosticBills,
  diagnosticPayments,
  doctorLedger,
  doctors,
  ipdBillLines,
  ipdBills,
  ipdPayments,
  opdBillLines,
  opdBills,
  opdPayments,
  patients,
} from '../persistence/hospital.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const cents = (value: number) => Math.round(value * 100) / 100;
const sumOf = (column: AnyColumn | SQL) => sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);
const METHOD_LABELS = { cash: 'Cash', card: 'Card', mobile: 'Mobile wallet' } as const;
const KIND_LABELS = { share: 'Share earned', reversal: 'Share taken back', payment: 'Paid' } as const;
/** What is still owed on a diagnostic bill (never one of an admitted patient: the final bill takes those). */
const testsDue =
  sql<number>`${diagnosticBills.net} - ${diagnosticBills.cancelled} - ${diagnosticBills.paid} - ${diagnosticBills.collected} + ${diagnosticBills.refunded}`.mapWith(
    Number,
  );
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
}

/** Old DoctorPaymentSheet / DoctorbasedSummryReport: per doctor, owed before, earned, taken back, paid, owed after. */
export function doctorPayablesReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hospital.doctor-payables',
    title: 'Doctor payables',
    group: 'Hospital',
    description: 'Per doctor: owed before the period, shares earned and taken back, paid, and owed after.',
    params: z.strictObject({ from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const rows = await context.db
        .select({
          doctorName: doctors.name,
          opening: sumOf(sql`case when ${doctorLedger.entryOn} < ${params.from} then ${doctorLedger.amount} end`),
          earned: sumOf(
            sql`case when ${doctorLedger.entryOn} >= ${params.from} and ${doctorLedger.kind} = 'share' then ${doctorLedger.amount} end`,
          ),
          reversed: sumOf(
            sql`case when ${doctorLedger.entryOn} >= ${params.from} and ${doctorLedger.kind} = 'reversal' then -${doctorLedger.amount} end`,
          ),
          paid: sumOf(
            sql`case when ${doctorLedger.entryOn} >= ${params.from} and ${doctorLedger.kind} = 'payment' then -${doctorLedger.amount} end`,
          ),
          closing: sumOf(doctorLedger.amount),
        })
        .from(doctorLedger)
        .innerJoin(doctors, eq(doctors.id, doctorLedger.doctorId))
        .where(lte(doctorLedger.entryOn, params.to))
        .groupBy(doctors.id, doctors.name)
        .orderBy(asc(doctors.name));
      const total = { opening: 0, earned: 0, reversed: 0, paid: 0, closing: 0 };
      for (const row of rows) {
        for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] = cents(total[key] + row[key]);
      }
      return {
        rows: rows.filter((row) => row.opening || row.earned || row.reversed || row.paid || row.closing),
        total,
      };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('doctor-payables') },
    xlsx: (data) => ({
      columns: [
        { key: 'doctorName', header: 'Doctor', width: 26 },
        { key: 'opening', header: 'Owed before', format: 'money' },
        { key: 'earned', header: 'Earned', format: 'money' },
        { key: 'reversed', header: 'Taken back', format: 'money' },
        { key: 'paid', header: 'Paid', format: 'money' },
        { key: 'closing', header: 'Owed after', format: 'money' },
      ],
      rows: [...data.rows, { doctorName: 'Total', ...data.total }],
    }),
  });
}

/** Old DoctorPaymentSheetInvoiceWise: one doctor's shares and payments, entry by entry, with the running balance. */
export function doctorLedgerReport(read: OpdBillReadRepository): ReportDefinition {
  return defineReport({
    key: 'hospital.doctor-ledger',
    title: 'Doctor ledger',
    group: 'Hospital',
    description: "One doctor's shares earned and taken back and payments over a period, with what they are owed.",
    params: z.strictObject({ doctorId: z.uuid(), from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const ledger = await read.doctorLedger(params.doctorId, params.from, params.to);
      if (!ledger) throw new NotFoundError('doctor');
      return { ...ledger, entries: ledger.entries.map((entry) => ({ ...entry, kindLabel: KIND_LABELS[entry.kind] })) };
    },
    describe: (params, data) => `${data.doctorName} · ${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('doctor-ledger') },
    xlsx: (data) => ({
      columns: [
        { key: 'entryOn', header: 'Date', format: 'date' },
        { key: 'documentNumber', header: 'Document', width: 18 },
        { key: 'kindLabel', header: 'Entry', width: 18 },
        { key: 'amount', header: 'Amount', format: 'money' },
        { key: 'balance', header: 'Owed', format: 'money' },
      ],
      rows: data.entries,
    }),
  });
}

/** Old patient-wise bill history under the UHID: every OPD and indoor bill, and every receipt. */
export function patientStatementReport(context: DbContext, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'hospital.patient-statement',
    title: 'Patient statement',
    group: 'Hospital',
    description: "A patient's OPD and indoor bills with who pays, what was paid and what is due, and every receipt.",
    params: z.strictObject({ patientId: z.uuid() }),
    async load(params) {
      const [patient] = await context.db
        .select({ uhid: patients.uhid, fullName: patients.fullName, mobileNo: patients.mobileNo })
        .from(patients)
        .where(eq(patients.id, params.patientId));
      if (!patient) throw new NotFoundError('patient');
      const outdoor = await context.db
        .select({
          number: opdBills.number,
          billedOn: opdBills.billedOn,
          clientName: corporateClients.name,
          staffId: opdBills.staffId,
          net: opdBills.net,
          paid: sql<number>`${opdBills.paid} + ${opdBills.collected}`.mapWith(Number),
          due: sql<number>`${opdBills.net} - ${opdBills.paid} - ${opdBills.collected}`.mapWith(Number),
          status: opdBills.status,
        })
        .from(opdBills)
        .leftJoin(corporateClients, eq(corporateClients.id, opdBills.corporateClientId))
        .where(eq(opdBills.patientId, params.patientId));
      const indoor = await context.db
        .select({
          number: ipdBills.number,
          billedOn: ipdBills.billedOn,
          clientName: corporateClients.name,
          staffId: ipdBills.staffId,
          net: ipdBills.net,
          paid: sql<number>`${ipdBills.deposit} + ${ipdBills.paid} + ${ipdBills.collected}`.mapWith(Number),
          due: sql<number>`${ipdBills.net} - ${ipdBills.deposit} - ${ipdBills.paid} - ${ipdBills.collected}`.mapWith(
            Number,
          ),
          status: ipdBills.status,
        })
        .from(ipdBills)
        .leftJoin(corporateClients, eq(corporateClients.id, ipdBills.corporateClientId))
        .where(eq(ipdBills.patientId, params.patientId));
      const tests = await context.db
        .select({
          number: diagnosticBills.number,
          billedOn: diagnosticBills.billedOn,
          clientName: corporateClients.name,
          staffId: diagnosticBills.staffId,
          net: sql<number>`${diagnosticBills.net} - ${diagnosticBills.cancelled}`.mapWith(Number),
          paid: sql<number>`${diagnosticBills.paid} + ${diagnosticBills.collected} - ${diagnosticBills.refunded}`.mapWith(
            Number,
          ),
          due: testsDue,
          status: diagnosticBills.status,
        })
        .from(diagnosticBills)
        .leftJoin(corporateClients, eq(corporateClients.id, diagnosticBills.corporateClientId))
        .where(and(eq(diagnosticBills.patientId, params.patientId), isNull(diagnosticBills.admissionId)));
      const bills = [
        ...outdoor.map((bill) => ({ ...bill, place: 'OPD' })),
        ...indoor.map((bill) => ({ ...bill, place: 'Indoor' })),
        ...tests.map((bill) => ({ ...bill, place: 'Diagnostic' })),
      ]
        .sort((a, b) => a.billedOn.localeCompare(b.billedOn) || a.number.localeCompare(b.number))
        .map((bill) => ({
          ...bill,
          billTo: bill.clientName ?? (bill.staffId ? 'Staff' : 'Patient'),
          due: bill.status === 'cancelled' ? 0 : cents(bill.due),
          state: bill.status === 'cancelled' ? 'Cancelled' : bill.due > 0 ? 'Due' : 'Paid',
        }));
      const outdoorReceipts = await context.db
        .select({
          number: sql<string>`coalesce(${opdPayments.number}, ${opdBills.number})`,
          kind: opdPayments.kind,
          method: opdPayments.method,
          amount: opdPayments.amount,
          paidOn: opdPayments.paidOn,
          createdAt: opdPayments.createdAt,
        })
        .from(opdPayments)
        .innerJoin(opdBills, eq(opdBills.id, opdPayments.billId))
        .where(eq(opdBills.patientId, params.patientId));
      const indoorReceipts = await context.db
        .select({
          number: ipdPayments.number,
          kind: ipdPayments.kind,
          method: ipdPayments.method,
          amount: ipdPayments.amount,
          paidOn: ipdPayments.paidOn,
          createdAt: ipdPayments.createdAt,
        })
        .from(ipdPayments)
        .innerJoin(ipdBills, eq(ipdBills.id, ipdPayments.billId))
        .where(eq(ipdBills.patientId, params.patientId));
      const testReceipts = await context.db
        .select({
          number: sql<string>`coalesce(${diagnosticPayments.number}, ${diagnosticBills.number})`,
          kind: diagnosticPayments.kind,
          method: diagnosticPayments.method,
          amount: diagnosticPayments.amount,
          paidOn: diagnosticPayments.paidOn,
          createdAt: diagnosticPayments.createdAt,
        })
        .from(diagnosticPayments)
        .innerJoin(diagnosticBills, eq(diagnosticBills.id, diagnosticPayments.billId))
        .where(eq(diagnosticBills.patientId, params.patientId));
      // Advances and refunds belong to the admission, not yet to a bill.
      const advances = await context.db.execute<{
        number: string;
        kind: 'advance' | 'refund';
        method: 'cash' | 'card' | 'mobile';
        amount: string;
        paid_on: string;
        created_at: Date;
      }>(sql`
        select p.number, p.kind, p.method, p.amount, p.paid_on, p.created_at
        from ${ipdPayments} p
        join hospital_admissions a on a.id = p.admission_id
        where a.patient_id = ${params.patientId} and p.bill_id is null`);
      const receipts = [
        ...outdoorReceipts,
        ...indoorReceipts,
        ...testReceipts,
        ...advances.rows.map((row) => ({
          number: row.number,
          kind: row.kind,
          method: row.method,
          amount: Number(row.amount),
          paidOn: row.paid_on,
          createdAt: new Date(row.created_at),
        })),
      ]
        .sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.createdAt.getTime() - b.createdAt.getTime())
        .map((receipt) => ({
          ...receipt,
          what: { payment: 'Paid', collection: 'Due collected', refund: 'Paid back', advance: 'Advance' }[receipt.kind],
          methodLabel: METHOD_LABELS[receipt.method],
          signed: receipt.kind === 'refund' ? -receipt.amount : receipt.amount,
        }));
      const live = bills.filter((bill) => bill.status !== 'cancelled');
      return {
        patient: { ...patient, uhidLabel: uhidLabel(await organization.patientIdPrefix(), patient.uhid) },
        bills,
        receipts,
        billed: cents(live.reduce((total, bill) => total + bill.net, 0)),
        ownDue: cents(live.filter((bill) => bill.billTo === 'Patient').reduce((total, bill) => total + bill.due, 0)),
        othersDue: cents(live.filter((bill) => bill.billTo !== 'Patient').reduce((total, bill) => total + bill.due, 0)),
      };
    },
    describe: (_params, data) => `${data.patient.uhidLabel} · ${data.patient.fullName}`,
    pdf: { engine: 'html', template: template('patient-statement') },
  });
}

/** Old HospitalDuePatientStatement (indoor only): every OPD and indoor bill still owed, oldest first, by who owes it. */
export function duesReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hospital.dues',
    title: 'Dues',
    group: 'Hospital',
    description: 'Every OPD and indoor bill with something due, oldest first, with who owes it and for how long.',
    params: z.strictObject({
      payer: z.enum(['patient', 'corporate', 'staff']).optional(),
      corporateClientId: z.uuid().optional(),
    }),
    async load(params, report) {
      const today = localToday(report.generatedAt, report.timeZone);
      const payerOf = (client: AnyColumn, staff: AnyColumn) =>
        sql<
          'patient' | 'corporate' | 'staff'
        >`case when ${client} is not null then 'corporate' when ${staff} is not null then 'staff' else 'patient' end`;
      const outdoorDue = sql<number>`${opdBills.net} - ${opdBills.paid} - ${opdBills.collected}`.mapWith(Number);
      const indoorDue =
        sql<number>`${ipdBills.net} - ${ipdBills.deposit} - ${ipdBills.paid} - ${ipdBills.collected}`.mapWith(Number);
      const outdoor = await context.db
        .select({
          number: opdBills.number,
          billedOn: opdBills.billedOn,
          uhid: patients.uhid,
          patientName: patients.fullName,
          mobileNo: patients.mobileNo,
          clientId: opdBills.corporateClientId,
          clientName: corporateClients.name,
          payer: payerOf(opdBills.corporateClientId, opdBills.staffId),
          net: opdBills.net,
          due: outdoorDue,
        })
        .from(opdBills)
        .innerJoin(patients, eq(patients.id, opdBills.patientId))
        .leftJoin(corporateClients, eq(corporateClients.id, opdBills.corporateClientId))
        .where(and(eq(opdBills.status, 'billed'), gt(outdoorDue, 0)));
      const indoor = await context.db
        .select({
          number: ipdBills.number,
          billedOn: ipdBills.billedOn,
          uhid: patients.uhid,
          patientName: patients.fullName,
          mobileNo: patients.mobileNo,
          clientId: ipdBills.corporateClientId,
          clientName: corporateClients.name,
          payer: payerOf(ipdBills.corporateClientId, ipdBills.staffId),
          net: ipdBills.net,
          due: indoorDue,
        })
        .from(ipdBills)
        .innerJoin(patients, eq(patients.id, ipdBills.patientId))
        .leftJoin(corporateClients, eq(corporateClients.id, ipdBills.corporateClientId))
        .where(and(eq(ipdBills.status, 'billed'), gt(indoorDue, 0)));
      const tests = await context.db
        .select({
          number: diagnosticBills.number,
          billedOn: diagnosticBills.billedOn,
          uhid: patients.uhid,
          patientName: patients.fullName,
          mobileNo: patients.mobileNo,
          clientId: diagnosticBills.corporateClientId,
          clientName: corporateClients.name,
          payer: payerOf(diagnosticBills.corporateClientId, diagnosticBills.staffId),
          net: sql<number>`${diagnosticBills.net} - ${diagnosticBills.cancelled}`.mapWith(Number),
          due: testsDue,
        })
        .from(diagnosticBills)
        .innerJoin(patients, eq(patients.id, diagnosticBills.patientId))
        .leftJoin(corporateClients, eq(corporateClients.id, diagnosticBills.corporateClientId))
        .where(and(eq(diagnosticBills.status, 'billed'), isNull(diagnosticBills.admissionId), gt(testsDue, 0)));
      const rows = [
        ...outdoor.map((bill) => ({ ...bill, place: 'OPD' })),
        ...indoor.map((bill) => ({ ...bill, place: 'Indoor' })),
        ...tests.map((bill) => ({ ...bill, place: 'Diagnostic' })),
      ]
        .filter((bill) => !params.payer || bill.payer === params.payer)
        .filter((bill) => !params.corporateClientId || bill.clientId === params.corporateClientId)
        .sort((a, b) => a.billedOn.localeCompare(b.billedOn) || a.number.localeCompare(b.number))
        .map((bill) => ({
          ...bill,
          billTo: bill.clientName ?? (bill.payer === 'staff' ? 'Staff' : 'Patient'),
          days: daysBetween(bill.billedOn, today),
        }));
      const owed = (payer: string) =>
        cents(rows.filter((bill) => bill.payer === payer).reduce((total, bill) => total + bill.due, 0));
      return {
        rows,
        patient: owed('patient'),
        corporate: owed('corporate'),
        staff: owed('staff'),
        total: cents(rows.reduce((total, bill) => total + bill.due, 0)),
      };
    },
    describe: (_params, data) => `${data.rows.length} bills · ${data.total.toFixed(2)} due`,
    pdf: { engine: 'html', template: template('dues'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'billedOn', header: 'Billed on', format: 'date' },
        { key: 'number', header: 'Bill', width: 16 },
        { key: 'place', header: 'Where', width: 8 },
        { key: 'uhid', header: 'UHID', format: 'integer' },
        { key: 'patientName', header: 'Patient', width: 26 },
        { key: 'mobileNo', header: 'Mobile', width: 14 },
        { key: 'billTo', header: 'Bill to', width: 20 },
        { key: 'net', header: 'Bill', format: 'money' },
        { key: 'due', header: 'Due', format: 'money' },
        { key: 'days', header: 'Days', format: 'integer' },
      ],
      rows: data.rows,
    }),
  });
}

/** Old HospitalDiscountStatement / IPDDiscountByEachPerson: discounts given on OPD and indoor bills, by whom and why. */
export function discountsReport(context: DbContext, users: UserDirectory): ReportDefinition {
  return defineReport({
    key: 'hospital.discounts',
    title: 'Discounts given',
    group: 'Hospital',
    description:
      'OPD and indoor bills with a discount over a period (cancelled bills left out), with the reason and who.',
    params: z.strictObject({ from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const outdoor = await context.db
        .select({
          number: opdBills.number,
          billedOn: opdBills.billedOn,
          uhid: patients.uhid,
          patientName: patients.fullName,
          clientName: corporateClients.name,
          gross: opdBills.gross,
          discount: opdBills.discount,
          discountReason: opdBills.discountReason,
          billedBy: opdBills.billedBy,
        })
        .from(opdBills)
        .innerJoin(patients, eq(patients.id, opdBills.patientId))
        .leftJoin(corporateClients, eq(corporateClients.id, opdBills.corporateClientId))
        .where(
          and(
            eq(opdBills.status, 'billed'),
            gt(opdBills.discount, 0),
            gte(opdBills.billedOn, params.from),
            lte(opdBills.billedOn, params.to),
          ),
        );
      const indoor = await context.db
        .select({
          number: ipdBills.number,
          billedOn: ipdBills.billedOn,
          uhid: patients.uhid,
          patientName: patients.fullName,
          clientName: corporateClients.name,
          gross: sql<number>`${ipdBills.gross} + ${ipdBills.serviceCharge}`.mapWith(Number),
          discount: ipdBills.discount,
          discountReason: ipdBills.discountReason,
          billedBy: ipdBills.billedBy,
        })
        .from(ipdBills)
        .innerJoin(patients, eq(patients.id, ipdBills.patientId))
        .leftJoin(corporateClients, eq(corporateClients.id, ipdBills.corporateClientId))
        .where(
          and(
            eq(ipdBills.status, 'billed'),
            gt(ipdBills.discount, 0),
            gte(ipdBills.billedOn, params.from),
            lte(ipdBills.billedOn, params.to),
          ),
        );
      const tests = await context.db
        .select({
          number: diagnosticBills.number,
          billedOn: diagnosticBills.billedOn,
          uhid: patients.uhid,
          patientName: patients.fullName,
          clientName: corporateClients.name,
          gross: diagnosticBills.gross,
          discount: diagnosticBills.discount,
          discountReason: diagnosticBills.discountReason,
          billedBy: diagnosticBills.billedBy,
        })
        .from(diagnosticBills)
        .innerJoin(patients, eq(patients.id, diagnosticBills.patientId))
        .leftJoin(corporateClients, eq(corporateClients.id, diagnosticBills.corporateClientId))
        .where(
          and(
            eq(diagnosticBills.status, 'billed'),
            gt(diagnosticBills.discount, 0),
            gte(diagnosticBills.billedOn, params.from),
            lte(diagnosticBills.billedOn, params.to),
          ),
        );
      const ids = [
        ...new Set([...outdoor, ...indoor, ...tests].flatMap((bill) => (bill.billedBy ? [bill.billedBy] : []))),
      ];
      const names = new Map(
        (ids.length ? await users.findSummaries(ids) : []).map((user) => [user.id, user.displayName]),
      );
      const rows = [
        ...outdoor.map((bill) => ({ ...bill, place: 'OPD' })),
        ...indoor.map((bill) => ({ ...bill, place: 'Indoor' })),
        ...tests.map((bill) => ({ ...bill, place: 'Diagnostic' })),
      ]
        .sort((a, b) => a.billedOn.localeCompare(b.billedOn) || a.number.localeCompare(b.number))
        .map((bill) => ({
          ...bill,
          percent: bill.gross > 0 ? cents((bill.discount * 100) / bill.gross) : 0,
          by: bill.billedBy ? (names.get(bill.billedBy) ?? '—') : '—',
        }));
      const byUser = [...new Set(rows.map((bill) => bill.by))].sort().map((by) => {
        const mine = rows.filter((bill) => bill.by === by);
        return { by, bills: mine.length, discount: cents(mine.reduce((total, bill) => total + bill.discount, 0)) };
      });
      return {
        rows,
        byUser,
        gross: cents(rows.reduce((total, bill) => total + bill.gross, 0)),
        discount: cents(rows.reduce((total, bill) => total + bill.discount, 0)),
      };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('discounts'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'billedOn', header: 'Billed on', format: 'date' },
        { key: 'number', header: 'Bill', width: 16 },
        { key: 'place', header: 'Where', width: 8 },
        { key: 'uhid', header: 'UHID', format: 'integer' },
        { key: 'patientName', header: 'Patient', width: 26 },
        { key: 'clientName', header: 'Corporate', width: 18 },
        { key: 'gross', header: 'Bill', format: 'money' },
        { key: 'discount', header: 'Discount', format: 'money' },
        { key: 'percent', header: '%', format: 'money' },
        { key: 'discountReason', header: 'Reason', width: 26 },
        { key: 'by', header: 'Given by', width: 18 },
      ],
      rows: data.rows,
    }),
  });
}

const HEADS = [
  ['opd:consultation', 'OPD consultations'],
  ['opd:service', 'OPD services'],
  ['ipd:admission', 'Admission fees'],
  ['ipd:bed', 'Bed rent'],
  ['ipd:round', 'Round fees'],
  ['ipd:service', 'Indoor services and consultant visits'],
  ['ipd:serviceCharge', 'Service charge'],
  ['diag:tests', 'Diagnostic tests'],
] as const;

/**
 * Old HospitalIncomeStatement / IndoorIncomeStatement / IPDServiceWiseIncomeReport: income by head over a period, as
 * billed, with bills cancelled in the period taken off on the day they were cancelled, and the discounts.
 */
export function incomeByHeadReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hospital.income-by-head',
    title: 'Income by head',
    group: 'Hospital',
    description:
      'OPD, indoor and diagnostic income by head over a period, less what was cancelled in it, and the discounts given.',
    params: z.strictObject({ from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const within = (column: AnyColumn) => and(gte(column, params.from), lte(column, params.to));
      const outdoor = (dated: AnyColumn, cancelled: boolean) =>
        context.db
          .select({
            head: sql<string>`case when ${opdBillLines.serviceId} is null then 'opd:consultation' else 'opd:service' end`,
            amount: sumOf(opdBillLines.fee),
          })
          .from(opdBillLines)
          .innerJoin(opdBills, eq(opdBills.id, opdBillLines.billId))
          .where(and(within(dated), cancelled ? eq(opdBills.status, 'cancelled') : undefined))
          .groupBy(sql`1`);
      const indoor = (dated: AnyColumn, cancelled: boolean) =>
        context.db
          .select({ head: sql<string>`'ipd:' || ${ipdBillLines.head}`, amount: sumOf(ipdBillLines.amount) })
          .from(ipdBillLines)
          .innerJoin(ipdBills, eq(ipdBills.id, ipdBillLines.billId))
          .where(and(within(dated), cancelled ? eq(ipdBills.status, 'cancelled') : undefined))
          .groupBy(sql`1`);
      const charge = (dated: AnyColumn, cancelled: boolean) =>
        context.db
          .select({ head: sql<string>`'ipd:serviceCharge'`, amount: sumOf(ipdBills.serviceCharge) })
          .from(ipdBills)
          .where(and(within(dated), cancelled ? eq(ipdBills.status, 'cancelled') : undefined));
      const discount = async (bills: typeof opdBills | typeof ipdBills, dated: AnyColumn, cancelled: boolean) => {
        const [row] = await context.db
          .select({ amount: sumOf(bills.discount) })
          .from(bills)
          .where(and(within(dated), cancelled ? eq(bills.status, 'cancelled') : undefined));
        return row?.amount ?? 0;
      };
      // A diagnostic test's income is taken when billed (an admitted patient's too) and given back when cancelled.
      const tests = async (cancelledOnly: boolean) => {
        const [row] = await context.db
          .select({ amount: sumOf(diagnosticBillLines.rate), discount: sumOf(diagnosticBillLines.discount) })
          .from(diagnosticBillLines)
          .innerJoin(diagnosticBills, eq(diagnosticBills.id, diagnosticBillLines.billId))
          .where(
            cancelledOnly
              ? and(eq(diagnosticBillLines.status, 'cancelled'), within(diagnosticBillLines.cancelledOn))
              : within(diagnosticBills.billedOn),
          );
        return { head: 'diag:tests', amount: row?.amount ?? 0, discount: row?.discount ?? 0 };
      };
      const testsBilled = await tests(false);
      const testsCancelled = await tests(true);
      const billed = [
        ...(await outdoor(opdBills.billedOn, false)),
        ...(await indoor(ipdBills.billedOn, false)),
        ...(await charge(ipdBills.billedOn, false)),
        testsBilled,
      ];
      const cancelled = [
        ...(await outdoor(opdBills.cancelledOn, true)),
        ...(await indoor(ipdBills.cancelledOn, true)),
        ...(await charge(ipdBills.cancelledOn, true)),
        testsCancelled,
      ];
      const of = (rows: { head: string; amount: number }[], head: string) =>
        cents(rows.filter((row) => row.head === head).reduce((total, row) => total + row.amount, 0));
      const rows = HEADS.map(([head, label]) => {
        const gross = of(billed, head);
        const back = of(cancelled, head);
        return {
          label,
          place: head.startsWith('opd') ? 'OPD' : head.startsWith('ipd') ? 'Indoor' : 'Diagnostic',
          billed: gross,
          cancelled: back,
          net: cents(gross - back),
        };
      });
      const discounts = {
        billed: cents(
          (await discount(opdBills, opdBills.billedOn, false)) +
            (await discount(ipdBills, ipdBills.billedOn, false)) +
            testsBilled.discount,
        ),
        cancelled: cents(
          (await discount(opdBills, opdBills.cancelledOn, true)) +
            (await discount(ipdBills, ipdBills.cancelledOn, true)) +
            testsCancelled.discount,
        ),
      };
      const total = (key: 'billed' | 'cancelled' | 'net') => cents(rows.reduce((sum, row) => sum + row[key], 0));
      const income = { billed: total('billed'), cancelled: total('cancelled'), net: total('net') };
      const discountNet = cents(discounts.billed - discounts.cancelled);
      return {
        rows,
        income,
        discounts: { ...discounts, net: discountNet },
        netIncome: cents(income.net - discountNet),
      };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('income-by-head') },
    xlsx: (data) => ({
      columns: [
        { key: 'label', header: 'Head', width: 34 },
        { key: 'place', header: 'Where', width: 8 },
        { key: 'billed', header: 'Billed', format: 'money' },
        { key: 'cancelled', header: 'Cancelled', format: 'money' },
        { key: 'net', header: 'Net', format: 'money' },
      ],
      rows: [
        ...data.rows,
        { label: 'Income', place: null, ...data.income },
        { label: 'Less discounts', place: null, ...data.discounts },
        { label: 'Net income', place: null, billed: null, cancelled: null, net: data.netIncome },
      ],
    }),
  });
}
