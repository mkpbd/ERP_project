import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { chart, type TreatmentDesk } from '../../application/treatment.handlers.js';
import { ageText } from './rx.reports.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

const ROUTE_LABELS: Record<string, string> = {
  oral: 'Oral',
  iv: 'IV',
  im: 'IM',
  sc: 'SC',
  topical: 'Topical',
  inhaled: 'Inhaled',
  rectal: 'Rectal',
  other: 'Other',
};

function scheduleText(order: { schedule: string; times: readonly string[]; intervalHours: number | null }): string {
  if (order.schedule === 'times') return order.times.join(', ');
  if (order.schedule === 'interval') return `Every ${order.intervalHours} h`;
  if (order.schedule === 'once') return 'Once';
  return 'When needed';
}

async function patientOf(desk: TreatmentDesk, organization: OrganizationProfile, admissionId: string) {
  const [admission] = await desk.emr.inpatients.find([admissionId]);
  if (!admission) throw new NotFoundError('admission');
  const patient = (await desk.emr.patients.find([admission.patientId])).get(admission.patientId);
  if (!patient) throw new NotFoundError('patient');
  return { admission, patient: { ...patient, uhidLabel: `${await organization.patientIdPrefix()}${patient.uhid}` } };
}

/** Old medication administration (AppliedMedicationDose against TreatmentDoseTiming): a day's chart. */
export function medicationChartReport(desk: TreatmentDesk, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'clinical.medication-chart',
    title: 'Medication chart',
    group: 'Clinical',
    description: "An admitted patient's day: each order's due doses given, missed or outstanding, and prn doses.",
    params: z.strictObject({ admissionId: z.uuid(), day: z.iso.date() }),
    async load(params) {
      const { patient } = await patientOf(desk, organization, params.admissionId);
      const view = await chart(desk, params.admissionId, params.day, 'medicine');
      const userIds = [
        ...new Set(
          view.orders.flatMap((order) => [
            ...order.slots.flatMap((slot) => (slot.record ? [slot.record.recordedBy] : [])),
            ...order.doses.map((dose) => dose.recordedBy),
          ]),
        ),
      ];
      const users = new Map(
        (userIds.length ? await desk.emr.users.findSummaries(userIds) : []).map((user) => [user.id, user.displayName]),
      );
      return {
        ...view,
        patient,
        orders: view.orders.map((order) => ({
          ...order,
          routeLabel: order.route ? (ROUTE_LABELS[order.route] ?? order.route) : null,
          scheduleText: scheduleText(order),
          slots: order.slots.map((slot) => ({
            ...slot,
            by: slot.record ? (users.get(slot.record.recordedBy) ?? '') : null,
          })),
          doses: order.doses.map((dose) => ({ ...dose, by: users.get(dose.recordedBy) ?? '' })),
        })),
      };
    },
    describe: (_params, data) => `${data.admission.number} · ${data.patient.name} · ${data.day}`,
    pdf: { engine: 'html', template: template('medication-chart'), landscape: true },
  });
}

/** Old non-medication orders' chart: a day's nursing care, each due time done, missed or outstanding. */
export function careChartReport(desk: TreatmentDesk, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'clinical.care-chart',
    title: 'Nursing care chart',
    group: 'Clinical',
    description: "An admitted patient's day of nursing care: each order's due times done, missed or outstanding.",
    params: z.strictObject({ admissionId: z.uuid(), day: z.iso.date() }),
    async load(params) {
      const { patient } = await patientOf(desk, organization, params.admissionId);
      const view = await chart(desk, params.admissionId, params.day, 'care');
      const userIds = [
        ...new Set(
          view.orders.flatMap((order) => [
            ...order.slots.flatMap((slot) => (slot.record ? [slot.record.recordedBy] : [])),
            ...order.doses.map((dose) => dose.recordedBy),
          ]),
        ),
      ];
      const users = new Map(
        (userIds.length ? await desk.emr.users.findSummaries(userIds) : []).map((user) => [user.id, user.displayName]),
      );
      return {
        ...view,
        patient,
        orders: view.orders.map((order) => ({
          ...order,
          scheduleText: scheduleText(order),
          slots: order.slots.map((slot) => ({
            ...slot,
            by: slot.record ? (users.get(slot.record.recordedBy) ?? '') : null,
          })),
          doses: order.doses.map((dose) => ({ ...dose, by: users.get(dose.recordedBy) ?? '' })),
        })),
      };
    },
    describe: (_params, data) => `${data.admission.number} · ${data.patient.name} · ${data.day}`,
    pdf: { engine: 'html', template: template('care-chart'), landscape: true },
  });
}

/** Old discharge certificate with treatment, diet and advice on discharge: the signed discharge summary. */
export function dischargeSummaryReport(desk: TreatmentDesk, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'clinical.discharge-summary',
    title: 'Discharge summary',
    group: 'Clinical',
    description: 'The signed discharge summary: diagnosis, course, condition, medicines, diet, advice and follow-up.',
    params: z.strictObject({ admissionId: z.uuid() }),
    async load(params, report) {
      const summary = await desk.summaryView(params.admissionId);
      if (summary.status !== 'signed') throw new DomainError('not_signed', 'The discharge summary is not signed');
      const { admission, patient } = await patientOf(desk, organization, params.admissionId);
      const doctor = (await desk.emr.clinic.doctors([summary.doctorId])).get(summary.doctorId);
      return {
        organization: report.header,
        summary,
        admission,
        patient: { ...patient, age: ageText(patient.dateOfBirth, desk.emr.dayOf(summary.signedAt!)) },
        doctor: { name: doctor?.name ?? '', degrees: doctor?.degrees ?? null },
      };
    },
    describe: (_params, data) => `${data.admission.number} · ${data.patient.name}`,
    pdf: { engine: 'html', template: template('discharge-summary'), bare: true },
  });
}
