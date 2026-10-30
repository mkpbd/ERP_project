import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import type { PatientDirectory } from '../../../../shared/application/contracts/patient-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { HistoryReadRepository } from '../../application/history.messages.js';

const KIND_LABELS: Record<string, string> = {
  prescription: 'Prescription',
  'lab-report': 'Laboratory report',
  'imaging-report': 'Imaging report',
  'discharge-summary': 'Discharge certificate',
  note: 'Clinical note',
};

/** A record of the old system as it was written there, with its results when it is a lab report. */
export function historyRecordReport(
  read: HistoryReadRepository,
  patients: PatientDirectory,
  organization: OrganizationProfile,
): ReportDefinition {
  return defineReport({
    key: 'clinical.history-record',
    title: 'Record from the old system',
    group: 'Clinical',
    description: 'A prescription, report, discharge certificate or note brought over from the old system.',
    params: z.strictObject({ recordId: z.uuid() }),
    async load(params, report) {
      const record = await read.find(params.recordId);
      if (!record) throw new NotFoundError('history_record');
      const patient = (await patients.find([record.patientId])).get(record.patientId);
      if (!patient) throw new NotFoundError('patient');
      return {
        organization: report.header,
        record: { ...record, kindLabel: KIND_LABELS[record.kind] ?? record.kind },
        patient: { ...patient, uhidLabel: `${await organization.patientIdPrefix()}${patient.uhid}` },
      };
    },
    describe: (_params, data) => `${data.record.title} · ${data.patient.name}`,
    pdf: { engine: 'html', template: fileURLToPath(new URL('./history-record.hbs', import.meta.url)) },
  });
}
