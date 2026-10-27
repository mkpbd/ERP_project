import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { DiagnosticOrders } from '../../../../shared/application/contracts/diagnostic-orders.js';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import type { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { code39Svg } from '../../../../shared/infrastructure/reports/code39.js';
import type { ImagingReadRepository } from '../../application/imaging.messages.js';
import type { LabReadRepository } from '../../application/lab.messages.js';
import { ageInDays } from '../../domain/lab.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** A range as printed: "4.0 – 11.0", "< 200", "> 40", or its text. */
function rangeText(value: { low: number | null; high: number | null; normalText: string | null }): string | null {
  if (value.normalText) return value.normalText;
  if (value.low !== null && value.high !== null) return `${value.low} – ${value.high}`;
  if (value.high !== null) return `< ${value.high}`;
  if (value.low !== null) return `> ${value.low}`;
  return null;
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
    description: "A sample's verified results with units, normal ranges and flags, signed by the verifier.",
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
          values: result.values.map((value) => ({
            ...value,
            range: rangeText(value),
            mark: value.flag === 'high' ? 'H' : value.flag === 'low' ? 'L' : null,
          })),
        })),
        pending: sample.results.filter((result) => result.status === 'entered' || result.status === 'pending').length,
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
