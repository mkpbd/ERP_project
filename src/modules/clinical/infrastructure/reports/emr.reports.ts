import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import type { EmrDesk } from '../../application/emr.handlers.js';
import { ageText } from './rx.reports.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

const KIND_LABELS: Record<string, string> = {
  round: 'Round',
  consult: 'Consultation',
  procedure: 'Procedure',
  transfer: 'Transfer',
  icu: 'ICU course',
  handover: 'Handover',
};

/** The admission, its patient (with UHID label) and their doctor's details for a certificate or notes. */
async function stay(desk: EmrDesk, organization: OrganizationProfile, admissionId: string) {
  const [admission] = await desk.inpatients.find([admissionId]);
  if (!admission) throw new NotFoundError('admission');
  const patient = (await desk.patients.find([admission.patientId])).get(admission.patientId);
  if (!patient) throw new NotFoundError('patient');
  return {
    admission,
    patient: { ...patient, uhidLabel: `${await organization.patientIdPrefix()}${patient.uhid}` },
  };
}

async function doctor(desk: EmrDesk, id: string) {
  const found = (await desk.clinic.doctors([id])).get(id);
  return { name: found?.name ?? '', degrees: found?.degrees ?? null };
}

/** Old EMR notes pages printed together: the stay's notes in the order they happened. */
export function caseNotesReport(desk: EmrDesk, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'clinical.case-notes',
    title: 'Case notes',
    group: 'Clinical',
    description: "An admitted patient's notes: rounds, consultations, procedures, transfers, ICU course, handovers.",
    params: z.strictObject({ admissionId: z.uuid() }),
    async load(params) {
      const { admission, patient } = await stay(desk, organization, params.admissionId);
      const notes = await desk.named(await desk.read.notes(admission.id));
      return {
        admission,
        patient,
        notes: notes.map((entry) => ({ ...entry, kindLabel: KIND_LABELS[entry.kind] ?? entry.kind })),
      };
    },
    describe: (_params, data) => `${data.admission.number} · ${data.patient.name}`,
    pdf: { engine: 'html', template: template('case-notes') },
  });
}

/** Old EMR death record print: the death certificate of an admitted patient. */
export function deathCertificateReport(desk: EmrDesk, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'clinical.death-certificate',
    title: 'Death certificate',
    group: 'Clinical',
    description: 'The death of an admitted patient: time, causes as certified, guardian and certifying doctor.',
    params: z.strictObject({ deathRecordId: z.uuid() }),
    async load(params, report) {
      const record = await desk.read.death(params.deathRecordId);
      if (!record) throw new NotFoundError('death_record');
      if (record.voidedAt) throw new DomainError('record_void', `${record.number} is void`);
      const { admission, patient } = await stay(desk, organization, record.admissionId);
      return {
        organization: report.header,
        record,
        admission,
        patient: { ...patient, age: ageText(patient.dateOfBirth, desk.dayOf(record.diedAt)) },
        doctor: await doctor(desk, record.doctorId),
      };
    },
    describe: (_params, data) => `${data.record.number} · ${data.patient.name}`,
    pdf: { engine: 'html', template: template('death-certificate'), bare: true },
  });
}

/** Old EMR BirthCertificate print. */
export function birthCertificateReport(desk: EmrDesk, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'clinical.birth-certificate',
    title: 'Birth certificate',
    group: 'Clinical',
    description: 'A child born to an admitted mother: time, sex, weight, delivery, parents and attending doctor.',
    params: z.strictObject({ birthRecordId: z.uuid() }),
    async load(params, report) {
      const record = await desk.read.birth(params.birthRecordId);
      if (!record) throw new NotFoundError('birth_record');
      if (record.voidedAt) throw new DomainError('record_void', `${record.number} is void`);
      const { admission, patient } = await stay(desk, organization, record.admissionId);
      return {
        organization: report.header,
        record: {
          ...record,
          deliveryLabel: { normal: 'Normal', caesarean: 'Caesarean section', assisted: 'Assisted' }[
            record.deliveryMode
          ],
        },
        admission,
        mother: patient,
        doctor: await doctor(desk, record.doctorId),
      };
    },
    describe: (_params, data) => `${data.record.number} · ${data.mother.name}`,
    pdf: { engine: 'html', template: template('birth-certificate'), bare: true },
  });
}
