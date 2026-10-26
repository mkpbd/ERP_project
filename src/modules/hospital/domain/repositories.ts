import type { StoredFile } from '../../../shared/domain/uploads.js';
import type { IdType, Patient } from './patient.js';

export interface PatientMatch {
  readonly id: string;
  readonly uhid: number;
  readonly fullName: string;
  readonly dateOfBirth: string;
  readonly mobileNo: string | null;
  readonly contactMobileNo: string | null;
}

export abstract class PatientRepository {
  abstract findForUpdate(id: string): Promise<Patient | null>;
  abstract insert(patient: Patient): Promise<void>;
  abstract update(patient: Patient): Promise<void>;
  /** The next serial of the year, counted under a row lock (never handed out twice). */
  abstract nextSerial(year: number): Promise<number>;
  /** Active patients reached on the same phone (their own or their contact's) with the same name or birth date. */
  abstract possibleDuplicates(params: {
    phone: string;
    fullName: string;
    dateOfBirth: string | null;
    excludeId?: string;
  }): Promise<PatientMatch[]>;
  /** The UHID of the active patient holding this ID document, if any. */
  abstract holderOf(idType: IdType, idNo: string, excludeId?: string): Promise<number | null>;
  abstract savePhoto(patientId: string, photo: StoredFile, by: string, now: Date): Promise<void>;
  abstract removePhoto(patientId: string): Promise<boolean>;
}
