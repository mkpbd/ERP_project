import { fileURLToPath } from 'node:url';
import { and, asc, eq, gte, lte, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import type { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { code39Svg } from '../../../../shared/infrastructure/reports/code39.js';
import { localToday } from '../../application/patient.handlers.js';
import type { OpdBillReadRepository } from '../../application/opd.messages.js';
import { PAYMENT_METHODS, type PaymentMethod } from '../../domain/opd-bill.js';
import { ageOn, uhidLabel } from '../../domain/patient.js';
import { doctorLedger, doctors, opdBillLines, opdBills, opdPayments } from '../persistence/hospital.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const cents = (value: number) => Math.round(value * 100) / 100;
const sumOf = (column: AnyColumn | SQL) => sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);
const VISIT_LABELS = { first: 'First visit', new: 'New', follow_up: 'Follow-up', report: 'Report showing' } as const;
const METHOD_LABELS = { cash: 'Cash', card: 'Card', mobile: 'Mobile wallet' } as const;

function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
}

/**
 * Old PrintOPDServiceRecieptDocument (rdlc with a Code 128 barcode of the invoice): the consultation receipt on an
 * 80 mm roll, with a Code 39 barcode of the bill number, the doctors and room numbers, and PAID / DUE / CANCELLED.
 */
export function opdReceiptReport(read: OpdBillReadRepository, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'hospital.opd-receipt',
    title: 'OPD receipt',
    group: 'Hospital',
    description: 'The consultation receipt: patient, doctors with rooms and fees, discount, paid, due and payments.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const bill = await read.get(params.id);
      if (!bill) throw new NotFoundError('opd_bill');
      const age = ageOn(bill.dateOfBirth, localToday(report.generatedAt, report.timeZone));
      return {
        organization: report.header,
        bill: {
          ...bill,
          uhidLabel: uhidLabel(await organization.patientIdPrefix(), bill.uhid),
          age: age.years > 0 ? `${age.years} y` : `${age.months} m ${age.days} d`,
          lines: bill.lines.map((line) => ({ ...line, visit: VISIT_LABELS[line.visitType] })),
          payments: bill.payments.map((payment) => ({ ...payment, methodLabel: METHOD_LABELS[payment.method] })),
          stamp: bill.status === 'cancelled' ? 'CANCELLED' : bill.due > 0 ? 'DUE' : 'PAID',
        },
        barcode: code39Svg(bill.number),
        printedBy: report.printedBy,
      };
    },
    describe: (_params, data) => data.bill.number,
    pdf: {
      engine: 'html',
      template: template('opd-receipt'),
      bare: true,
      paper: { width: '80mm', height: '200mm' },
    },
  });
}

type ByMethod = Record<PaymentMethod | 'total', number>;
const byMethod = (): ByMethod => ({ cash: 0, card: 0, mobile: 0, total: 0 });
const put = (target: ByMethod, method: PaymentMethod, value: number) => {
  target[method] = cents(target[method] + value);
  target.total = cents(target.total + value);
};

/**
 * Old OPDCollectionSummary / OpdUserwiseCollectionSummary: per user over a period, by cash, card and mobile wallet,
 * what was taken at billing and on dues, less what was paid back on cancellations — what each counter hands over.
 */
export function opdCollectionReport(context: DbContext, users: UserDirectory): ReportDefinition {
  return defineReport({
    key: 'hospital.opd-collection',
    title: 'OPD collection',
    group: 'Hospital',
    description: 'Per user: taken at billing and on dues, paid back on cancellations, by cash, card and mobile wallet.',
    params: z.strictObject({ from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const rows = await context.db
        .select({
          userId: opdPayments.receivedBy,
          kind: opdPayments.kind,
          method: opdPayments.method,
          count: sql<number>`count(*)`.mapWith(Number),
          amount: sumOf(opdPayments.amount),
        })
        .from(opdPayments)
        .where(and(gte(opdPayments.paidOn, params.from), lte(opdPayments.paidOn, params.to)))
        .groupBy(opdPayments.receivedBy, opdPayments.kind, opdPayments.method);
      const ids = [...new Set(rows.map((row) => row.userId).filter((id): id is string => id !== null))];
      const names = new Map(
        (ids.length ? await users.findSummaries(ids) : []).map((user) => [user.id, user.displayName]),
      );
      const blank = () => ({
        payment: byMethod(),
        collection: byMethod(),
        refund: byMethod(),
        net: byMethod(),
        bills: 0,
      });
      const people = new Map<string | null, ReturnType<typeof blank>>();
      const total = blank();
      for (const row of rows) {
        const person = people.get(row.userId) ?? blank();
        people.set(row.userId, person);
        const signed = row.kind === 'refund' ? -row.amount : row.amount;
        for (const target of [person, total]) {
          put(target[row.kind], row.method, signed);
          put(target.net, row.method, signed);
          if (row.kind === 'payment') target.bills += row.count;
        }
      }
      return {
        people: [...people.entries()]
          .map(([id, person]) => ({ name: id ? (names.get(id) ?? '—') : '—', ...person }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        total,
        methods: PAYMENT_METHODS.map((method) => ({ key: method, label: METHOD_LABELS[method] })),
      };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('opd-collection') },
    xlsx: (data) => {
      const sections = [
        ['payment', 'At billing'],
        ['collection', 'Dues collected'],
        ['refund', 'Paid back'],
        ['net', 'Net'],
      ] as const;
      return {
        columns: [
          { key: 'name', header: 'User', width: 22 },
          ...sections.flatMap(([section, label]) =>
            (['cash', 'card', 'mobile', 'total'] as const).map((method) => ({
              key: `${section}_${method}`,
              header: `${label} ${method}`,
              format: 'money' as const,
            })),
          ),
        ],
        rows: [...data.people, { name: 'Total', ...data.total }].map((person) => ({
          name: person.name,
          ...Object.fromEntries(
            sections.flatMap(([section]) =>
              (['cash', 'card', 'mobile', 'total'] as const).map((method) => [
                `${section}_${method}`,
                person[section][method],
              ]),
            ),
          ),
        })),
      };
    },
  });
}

/**
 * Old OutdoorConsutationFee / OPDConsultancyStatement and the consultant ledger: per doctor over a period, the visits
 * billed by kind, those cancelled (on their cancel date), the fees and the share earned and taken back.
 */
export function doctorConsultationsReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hospital.doctor-consultations',
    title: 'Doctor consultations',
    group: 'Hospital',
    description: "Per doctor: visits by kind, cancelled visits, fees and the doctor's share earned and taken back.",
    params: z.strictObject({ from: day, to: day, doctorId: z.uuid().optional() }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const doctorFilter = params.doctorId ? eq(opdBillLines.doctorId, params.doctorId) : undefined;
      const billed = await context.db
        .select({
          doctorId: opdBillLines.doctorId,
          visitType: opdBillLines.visitType,
          visits: sql<number>`count(*)`.mapWith(Number),
          fees: sumOf(opdBillLines.fee),
        })
        .from(opdBillLines)
        .innerJoin(opdBills, eq(opdBills.id, opdBillLines.billId))
        .where(and(gte(opdBills.billedOn, params.from), lte(opdBills.billedOn, params.to), doctorFilter))
        .groupBy(opdBillLines.doctorId, opdBillLines.visitType);
      const cancelled = await context.db
        .select({
          doctorId: opdBillLines.doctorId,
          visits: sql<number>`count(*)`.mapWith(Number),
          fees: sumOf(opdBillLines.fee),
        })
        .from(opdBillLines)
        .innerJoin(opdBills, eq(opdBills.id, opdBillLines.billId))
        .where(
          and(
            eq(opdBills.status, 'cancelled'),
            gte(opdBills.cancelledOn, params.from),
            lte(opdBills.cancelledOn, params.to),
            doctorFilter,
          ),
        )
        .groupBy(opdBillLines.doctorId);
      const shares = await context.db
        .select({ doctorId: doctorLedger.doctorId, kind: doctorLedger.kind, amount: sumOf(doctorLedger.amount) })
        .from(doctorLedger)
        .where(
          and(
            gte(doctorLedger.entryOn, params.from),
            lte(doctorLedger.entryOn, params.to),
            params.doctorId ? eq(doctorLedger.doctorId, params.doctorId) : undefined,
          ),
        )
        .groupBy(doctorLedger.doctorId, doctorLedger.kind);
      const names = await context.db
        .select({ id: doctors.id, name: doctors.name })
        .from(doctors)
        .orderBy(asc(doctors.name));
      const ids = new Set([...billed, ...cancelled, ...shares].map((row) => row.doctorId));
      const blank = () => ({
        first: 0,
        new: 0,
        follow_up: 0,
        report: 0,
        visits: 0,
        fees: 0,
        cancelledVisits: 0,
        cancelledFees: 0,
        netFees: 0,
        shareEarned: 0,
        shareReversed: 0,
        netShare: 0,
      });
      const total = blank();
      const rows = names
        .filter((doctor) => ids.has(doctor.id))
        .map((doctor) => {
          const row = { doctorName: doctor.name, ...blank() };
          for (const entry of billed.filter((item) => item.doctorId === doctor.id)) {
            row[entry.visitType] += entry.visits;
            row.visits += entry.visits;
            row.fees = cents(row.fees + entry.fees);
          }
          const back = cancelled.find((item) => item.doctorId === doctor.id);
          row.cancelledVisits = back?.visits ?? 0;
          row.cancelledFees = cents(back?.fees ?? 0);
          row.netFees = cents(row.fees - row.cancelledFees);
          for (const entry of shares.filter((item) => item.doctorId === doctor.id)) {
            if (entry.kind === 'share') row.shareEarned = cents(row.shareEarned + entry.amount);
            else row.shareReversed = cents(row.shareReversed - entry.amount);
          }
          row.netShare = cents(row.shareEarned - row.shareReversed);
          for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] = cents(total[key] + row[key]);
          return row;
        });
      return { rows, total };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('doctor-consultations'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'doctorName', header: 'Doctor', width: 26 },
        { key: 'first', header: 'First visit', format: 'integer' },
        { key: 'new', header: 'New', format: 'integer' },
        { key: 'follow_up', header: 'Follow-up', format: 'integer' },
        { key: 'report', header: 'Report', format: 'integer' },
        { key: 'fees', header: 'Fees', format: 'money' },
        { key: 'cancelledVisits', header: 'Cancelled', format: 'integer' },
        { key: 'cancelledFees', header: 'Cancelled fees', format: 'money' },
        { key: 'netFees', header: 'Net fees', format: 'money' },
        { key: 'shareEarned', header: 'Share earned', format: 'money' },
        { key: 'shareReversed', header: 'Share taken back', format: 'money' },
        { key: 'netShare', header: 'Net share', format: 'money' },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}
