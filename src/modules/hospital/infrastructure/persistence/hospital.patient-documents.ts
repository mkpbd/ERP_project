import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { PatientDocument, PatientDocumentSource } from '../../../../shared/application/patient-documents.js';
import { diagnosticBills, ipdBills, opdBills } from './hospital.schema.js';

/** A patient's receipts and final indoor bills, for the patient portal. */
export function hospitalDocuments(context: DbContext, timeZone: string): PatientDocumentSource {
  return {
    kind: 'hospital',
    async list(patientId: string): Promise<PatientDocument[]> {
      const opd = await context.db
        .select({ id: opdBills.id, number: opdBills.number, on: opdBills.billedOn })
        .from(opdBills)
        .where(and(eq(opdBills.patientId, patientId), eq(opdBills.status, 'billed')))
        .orderBy(desc(opdBills.billedOn));
      const diagnostic = await context.db
        .select({
          id: diagnosticBills.id,
          number: diagnosticBills.number,
          on: sql<string>`to_char(${diagnosticBills.billedAt} at time zone ${timeZone}, 'YYYY-MM-DD')`,
        })
        .from(diagnosticBills)
        .where(and(eq(diagnosticBills.patientId, patientId), eq(diagnosticBills.status, 'billed')))
        .orderBy(desc(diagnosticBills.billedAt));
      const indoor = await context.db
        .select({ admissionId: ipdBills.admissionId, number: ipdBills.number, on: ipdBills.billedOn })
        .from(ipdBills)
        .where(and(eq(ipdBills.patientId, patientId), eq(ipdBills.status, 'billed')))
        .orderBy(desc(ipdBills.billedOn));
      return [
        ...opd.map((bill) => ({
          ref: `opd-receipt:${bill.id}`,
          kind: 'opd-receipt',
          title: 'Consultation receipt',
          number: bill.number,
          on: bill.on,
          reportKey: 'hospital.opd-receipt',
          params: { id: bill.id },
          heldReason: null,
        })),
        ...diagnostic.map((bill) => ({
          ref: `diagnostic-receipt:${bill.id}`,
          kind: 'diagnostic-receipt',
          title: 'Diagnostic receipt',
          number: bill.number,
          on: bill.on,
          reportKey: 'hospital.diagnostic-receipt',
          params: { id: bill.id },
          heldReason: null,
        })),
        ...indoor.map((bill) => ({
          ref: `ipd-bill:${bill.admissionId}`,
          kind: 'ipd-bill',
          title: 'Indoor bill',
          number: bill.number,
          on: bill.on,
          reportKey: 'hospital.ipd-bill',
          params: { admissionId: bill.admissionId },
          heldReason: null,
        })),
      ];
    },
  };
}
