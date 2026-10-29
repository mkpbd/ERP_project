import { and, desc, inArray, sql } from 'drizzle-orm';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { DiagnosticOrders } from '../../../../shared/application/contracts/diagnostic-orders.js';
import type { PatientDocument, PatientDocumentSource } from '../../../../shared/application/patient-documents.js';
import { imagingStudies, labResults, labSamples } from './laboratory.schema.js';

/**
 * A patient's lab reports (samples with a verified result) and signed imaging reports, for the patient portal. A
 * report of a bill the patient still owes on is held, as at the counter.
 */
export function laboratoryDocuments(context: DbContext, orders: DiagnosticOrders): PatientDocumentSource {
  return {
    kind: 'laboratory',
    async list(patientId: string): Promise<PatientDocument[]> {
      const bills = await orders.ofPatient(patientId);
      if (bills.length === 0) return [];
      const billIds = bills.map((bill) => bill.billId);
      const owes = new Map(bills.map((bill) => [bill.billId, bill.payer === 'patient' && bill.due > 0]));
      const held = (billId: string) => (owes.get(billId) ? 'The bill has a due; pay it to see the report' : null);
      const samples = await context.db
        .select({
          id: labSamples.id,
          number: labSamples.labNumber,
          on: labSamples.collectedOn,
          billId: labSamples.billId,
        })
        .from(labSamples)
        .where(
          and(
            inArray(labSamples.billId, billIds),
            sql`exists (select 1 from ${labResults} where ${labResults.sampleId} = ${labSamples.id} and ${labResults.status} in ('verified', 'delivered'))`,
          ),
        )
        .orderBy(desc(labSamples.collectedOn));
      const studies = await context.db
        .select({
          id: imagingStudies.id,
          number: imagingStudies.accessionNumber,
          on: imagingStudies.doneOn,
          billId: imagingStudies.billId,
        })
        .from(imagingStudies)
        .where(and(inArray(imagingStudies.billId, billIds), inArray(imagingStudies.status, ['signed', 'delivered'])))
        .orderBy(desc(imagingStudies.doneOn));
      return [
        ...samples.map((sample) => ({
          ref: `lab-report:${sample.id}`,
          kind: 'lab-report',
          title: 'Laboratory report',
          number: sample.number,
          on: sample.on,
          reportKey: 'laboratory.lab-report',
          params: { sampleId: sample.id },
          heldReason: held(sample.billId),
        })),
        ...studies.map((study) => ({
          ref: `imaging-report:${study.id}`,
          kind: 'imaging-report',
          title: 'Imaging report',
          number: study.number,
          on: study.on,
          reportKey: 'laboratory.imaging-report',
          params: { studyId: study.id },
          heldReason: held(study.billId),
        })),
      ];
    },
  };
}
