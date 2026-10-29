import type { BirthDetails, ClinicalNote, DeathDetails } from './emr.js';
import type { PhraseKind, Prescription, TemplateProps } from './prescription.js';
import type { SummaryContent, TreatmentOrder } from './treatment.js';

export interface Phrase {
  readonly id: string;
  /** Null: shared by every doctor. */
  readonly doctorId: string | null;
  readonly kind: PhraseKind;
  readonly text: string;
  readonly shortKey: string | null;
  readonly genericId: string | null;
}

export abstract class ClinicalRepository {
  abstract nextSerial(kind: string, year: number): Promise<number>;
  /** The patient's prescriptions by this doctor not cancelled. */
  abstract visitCount(patientId: string, doctorId: string): Promise<number>;
  /** The prescription written for the appointment (not cancelled), if any. */
  abstract ofAppointment(appointmentId: string): Promise<{ id: string; number: string } | null>;
  abstract insert(prescription: Prescription): Promise<void>;
  abstract forUpdate(id: string): Promise<Prescription | null>;
  /** Saves the prescription with its lines (replaced). */
  abstract update(prescription: Prescription): Promise<void>;

  abstract phrase(id: string): Promise<Phrase | null>;
  abstract insertPhrase(phrase: Phrase): Promise<void>;
  abstract updatePhrase(phrase: Phrase): Promise<void>;
  abstract deletePhrase(id: string): Promise<void>;

  abstract template(id: string): Promise<TemplateProps | null>;
  abstract insertTemplate(template: TemplateProps): Promise<void>;
  abstract updateTemplate(template: TemplateProps): Promise<void>;
  abstract deleteTemplate(id: string): Promise<void>;
}

export interface DeathRecordRow extends DeathDetails {
  readonly id: string;
  readonly number: string;
  readonly admissionId: string;
  readonly patientId: string;
  readonly doctorId: string;
  readonly recordedBy: string;
  readonly voidedAt: Date | null;
  readonly voidReason: string | null;
  readonly version: number;
  readonly createdAt: Date;
}

export interface BirthRecordRow extends BirthDetails {
  readonly id: string;
  readonly number: string;
  readonly admissionId: string;
  readonly motherId: string;
  readonly doctorId: string;
  readonly recordedBy: string;
  readonly voidedAt: Date | null;
  readonly voidReason: string | null;
  readonly version: number;
  readonly createdAt: Date;
}

export abstract class EmrRepository {
  abstract insertNote(note: ClinicalNote): Promise<void>;
  abstract noteForUpdate(id: string): Promise<ClinicalNote | null>;
  abstract updateNote(note: ClinicalNote): Promise<void>;
  /** The admission's death record not voided, if any. */
  abstract liveDeath(admissionId: string): Promise<{ id: string; number: string } | null>;
  abstract insertDeath(record: DeathRecordRow): Promise<void>;
  abstract deathForUpdate(id: string): Promise<DeathRecordRow | null>;
  abstract insertBirth(record: BirthRecordRow): Promise<void>;
  abstract birthForUpdate(id: string): Promise<BirthRecordRow | null>;
  abstract voidRecord(kind: 'death' | 'birth', id: string, reason: string, at: Date): Promise<void>;
}

export interface DoseRecordRow {
  readonly id: string;
  readonly orderId: string;
  readonly admissionId: string;
  readonly dueAt: Date | null;
  readonly outcome: 'given' | 'missed';
  readonly givenAt: Date | null;
  readonly reason: string | null;
  readonly recordedBy: string;
  readonly createdAt: Date;
}

export interface SummaryRow extends SummaryContent {
  readonly id: string;
  readonly admissionId: string;
  readonly patientId: string;
  readonly doctorId: string;
  readonly status: 'draft' | 'signed';
  readonly signedBy: string | null;
  readonly signedAt: Date | null;
  readonly writtenBy: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export abstract class TreatmentRepository {
  abstract insertOrder(order: TreatmentOrder): Promise<void>;
  abstract orderForUpdate(id: string): Promise<TreatmentOrder | null>;
  /** Saves the order's state and its events. */
  abstract updateOrder(order: TreatmentOrder): Promise<void>;
  /** Records a dose; a due time answered already is a conflict. */
  abstract insertDose(dose: DoseRecordRow): Promise<void>;
  abstract summaryForUpdate(admissionId: string): Promise<SummaryRow | null>;
  abstract saveSummary(summary: SummaryRow, isNew: boolean): Promise<void>;
}
