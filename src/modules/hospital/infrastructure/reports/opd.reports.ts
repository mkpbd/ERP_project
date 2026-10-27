import { fileURLToPath } from 'node:url';
import { and, asc, eq, gte, inArray, isNotNull, lte, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import type { StaffDirectory } from '../../../../shared/application/contracts/staff-directory.js';
import type { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { code39Svg } from '../../../../shared/infrastructure/reports/code39.js';
import { localToday } from '../../application/patient.handlers.js';
import type { OpdBillReadRepository } from '../../application/opd.messages.js';
import { PAYMENT_METHODS, type PaymentMethod } from '../../domain/opd-bill.js';
import { ageOn, uhidLabel } from '../../domain/patient.js';
import {
  corporateClients,
  doctorLedger,
  diagnosticBills,
  diagnosticPayments,
  doctors,
  ipdBills,
  ipdPayments,
  opdBillLines,
  opdBills,
  opdPayments,
  patients,
  serviceGroups,
  services,
} from '../persistence/hospital.schema.js';

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
export function opdReceiptReport(
  read: OpdBillReadRepository,
  organization: OrganizationProfile,
  staff: StaffDirectory,
): ReportDefinition {
  return defineReport({
    key: 'hospital.opd-receipt',
    title: 'OPD receipt',
    group: 'Hospital',
    description: 'The OPD receipt: patient, doctors and services with fees, payer, discount, paid, due and payments.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const bill = await read.get(params.id);
      if (!bill) throw new NotFoundError('opd_bill');
      const age = ageOn(bill.dateOfBirth, localToday(report.generatedAt, report.timeZone));
      const [member] = bill.staffId ? await staff.findSummaries([bill.staffId]) : [];
      return {
        organization: report.header,
        bill: {
          ...bill,
          uhidLabel: uhidLabel(await organization.patientIdPrefix(), bill.uhid),
          age: age.years > 0 ? `${age.years} y` : `${age.months} m ${age.days} d`,
          lines: bill.lines.map((line) => ({ ...line, visit: line.visitType ? VISIT_LABELS[line.visitType] : null })),
          payments: bill.payments.map((payment) => ({ ...payment, methodLabel: METHOD_LABELS[payment.method] })),
          payerName: bill.corporateClientName ?? (member ? `Staff: ${member.fullName} (${member.employeeNo})` : null),
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
  return collectionReport(context, users, {
    key: 'hospital.opd-collection',
    title: 'OPD collection',
    payments: opdPayments,
  });
}

/** Old DiagUserwiseCollectionSummary / DiagnosticCollectionSummary: the same sheet for diagnostic bills. */
export function diagnosticCollectionReport(context: DbContext, users: UserDirectory): ReportDefinition {
  return collectionReport(context, users, {
    key: 'hospital.diagnostic-collection',
    title: 'Diagnostic collection',
    payments: diagnosticPayments,
  });
}

function collectionReport(
  context: DbContext,
  users: UserDirectory,
  sheet: { key: string; title: string; payments: typeof opdPayments | typeof diagnosticPayments },
): ReportDefinition {
  const payments = sheet.payments;
  return defineReport({
    key: sheet.key,
    title: sheet.title,
    group: 'Hospital',
    description: 'Per user: taken at billing and on dues, paid back on cancellations, by cash, card and mobile wallet.',
    params: z.strictObject({ from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const rows = await context.db
        .select({
          userId: payments.receivedBy,
          kind: payments.kind,
          method: payments.method,
          count: sql<number>`count(*)`.mapWith(Number),
          amount: sumOf(payments.amount),
        })
        .from(payments)
        .where(and(gte(payments.paidOn, params.from), lte(payments.paidOn, params.to)))
        .groupBy(payments.receivedBy, payments.kind, payments.method);
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
      // Consultations only; the share of services given is in the ledger below.
      const doctorFilter = and(
        isNotNull(opdBillLines.visitType),
        params.doctorId ? eq(opdBillLines.doctorId, params.doctorId) : undefined,
      );
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
      const ids = new Set([...billed, ...cancelled, ...shares].map((row) => row.doctorId).filter((id) => id !== null));
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
            if (entry.visitType) row[entry.visitType] += entry.visits;
            row.visits += entry.visits;
            row.fees = cents(row.fees + entry.fees);
          }
          const back = cancelled.find((item) => item.doctorId === doctor.id);
          row.cancelledVisits = back?.visits ?? 0;
          row.cancelledFees = cents(back?.fees ?? 0);
          row.netFees = cents(row.fees - row.cancelledFees);
          for (const entry of shares.filter((item) => item.doctorId === doctor.id)) {
            if (entry.kind === 'share') row.shareEarned = cents(row.shareEarned + entry.amount);
            else if (entry.kind === 'reversal') row.shareReversed = cents(row.shareReversed - entry.amount);
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

/**
 * Old corporate client statement / TotalCorporateIncome (the OPD kept the client only in a ledger description): a
 * client's bills over a period with what was charged to it, its payments, and what it owed before and after.
 */
export function corporateStatementReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hospital.corporate-statement',
    title: 'Corporate client statement',
    group: 'Hospital',
    description:
      "A corporate client's OPD, indoor and diagnostic bills and payments over a period, with what it owed before and after.",
    params: z.strictObject({ clientId: z.uuid(), from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const [client] = await context.db
        .select({
          name: corporateClients.name,
          payment: corporateClients.payment,
          creditLimit: corporateClients.creditLimit,
        })
        .from(corporateClients)
        .where(eq(corporateClients.id, params.clientId));
      if (!client) throw new NotFoundError('corporate_client');
      const outdoor = await context.db
        .select({
          id: opdBills.id,
          number: opdBills.number,
          billedOn: opdBills.billedOn,
          patientName: patients.fullName,
          uhid: patients.uhid,
          net: opdBills.net,
          paid: opdBills.paid,
          status: opdBills.status,
          cancelledOn: opdBills.cancelledOn,
        })
        .from(opdBills)
        .innerJoin(patients, eq(patients.id, opdBills.patientId))
        .where(and(eq(opdBills.corporateClientId, params.clientId), lte(opdBills.billedOn, params.to)));
      // An indoor bill: what the patient put in (advance taken and paid on the bill) is not the client's.
      const indoor = await context.db
        .select({
          id: ipdBills.id,
          number: ipdBills.number,
          billedOn: ipdBills.billedOn,
          patientName: patients.fullName,
          uhid: patients.uhid,
          net: ipdBills.net,
          paid: sql<number>`${ipdBills.deposit} + ${ipdBills.paid}`.mapWith(Number),
          status: ipdBills.status,
          cancelledOn: ipdBills.cancelledOn,
        })
        .from(ipdBills)
        .innerJoin(patients, eq(patients.id, ipdBills.patientId))
        .where(and(eq(ipdBills.corporateClientId, params.clientId), lte(ipdBills.billedOn, params.to)));
      // A diagnostic bill: what is left of it after cancelled tests (an admitted patient's never goes to a company).
      const tests = await context.db
        .select({
          id: diagnosticBills.id,
          number: diagnosticBills.number,
          billedOn: diagnosticBills.billedOn,
          patientName: patients.fullName,
          uhid: patients.uhid,
          net: sql<number>`${diagnosticBills.net} - ${diagnosticBills.cancelled}`.mapWith(Number),
          paid: sql<number>`${diagnosticBills.paid} - ${diagnosticBills.refunded}`.mapWith(Number),
          status: diagnosticBills.status,
          cancelledOn: sql<string | null>`null`,
        })
        .from(diagnosticBills)
        .innerJoin(patients, eq(patients.id, diagnosticBills.patientId))
        .where(and(eq(diagnosticBills.corporateClientId, params.clientId), lte(diagnosticBills.billedOn, params.to)));
      const bills = [...outdoor, ...indoor, ...tests].sort(
        (a, b) => a.billedOn.localeCompare(b.billedOn) || a.number.localeCompare(b.number),
      );
      const outdoorPayments = outdoor.length
        ? await context.db
            .select({
              billId: opdPayments.billId,
              number: opdPayments.number,
              method: opdPayments.method,
              amount: opdPayments.amount,
              paidOn: opdPayments.paidOn,
              createdAt: opdPayments.createdAt,
            })
            .from(opdPayments)
            .where(
              and(
                inArray(
                  opdPayments.billId,
                  outdoor.map((bill) => bill.id),
                ),
                eq(opdPayments.kind, 'collection'),
                lte(opdPayments.paidOn, params.to),
              ),
            )
        : [];
      const indoorPayments = indoor.length
        ? await context.db
            .select({
              billId: sql<string>`${ipdPayments.billId}`,
              number: ipdPayments.number,
              method: ipdPayments.method,
              amount: ipdPayments.amount,
              paidOn: ipdPayments.paidOn,
              createdAt: ipdPayments.createdAt,
            })
            .from(ipdPayments)
            .where(
              and(
                inArray(
                  ipdPayments.billId,
                  indoor.map((bill) => bill.id),
                ),
                eq(ipdPayments.kind, 'collection'),
                lte(ipdPayments.paidOn, params.to),
              ),
            )
        : [];
      const testPayments = tests.length
        ? await context.db
            .select({
              billId: diagnosticPayments.billId,
              number: sql<string>`coalesce(${diagnosticPayments.number}, '')`,
              method: diagnosticPayments.method,
              amount: diagnosticPayments.amount,
              paidOn: diagnosticPayments.paidOn,
              createdAt: diagnosticPayments.createdAt,
            })
            .from(diagnosticPayments)
            .where(
              and(
                inArray(
                  diagnosticPayments.billId,
                  tests.map((bill) => bill.id),
                ),
                eq(diagnosticPayments.kind, 'collection'),
                lte(diagnosticPayments.paidOn, params.to),
              ),
            )
        : [];
      const payments = [...outdoorPayments, ...indoorPayments, ...testPayments].sort(
        (a, b) => a.paidOn.localeCompare(b.paidOn) || a.createdAt.getTime() - b.createdAt.getTime(),
      );
      /** What the client owed at the end of a day. */
      const owedAt = (date: string) =>
        cents(
          bills
            .filter((bill) => bill.billedOn <= date && !(bill.status === 'cancelled' && bill.cancelledOn! <= date))
            .reduce((total, bill) => {
              const collected = payments
                .filter((payment) => payment.billId === bill.id && payment.paidOn <= date)
                .reduce((sum, payment) => sum + payment.amount, 0);
              return total + bill.net - bill.paid - collected;
            }, 0),
        );
      const dayBefore = new Date(`${params.from}T00:00:00Z`);
      dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
      const numbers = new Map(bills.map((bill) => [bill.id, bill.number]));
      const inPeriod = bills
        .filter((bill) => bill.billedOn >= params.from)
        .map((bill) => ({
          ...bill,
          charged: cents(bill.net - bill.paid),
          state: bill.status === 'cancelled' ? `Cancelled ${bill.cancelledOn}` : 'Billed',
        }));
      const collections = payments
        .filter((payment) => payment.paidOn >= params.from)
        .map((payment) => ({
          ...payment,
          billNumber: numbers.get(payment.billId),
          methodLabel: METHOD_LABELS[payment.method],
        }));
      return {
        client,
        opening: owedAt(dayBefore.toISOString().slice(0, 10)),
        bills: inPeriod,
        charged: cents(
          inPeriod.filter((bill) => bill.status === 'billed').reduce((total, bill) => total + bill.charged, 0),
        ),
        collections,
        collected: cents(collections.reduce((total, payment) => total + payment.amount, 0)),
        closing: owedAt(params.to),
      };
    },
    describe: (params, data) => `${data.client.name} · ${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('corporate-statement') },
    xlsx: (data) => ({
      columns: [
        { key: 'billedOn', header: 'Billed on', format: 'date' },
        { key: 'number', header: 'Bill', width: 16 },
        { key: 'uhid', header: 'UHID', format: 'integer' },
        { key: 'patientName', header: 'Patient', width: 26 },
        { key: 'net', header: 'Bill amount', format: 'money' },
        { key: 'paid', header: 'Paid at counter', format: 'money' },
        { key: 'charged', header: 'Charged to client', format: 'money' },
        { key: 'state', header: 'Status', width: 20 },
      ],
      rows: data.bills.map((bill) => ({ ...bill })),
    }),
  });
}

/**
 * Old ServiceHeadWiseIncomeReport and EmergencyReportServiceWise: per service over a period, the units and fees billed,
 * those cancelled (on their cancel date) and the net, by group.
 */
export function serviceIncomeReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hospital.service-income',
    title: 'OPD service income',
    group: 'Hospital',
    description: 'Per service: units and fees billed, cancelled and net over a period, grouped.',
    params: z.strictObject({ from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const lineTotals = (cancelled: boolean) =>
        context.db
          .select({
            serviceId: opdBillLines.serviceId,
            serviceName: services.name,
            groupName: serviceGroups.name,
            qty: sumOf(opdBillLines.qty),
            fees: sumOf(opdBillLines.fee),
          })
          .from(opdBillLines)
          .innerJoin(opdBills, eq(opdBills.id, opdBillLines.billId))
          .innerJoin(services, eq(services.id, opdBillLines.serviceId))
          .innerJoin(serviceGroups, eq(serviceGroups.id, services.groupId))
          .where(
            cancelled
              ? and(
                  eq(opdBills.status, 'cancelled'),
                  gte(opdBills.cancelledOn, params.from),
                  lte(opdBills.cancelledOn, params.to),
                )
              : and(gte(opdBills.billedOn, params.from), lte(opdBills.billedOn, params.to)),
          )
          .groupBy(opdBillLines.serviceId, services.name, serviceGroups.name);
      const [billed, cancelled] = await Promise.all([lineTotals(false), lineTotals(true)]);
      const keys = new Map<string, { serviceName: string; groupName: string }>();
      for (const row of [...billed, ...cancelled]) {
        keys.set(row.serviceId!, { serviceName: row.serviceName, groupName: row.groupName });
      }
      const rows = [...keys.entries()]
        .map(([serviceId, names]) => {
          const sold = billed.find((row) => row.serviceId === serviceId);
          const back = cancelled.find((row) => row.serviceId === serviceId);
          const fees = cents(sold?.fees ?? 0);
          const cancelledFees = cents(back?.fees ?? 0);
          return {
            ...names,
            qty: sold?.qty ?? 0,
            fees,
            cancelledQty: back?.qty ?? 0,
            cancelledFees,
            netFees: cents(fees - cancelledFees),
          };
        })
        .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.serviceName.localeCompare(b.serviceName));
      const total = (key: 'fees' | 'cancelledFees' | 'netFees') => cents(rows.reduce((sum, row) => sum + row[key], 0));
      return { rows, fees: total('fees'), cancelledFees: total('cancelledFees'), netFees: total('netFees') };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('service-income') },
    xlsx: (data) => ({
      columns: [
        { key: 'groupName', header: 'Group', width: 20 },
        { key: 'serviceName', header: 'Service', width: 28 },
        { key: 'qty', header: 'Units', format: 'integer' },
        { key: 'fees', header: 'Fees', format: 'money' },
        { key: 'cancelledQty', header: 'Units cancelled', format: 'integer' },
        { key: 'cancelledFees', header: 'Fees cancelled', format: 'money' },
        { key: 'netFees', header: 'Net fees', format: 'money' },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}
