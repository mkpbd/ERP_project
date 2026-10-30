import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { PatientDocument, PatientDocumentSource } from '../../../../shared/application/patient-documents.js';
import { dischargeSummaries, historyRecords, prescriptions } from './clinical.schema.js';

/**
 * A patient's signed prescriptions and discharge summaries, and the records brought over from the old system that
 * were finalised there (step 13f), for the patient portal.
 */
export function clinicalDocuments(context: DbContext, timeZone: string): PatientDocumentSource {
  return {
    kind: 'clinical',
    async list(patientId: string): Promise<PatientDocument[]> {
      const rx = await context.db
        .select({ id: prescriptions.id, number: prescriptions.number, on: prescriptions.visitOn })
        .from(prescriptions)
        .where(and(eq(prescriptions.patientId, patientId), eq(prescriptions.status, 'signed')))
        .orderBy(desc(prescriptions.visitOn));
      const summaries = await context.db
        .select({
          admissionId: dischargeSummaries.admissionId,
          on: sql<string>`to_char(${dischargeSummaries.signedAt} at time zone ${timeZone}, 'YYYY-MM-DD')`,
        })
        .from(dischargeSummaries)
        .where(and(eq(dischargeSummaries.patientId, patientId), eq(dischargeSummaries.status, 'signed')))
        .orderBy(desc(dischargeSummaries.signedAt));
      const history = await context.db
        .select({
          id: historyRecords.id,
          kind: historyRecords.kind,
          title: historyRecords.title,
          number: historyRecords.number,
          on: historyRecords.recordedOn,
        })
        .from(historyRecords)
        .where(and(eq(historyRecords.patientId, patientId), eq(historyRecords.shared, true)))
        .orderBy(desc(historyRecords.recordedOn));
      return [
        ...rx.map((entry) => ({
          ref: `prescription:${entry.id}`,
          kind: 'prescription',
          title: 'Prescription',
          number: entry.number,
          on: entry.on,
          reportKey: 'clinical.prescription',
          params: { prescriptionId: entry.id },
          heldReason: null,
        })),
        ...summaries.map((entry) => ({
          ref: `discharge-summary:${entry.admissionId}`,
          kind: 'discharge-summary',
          title: 'Discharge summary',
          number: '',
          on: entry.on,
          reportKey: 'clinical.discharge-summary',
          params: { admissionId: entry.admissionId },
          heldReason: null,
        })),
        ...history.map((entry) => ({
          ref: `history:${entry.id}`,
          kind: entry.kind,
          title: `${entry.title} (old system)`,
          number: entry.number ?? '',
          on: entry.on,
          reportKey: 'clinical.history-record',
          params: { recordId: entry.id },
          heldReason: null,
        })),
      ];
    },
  };
}
