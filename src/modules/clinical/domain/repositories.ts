import type { PhraseKind, Prescription, TemplateProps } from './prescription.js';

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
