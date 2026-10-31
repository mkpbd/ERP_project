import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { dayBounds } from '../../../../shared/domain/zoned-time.js';
import type { ObservationDesk } from '../../application/observation.handlers.js';
import type { VitalFlag } from '../../domain/observation.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

const FLAG_LABELS: Record<VitalFlag, string> = {
  fever: 'Fever',
  hypothermia: 'Low temperature',
  tachycardia: 'Fast pulse',
  bradycardia: 'Slow pulse',
  tachypnoea: 'Fast breathing',
  bradypnoea: 'Slow breathing',
  low_spo2: 'Low SpO2',
  hypotension: 'Low BP',
  hypertension: 'High BP',
  hypoglycaemia: 'Low sugar',
  hyperglycaemia: 'High sugar',
  not_alert: 'Not alert',
};

/** Old follow-up sheet print: an admitted patient's observations over a period, flags marked, struck entries shown. */
export function observationChartReport(desk: ObservationDesk, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'clinical.observation-chart',
    title: 'Observation chart',
    group: 'Clinical',
    description:
      "An admitted patient's vital signs and observations over a period, with the readings to report marked.",
    params: z.strictObject({ admissionId: z.uuid(), from: z.iso.date(), to: z.iso.date() }),
    async load(params) {
      if (params.from > params.to) throw new DomainError('invalid_period', 'The start date is after the end date');
      const { emr } = desk;
      const [admission] = await emr.inpatients.find([params.admissionId]);
      if (!admission) throw new NotFoundError('admission');
      const patient = (await emr.patients.find([admission.patientId])).get(admission.patientId);
      if (!patient) throw new NotFoundError('patient');
      const timeZone = emr.settings.timeZone;
      const rows = await desk.read.list(
        params.admissionId,
        dayBounds(params.from, timeZone)[0],
        dayBounds(params.to, timeZone)[1],
      );
      const observations = (await desk.named(rows)).map((row) => ({
        ...row,
        bp: row.systolic !== null ? `${row.systolic}/${row.diastolic}` : null,
        flagText: row.flags.map((flag) => FLAG_LABELS[flag]).join(', '),
      }));
      return {
        from: params.from,
        to: params.to,
        admission,
        patient: { ...patient, uhidLabel: `${await organization.patientIdPrefix()}${patient.uhid}` },
        observations,
      };
    },
    describe: (_params, data) => `${data.admission.number} · ${data.patient.name} · ${data.from} to ${data.to}`,
    pdf: { engine: 'html', template: template('observation-chart'), landscape: true },
  });
}
