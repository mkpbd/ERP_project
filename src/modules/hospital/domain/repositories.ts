import type { StoredFile } from '../../../shared/domain/uploads.js';
import type { Admission } from './admission.js';
import type { Appointment, DoctorFees, Sitting } from './appointment.js';
import type { IpdBill, IpdCharge, StayDays } from './ipd-bill.js';
import type { OpdBill, PaymentMethod } from './opd-bill.js';
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
  abstract corporateClientActive(id: string): Promise<boolean>;
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
  abstract patientContact(
    id: string,
  ): Promise<{ id: string; fullName: string; mobileNo: string; corporateClientId: string | null } | null>;
}

export interface OpdPolicy {
  readonly followUpDays: number;
  readonly defaultSharePercent: number;
  readonly counterDiscountPercent: number;
}

/** A doctor as billed: fees, own share (null = the policy's) and whether they see patients here. */
export interface BillableDoctor extends BookableDoctor {
  readonly sharePercent: number | null;
}

export interface BillableService {
  readonly id: string;
  readonly name: string;
  readonly rate: number;
  /** The share of the doctor who gives it; null = none. */
  readonly sharePercent: number | null;
  readonly isOpd: boolean;
  readonly isIpd: boolean;
  readonly isActive: boolean;
}

export interface CorporateClient {
  readonly id: string;
  readonly name: string;
  readonly payment: 'cash' | 'credit';
  readonly creditLimit: number | null;
  readonly discountPercent: number;
  readonly isActive: boolean;
}

export interface DoctorLedgerEntry {
  readonly doctorId: string;
  readonly entryOn: string;
  readonly kind: 'share' | 'reversal';
  /** The OPD bill, or the final indoor bill. */
  readonly billId: string | null;
  readonly ipdBillId?: string | null;
  readonly documentNumber: string;
  readonly amount: number;
}

export abstract class OpdBillRepository {
  abstract findForUpdate(id: string): Promise<OpdBill | null>;
  /** Saves the bill, its lines and its payment. */
  abstract insert(bill: OpdBill, by: string): Promise<void>;
  /** Saves the header and the payments not saved yet, on the voucher they were posted with. */
  abstract update(bill: OpdBill, by: string, voucherNumber: string | null): Promise<void>;
  abstract nextSerial(kind: string, year: number): Promise<number>;
  abstract policy(): Promise<OpdPolicy>;
  abstract savePolicy(policy: OpdPolicy, by: string, now: Date): Promise<void>;
  abstract doctors(ids: readonly string[]): Promise<Map<string, BillableDoctor>>;
  abstract services(ids: readonly string[]): Promise<Map<string, BillableService>>;
  abstract corporateClient(id: string): Promise<CorporateClient | null>;
  /** What the client owes on bills not cancelled. */
  abstract corporateDue(clientId: string): Promise<number>;
  /** The client's bills with something due, oldest first. */
  abstract dueBillIds(clientId: string): Promise<string[]>;
  /** The last day the patient was billed for this doctor (bills not cancelled). */
  abstract lastVisitOn(patientId: string, doctorId: string): Promise<string | null>;
  abstract addLedger(entries: readonly DoctorLedgerEntry[]): Promise<void>;
  abstract addUhidUse(use: {
    patientId: string;
    usedOn: string;
    service: string;
    documentNumber: string;
  }): Promise<void>;
}

export type BedStatus = 'available' | 'occupied' | 'housekeeping' | 'out_of_order';

export interface AdmissionBed {
  readonly id: string;
  readonly code: string;
  readonly status: BedStatus;
  readonly isActive: boolean;
  /** The bed's own rate, else its category's. */
  readonly dailyRate: number;
  readonly admissionFee: number;
}

export abstract class AdmissionRepository {
  abstract findForUpdate(id: string): Promise<Admission | null>;
  abstract findById(id: string): Promise<Admission | null>;
  abstract insert(admission: Admission): Promise<void>;
  /** Saves the header and replaces the bed stays and doctors. */
  abstract update(admission: Admission): Promise<void>;
  /** The patient's admission that is still open, if any. */
  abstract activeOf(patientId: string): Promise<string | null>;
  /** The bed, locked for the change. */
  abstract bedForUpdate(id: string): Promise<AdmissionBed | null>;
  abstract setBedStatus(id: string, status: BedStatus): Promise<void>;
}

export interface IpdPolicy {
  readonly roundFeePerNight: number;
  readonly serviceChargePercent: number;
  readonly counterDiscountPercent: number;
}

export type IpdPaymentKind = 'advance' | 'refund' | 'payment' | 'collection';

export interface IpdPayment {
  readonly admissionId: string;
  readonly billId: string | null;
  readonly kind: IpdPaymentKind;
  readonly number: string;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly amount: number;
  readonly paidOn: string;
  readonly receivedBy: string;
  readonly voucherNumber: string | null;
}

export interface ChargeEntry extends IpdCharge {
  readonly admissionId: string;
  readonly note: string | null;
  readonly chargedBy: string;
}

export abstract class IpdBillingRepository {
  abstract policy(): Promise<IpdPolicy>;
  abstract savePolicy(policy: IpdPolicy, by: string, now: Date): Promise<void>;
  abstract insertCharge(charge: ChargeEntry): Promise<void>;
  abstract charge(id: string): Promise<{ admissionId: string; status: 'active' | 'cancelled' } | null>;
  abstract cancelCharge(id: string, reason: string, by: string, at: Date): Promise<void>;
  /** The admission's charges not cancelled, in the order given. */
  abstract activeCharges(admissionId: string): Promise<IpdCharge[]>;
  /** The admission's bed stays in the organisation's days, with whether each bed is intensive care. */
  abstract stays(admissionId: string): Promise<StayDays[]>;
  /** Money put in on the admission (advances, payments, collections) less what was refunded. */
  abstract received(admissionId: string): Promise<number>;
  abstract addPayment(payment: IpdPayment): Promise<void>;
  /** The admission's bill in force, locked. */
  abstract liveBill(admissionId: string): Promise<IpdBill | null>;
  abstract billForUpdate(id: string): Promise<IpdBill | null>;
  abstract insertBill(bill: IpdBill): Promise<void>;
  abstract updateBill(bill: IpdBill): Promise<void>;
}
