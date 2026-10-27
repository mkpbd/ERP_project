import { fileURLToPath } from 'node:url';
import { and, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import type { StaffDirectory } from '../../../../shared/application/contracts/staff-directory.js';
import type { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { code39Svg } from '../../../../shared/infrastructure/reports/code39.js';
import type { IpdCashier } from '../../application/ipd-billing.handlers.js';
import type { IpdBillingReadRepository } from '../../application/ipd-billing.messages.js';
import type { AdmissionReadRepository } from '../../application/ipd.messages.js';
import { localToday } from '../../application/patient.handlers.js';
import type { IpdBillHead } from '../../domain/ipd-bill.js';
import { PAYMENT_METHODS, type PaymentMethod } from '../../domain/opd-bill.js';
import { ageOn, uhidLabel } from '../../domain/patient.js';
import type { IpdPaymentKind } from '../../domain/repositories.js';
import { ipdPayments } from '../persistence/hospital.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const cents = (value: number) => Math.round(value * 100) / 100;
const METHOD_LABELS = { cash: 'Cash', card: 'Card', mobile: 'Mobile wallet' } as const;
const HEADS: { head: IpdBillHead; label: string }[] = [
  { head: 'admission', label: 'Admission' },
  { head: 'bed', label: 'Bed charges' },
  { head: 'round', label: 'Round fee' },
  { head: 'service', label: 'Services and consultant visits' },
  { head: 'medicine', label: 'Medicine' },
];
const KIND_LABELS: Record<IpdPaymentKind, string> = {
  advance: 'Advance',
  refund: 'Advance refunded',
  payment: 'Paid on the final bill',
  collection: 'Due collected',
};

/**
 * Old PrintHospitalBillSummaryDocument (QuestPDF, head summaries only) with PrintHospitalBillDetails: the final bill
 * with every line under its head, the advance taken against it, what was paid and what is due; before the bill is made,
 * the same as an interim bill to today.
 */
export function ipdBillReport(
  cashier: IpdCashier,
  admissions: AdmissionReadRepository,
  organization: OrganizationProfile,
  staff: StaffDirectory,
): ReportDefinition {
  return defineReport({
    key: 'hospital.ipd-bill',
    title: 'Indoor bill',
    group: 'Hospital',
    description:
      'The final bill of an admission (or an interim bill to today): every line by head, advance, payments and due.',
    params: z.strictObject({ admissionId: z.uuid() }),
    async load(params, report) {
      const admission = await admissions.get(params.admissionId);
      if (!admission) throw new NotFoundError('admission');
      const account = await cashier.account(params.admissionId);
      const age = ageOn(admission.dateOfBirth, localToday(report.generatedAt, report.timeZone));
      const [member] = admission.staffId ? await staff.findSummaries([admission.staffId]) : [];
      const consultant = admission.doctors.filter((doctor) => doctor.role === 'primary').at(-1)?.doctorName ?? null;
      const bill = account.bill;
      return {
        organization: report.header,
        admission: {
          ...admission,
          uhidLabel: uhidLabel(await organization.patientIdPrefix(), admission.uhid),
          age: age.years > 0 ? `${age.years} years` : `${age.months} months ${age.days} days`,
          consultant,
          bed: admission.bedCode ? `${admission.bedCode} (${admission.wardName})` : null,
          payerName:
            admission.corporateClientName ?? (member ? `Staff: ${member.fullName} (${member.employeeNo})` : 'Patient'),
        },
        account,
        kind: bill ? 'Final bill' : 'Interim bill',
        groups: HEADS.map(({ head, label }) => {
          const lines = account.lines.filter((line) => line.head === head);
          return {
            label,
            lines,
            subtotal: cents(lines.reduce((total, line) => total + line.amount, 0)),
          };
        }).filter((group) => group.lines.length > 0),
        payments: account.payments.map((payment) => ({
          ...payment,
          kindLabel: KIND_LABELS[payment.kind],
          methodLabel: METHOD_LABELS[payment.method],
          signed: payment.kind === 'refund' ? -payment.amount : payment.amount,
        })),
        stamp: bill ? (bill.due > 0 ? 'DUE' : 'PAID') : 'INTERIM',
        barcode: code39Svg(bill?.number ?? admission.number),
        printedBy: report.printedBy,
      };
    },
    describe: (_params, data) =>
      `${data.account.bill?.number ?? data.kind} · ${data.admission.number} · ${data.admission.patientName}`,
    pdf: { engine: 'html', template: template('ipd-bill') },
  });
}

/** Old PrintAdvancePaymentDocument and PrintIPDDueCollectionDocument: the money receipt on an 80 mm roll. */
export function ipdReceiptReport(
  read: IpdBillingReadRepository,
  organization: OrganizationProfile,
  users: UserDirectory,
): ReportDefinition {
  return defineReport({
    key: 'hospital.ipd-receipt',
    title: 'Indoor money receipt',
    group: 'Hospital',
    description: 'The receipt of an advance, an advance refund, a final bill payment or a due collection.',
    params: z.strictObject({ number: z.string().trim().min(1).max(30) }),
    async load(params, report) {
      const receipt = await read.receipt(params.number.toUpperCase());
      if (!receipt) throw new NotFoundError('receipt');
      const [user] = receipt.receivedBy ? await users.findSummaries([receipt.receivedBy]) : [];
      return {
        receipt: {
          ...receipt,
          uhidLabel: uhidLabel(await organization.patientIdPrefix(), receipt.uhid),
          kindLabel: KIND_LABELS[receipt.kind],
          methodLabel: METHOD_LABELS[receipt.method],
          receivedByName: user?.displayName ?? null,
        },
        organization: report.header,
        barcode: code39Svg(receipt.number),
      };
    },
    describe: (_params, data) => `${data.receipt.number} · ${data.receipt.kindLabel}`,
    pdf: {
      engine: 'html',
      template: template('ipd-receipt'),
      bare: true,
      paper: { width: '80mm', height: '140mm' },
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
 * Old BillingUserwiseCollectionStatement / HospitalUserwiseCollectionSummary: per user, the advances taken, payments on
 * final bills, dues collected and advances paid back, by cash, card and mobile wallet, and what to hand over.
 */
export function ipdCollectionReport(context: DbContext, users: UserDirectory): ReportDefinition {
  return defineReport({
    key: 'hospital.ipd-collection',
    title: 'Indoor collection',
    group: 'Hospital',
    description: 'Per user: advances, final bill payments, dues collected and advances paid back, by method.',
    params: z.strictObject({ from: day, to: day }),
    async load(params) {
      if (params.from > params.to) throw new DomainError('invalid_period', 'The start date is after the end date');
      const rows = await context.db
        .select({
          userId: ipdPayments.receivedBy,
          kind: ipdPayments.kind,
          method: ipdPayments.method,
          count: sql<number>`count(*)`.mapWith(Number),
          amount: sql<number>`coalesce(sum(${ipdPayments.amount}), 0)`.mapWith(Number),
        })
        .from(ipdPayments)
        .where(and(gte(ipdPayments.paidOn, params.from), lte(ipdPayments.paidOn, params.to)))
        .groupBy(ipdPayments.receivedBy, ipdPayments.kind, ipdPayments.method);
      const ids = [...new Set(rows.map((row) => row.userId).filter((id): id is string => id !== null))];
      const names = new Map(
        (ids.length ? await users.findSummaries(ids) : []).map((user) => [user.id, user.displayName]),
      );
      const blank = () => ({
        advance: byMethod(),
        payment: byMethod(),
        collection: byMethod(),
        refund: byMethod(),
        net: byMethod(),
        receipts: 0,
      });
      const people = new Map<string | null, ReturnType<typeof blank>>();
      const total = blank();
      for (const row of rows) {
        const person = people.get(row.userId) ?? blank();
        people.set(row.userId, person);
        const signed = row.kind === 'refund' ? -row.amount : row.amount;
        for (const target of [person, total]) {
          put(target[row.kind], row.method, row.amount);
          put(target.net, row.method, signed);
          target.receipts += row.count;
        }
      }
      return {
        people: [...people.entries()]
          .map(([id, person]) => ({
            name: id ? (names.get(id) ?? '—') : '—',
            ...person,
            others: cents(person.net.total - person.net.cash),
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        total: { ...total, others: cents(total.net.total - total.net.cash) },
        methods: PAYMENT_METHODS.map((method) => ({ key: method, label: METHOD_LABELS[method] })),
      };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('ipd-collection'), landscape: true },
    xlsx: (data) => {
      const sections = [
        ['advance', 'Advances'],
        ['payment', 'On final bills'],
        ['collection', 'Dues collected'],
        ['refund', 'Paid back'],
        ['net', 'Net'],
      ] as const;
      return {
        columns: [
          { key: 'name', header: 'User', width: 22 },
          { key: 'receipts', header: 'Receipts', format: 'integer' as const },
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
          receipts: person.receipts,
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
