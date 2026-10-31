import { fileURLToPath } from 'node:url';
import { and, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { DepartmentStock } from '../../../../shared/application/contracts/department-stock.js';
import type { DiagnosticOrders } from '../../../../shared/application/contracts/diagnostic-orders.js';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import type { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { code39Svg } from '../../../../shared/infrastructure/reports/code39.js';
import type { ImagingReadRepository } from '../../application/imaging.messages.js';
import type { LabReadRepository } from '../../application/lab.messages.js';
import type { CultureReport } from '../../domain/culture.js';
import { ageInDays } from '../../domain/lab.js';
import { labReagentUses } from '../persistence/laboratory.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** A range as printed: "4.0 – 11.0", "< 200", "> 40", or its text. */
function rangeText(value: { low: number | null; high: number | null; normalText: string | null }): string | null {
  if (value.normalText) return value.normalText;
  if (value.low !== null && value.high !== null) return `${value.low} – ${value.high}`;
  if (value.high !== null) return `< ${value.high}`;
  if (value.low !== null) return `> ${value.low}`;
  return null;
}

/** A culture as printed: the microscopy that was read, the organisms as columns of the antibiogram. */
function cultureView(culture: CultureReport) {
  const microscopy = (
    [
      ['Pus cells', culture.pusCells],
      ['Epithelial cells', culture.epithelialCells],
      ['RBC', culture.rbc],
    ] as const
  ).flatMap(([name, value]) => (value ? [{ name, value }] : []));
  const details = (
    [
      ['Colony count', culture.colonyCount],
      ['Incubation', culture.incubation],
      ['Culture media', culture.media],
    ] as const
  ).flatMap(([name, value]) => (value ? [{ name, value }] : []));
  return {
    ...culture,
    microscopy,
    hasMicroscopy: microscopy.length > 0 || !!culture.microscopyNote || !!culture.analyzer,
    details,
    hasZone: culture.sensitivity.some((row) => row.zone),
    rows: culture.sensitivity.map((row) => ({ ...row, results: row.results.map((result) => result ?? '') })),
  };
}

/**
 * Old lab report publishing (`/diagnosis/lab-report-published2`): a sample's verified results, each test's values
 * with unit, normal range and the out-of-range ones marked, signed by who verified them. Tests not verified yet are
 * left out; a sample with none is not printed.
 */
export function labReport(
  read: LabReadRepository,
  orders: DiagnosticOrders,
  organization: OrganizationProfile,
  users: UserDirectory,
): ReportDefinition {
  return defineReport({
    key: 'laboratory.lab-report',
    title: 'Laboratory report',
    group: 'Laboratory',
    description:
      "A sample's verified results (values with units, normal ranges and flags; cultures with their antibiogram; " +
      'written reports), signed by the verifier.',
    params: z.strictObject({ sampleId: z.uuid() }),
    async load(params, report) {
      const sample = await read.sample(params.sampleId);
      if (!sample) throw new NotFoundError('sample');
      const [order] = await orders.find([sample.billId]);
      if (!order) throw new NotFoundError('diagnostic_bill');
      const ready = sample.results.filter((result) => result.status === 'verified' || result.status === 'delivered');
      if (ready.length === 0) throw new DomainError('not_verified', 'No result of this sample is verified yet');
      const verifierIds = [...new Set(ready.flatMap((result) => (result.verifiedBy ? [result.verifiedBy] : [])))];
      const verifiers = (verifierIds.length ? await users.findSummaries(verifierIds) : []).map(
        (user) => user.displayName,
      );
      const days = ageInDays(order.patient.dateOfBirth, sample.collectedOn);
      const years = Math.floor(days / 365.25);
      const prefix = await organization.patientIdPrefix();
      return {
        organization: report.header,
        sample: {
          ...sample,
          departmentName: order.tests.find((test) => test.departmentId === sample.departmentId)?.departmentName ?? null,
        },
        order: {
          ...order,
          uhidLabel: `${prefix}${order.patient.uhid}`,
          age: years > 0 ? `${years} years` : `${days} days`,
        },
        tests: ready.map((result) => ({
          ...result,
          testName: order.tests.find((test) => test.line === result.line)?.testName ?? null,
          culture: result.culture ? cultureView(result.culture) : null,
          values: result.values.map((value) => ({
            ...value,
            range: rangeText(value),
            mark: value.flag === 'high' ? 'H' : value.flag === 'low' ? 'L' : null,
          })),
        })),
        pending: sample.results.filter((result) => result.status === 'entered' || result.status === 'pending').length,
        hasValues: ready.some((result) => result.values.length > 0),
        hasCulture: ready.some((result) => result.culture?.growth),
        verifiers: verifiers.join(', '),
        barcode: code39Svg(sample.labNumber),
      };
    },
    describe: (_params, data) => `${data.sample.labNumber} · ${data.order.patient.name}`,
    pdf: { engine: 'html', template: template('lab-report'), bare: true },
  });
}

/**
 * Old radiology report publishing (`/diagnostic/radiological-report-published`): a signed imaging report, its findings
 * and impression as written, signed for the radiologist. A report not signed is not printed.
 */
export function imagingReport(
  read: ImagingReadRepository,
  orders: DiagnosticOrders,
  organization: OrganizationProfile,
): ReportDefinition {
  return defineReport({
    key: 'laboratory.imaging-report',
    title: 'Imaging report',
    group: 'Laboratory',
    description: 'A signed imaging report: findings and impression, signed for the radiologist.',
    params: z.strictObject({ studyId: z.uuid() }),
    async load(params, report) {
      const study = await read.study(params.studyId);
      if (!study) throw new NotFoundError('imaging_study');
      if (study.status === 'done') throw new DomainError('not_signed', 'The report is not signed yet');
      const [order] = await orders.find([study.billId]);
      if (!order) throw new NotFoundError('diagnostic_bill');
      const radiologist = study.radiologistId
        ? ((await orders.doctors([study.radiologistId])).get(study.radiologistId)?.name ?? null)
        : null;
      const days = ageInDays(order.patient.dateOfBirth, study.doneOn);
      const years = Math.floor(days / 365.25);
      return {
        organization: report.header,
        study: { ...study, testName: order.tests.find((test) => test.line === study.line)?.testName ?? null },
        order: {
          ...order,
          uhidLabel: `${await organization.patientIdPrefix()}${order.patient.uhid}`,
          age: years > 0 ? `${years} years` : `${days} days`,
        },
        radiologist,
        barcode: code39Svg(study.accessionNumber),
      };
    },
    describe: (_params, data) => `${data.study.accessionNumber} · ${data.order.patient.name}`,
    pdf: { engine: 'html', template: template('imaging-report'), bare: true },
  });
}

/**
 * Old ReAgentManagement usage (ReAgentManualUses and the auto-consumption): what the tests used up over a period, item
 * by item, and what the store was short of (to be entered by hand).
 */
export function reagentUsageReport(context: DbContext, stock: DepartmentStock): ReportDefinition {
  return defineReport({
    key: 'laboratory.reagent-usage',
    title: 'Reagent usage',
    group: 'Laboratory',
    description: 'Per store item: tests that used it, the quantity used up and the quantity short, over a period.',
    params: z.strictObject({ from: z.iso.date(), to: z.iso.date() }),
    async load(params) {
      if (params.from > params.to) throw new DomainError('invalid_period', 'The start date is after the end date');
      const rows = await context.db
        .select({
          variantId: labReagentUses.variantId,
          tests: sql<number>`count(distinct ${labReagentUses.sourceId})`.mapWith(Number),
          used: sql<number>`coalesce(sum(case when ${labReagentUses.consumptionNumber} is not null then ${labReagentUses.qty} end), 0)`.mapWith(
            Number,
          ),
          short:
            sql<number>`coalesce(sum(case when ${labReagentUses.consumptionNumber} is null then ${labReagentUses.qty} end), 0)`.mapWith(
              Number,
            ),
        })
        .from(labReagentUses)
        .where(and(gte(labReagentUses.usedOn, params.from), lte(labReagentUses.usedOn, params.to)))
        .groupBy(labReagentUses.variantId);
      const items = await stock.items(rows.map((row) => row.variantId));
      return {
        rows: rows
          .map((row) => ({
            ...row,
            name: items.get(row.variantId)?.name ?? '—',
            unit: items.get(row.variantId)?.unit ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('reagent-usage') },
    xlsx: (data) => ({
      columns: [
        { key: 'name', header: 'Item', width: 34 },
        { key: 'unit', header: 'Unit', width: 10 },
        { key: 'tests', header: 'Tests', format: 'integer' },
        { key: 'used', header: 'Used up', format: 'decimal' },
        { key: 'short', header: 'Short', format: 'decimal' },
      ],
      rows: data.rows,
    }),
  });
}
