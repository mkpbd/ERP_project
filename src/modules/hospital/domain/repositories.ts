import type { StoredFile } from '../../../shared/domain/uploads.js';
import type { Appointment, DoctorFees, Sitting } from './appointment.js';
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

export interface BookableDoctor extends DoctorFees {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly isConsultant: boolean;
}

export abstract class AppointmentRepository {
  abstract findForUpdate(id: string): Promise<Appointment | null>;
  abstract insert(appointment: Appointment): Promise<void>;
  abstract update(appointment: Appointment): Promise<void>;
  abstract doctor(id: string): Promise<BookableDoctor | null>;
  /** The doctor's active sitting on a weekday. */
  abstract sitting(doctorId: string, dayOfWeek: number): Promise<Sitting | null>;
  /** Why the doctor is off that day, or undefined when they sit. */
  abstract closure(doctorId: string, date: string): Promise<{ reason: string | null } | undefined>;
  /** Serials booked (not cancelled) with the doctor that day. */
  abstract takenSerials(doctorId: string, date: string): Promise<Set<number>>;
  /** An active patient's name and the number to reach them on (their own mobile, else their contact's). */
  abstract patientContact(id: string): Promise<{ id: string; fullName: string; mobileNo: string } | null>;
}
