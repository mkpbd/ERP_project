import type { StoredFile } from '../../../shared/domain/uploads.js';
import type { Admission } from './admission.js';
import type { Appointment, DoctorFees, Sitting } from './appointment.js';
import type { DiagnosticBill } from './diagnostic-bill.js';
import type { InvestigationBill, IpdBill, IpdCharge, StayDays } from './ipd-bill.js';
import type { OpdBill, PaymentMethod } from './opd-bill.js';
import type { OtCase } from './ot-case.js';
import type { IdType, Patient } from './patient.js';
import type { VisitorPass } from './visitor-pass.js';

export interface PatientMatch {
  readonly id: string;
  readonly uhid: number;
  readonly fullName: string;
  readonly dateOfBirth: string;
  readonly mobileNo: string | null;
  readonly contactMobileNo: string | null;
}

export interface MovedRecords {
  readonly appointments: number;
  readonly opdBills: number;
  readonly admissions: number;
  readonly ipdBills: number;
  readonly visits: number;
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
  /** Whether the patient has an admission still open. */
  abstract openAdmission(patientId: string): Promise<boolean>;
  /** Moves everything recorded against one patient to another; returns how many of each moved. */
  abstract moveRecords(fromId: string, toId: string): Promise<MovedRecords>;
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
  /** The doctor's commission on tests they refer; null: the test's. */
  readonly referralPercent: number | null;
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
  readonly kind: 'share' | 'reversal' | 'payment';
  /** The OPD bill, or the final indoor bill. */
  readonly billId: string | null;
  readonly ipdBillId?: string | null;
  readonly diagnosticBillId?: string | null;
  readonly documentNumber: string;
  readonly amount: number;
}

export interface CorporateDueBill {
  readonly kind: 'opd' | 'ipd' | 'diag';
  readonly id: string;
  readonly due: number;
}

export interface DoctorPayment {
  readonly number: string;
  readonly doctorId: string;
  readonly paidOn: string;
  readonly amount: number;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly note: string | null;
  readonly voucherNumber: string | null;
  readonly paidBy: string;
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
  /** What the client owes on OPD and indoor bills not cancelled. */
  abstract corporateDue(clientId: string): Promise<number>;
  /** The client's OPD and indoor bills with something due, oldest first. */
  abstract dueBills(clientId: string): Promise<CorporateDueBill[]>;
  /** What the doctor is owed of their shares, less what they were paid. */
  abstract doctorBalance(doctorId: string): Promise<number>;
  /** Saves the payment and takes it off the doctor's ledger. */
  abstract addDoctorPayment(payment: DoctorPayment): Promise<void>;
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
  /** Visitor passes in force at once for one admitted patient. */
  readonly visitorPassLimit: number;
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
  /** The operation it is charged for (step 15a). */
  readonly otCaseId?: string | null;
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

export interface DiagnosticPolicy {
  readonly counterDiscountPercent: number;
  readonly defaultReferralPercent: number;
}

/** A test as billed. */
export interface BillableTest {
  readonly id: string;
  readonly name: string;
  readonly rate: number;
  readonly reportHours: number | null;
  readonly discountAllowed: boolean;
  /** Null: the policy's. */
  readonly referralPercent: number | null;
  readonly isActive: boolean;
}

export interface DiagnosticPayment {
  readonly billId: string;
  readonly kind: 'payment' | 'collection' | 'refund';
  readonly number: string | null;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly amount: number;
  readonly paidOn: string;
  readonly receivedBy: string;
  readonly voucherNumber: string | null;
}

export abstract class DiagnosticBillRepository {
  abstract policy(): Promise<DiagnosticPolicy>;
  abstract savePolicy(policy: DiagnosticPolicy, by: string, now: Date): Promise<void>;
  abstract tests(ids: readonly string[]): Promise<Map<string, BillableTest>>;
  /** A package with its tests at their rates inside it, or null. */
  abstract package(
    id: string,
  ): Promise<{ id: string; name: string; isActive: boolean; tests: { testId: string; rate: number }[] } | null>;
  abstract setPackageTests(packageId: string, tests: readonly { testId: string; rate: number }[]): Promise<void>;
  abstract findForUpdate(id: string): Promise<DiagnosticBill | null>;
  abstract insert(bill: DiagnosticBill): Promise<void>;
  /** Saves the header and each line's state. */
  abstract update(bill: DiagnosticBill): Promise<void>;
  abstract addPayment(payment: DiagnosticPayment): Promise<void>;
  /** A bill line's rate and its test's reporting fee rule, or null. */
  abstract reportingFee(
    billId: string,
    line: number,
  ): Promise<{ rate: number; percent: number | null; amount: number | null } | null>;
  /** The admission's diagnostic bills with tests still billed, oldest first. */
  abstract indoorCharges(admissionId: string): Promise<InvestigationBill[]>;
}

export interface OtRoom {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

/** Visitor passes of admitted patients' attendants (step 15c). */
export abstract class VisitorPassRepository {
  /** Passes of the admission still in force. */
  abstract activeCount(admissionId: string): Promise<number>;
  abstract insert(pass: VisitorPass): Promise<void>;
  abstract findForUpdate(id: string): Promise<VisitorPass | null>;
  abstract update(pass: VisitorPass): Promise<void>;
}

/** The operation theatre (step 15a): operations of admitted patients and the rooms they are done in. */
export abstract class OtCaseRepository {
  abstract findById(id: string): Promise<OtCase | null>;
  abstract findForUpdate(id: string): Promise<OtCase | null>;
  abstract insert(otCase: OtCase): Promise<void>;
  abstract update(otCase: OtCase): Promise<void>;
  abstract room(id: string): Promise<OtRoom | null>;
  /** Another operation booked in the room (scheduled or under way) whose time overlaps from–to. */
  abstract clash(roomId: string, from: Date, to: Date, exceptId: string): Promise<{ number: string } | null>;
  /** Whether each named master exists (and the operation is in use). */
  abstract masters(ids: {
    operationId: string;
    otTypeId: string | null;
    anaesthesiaTypeId: string | null;
  }): Promise<{ operation: boolean; otType: boolean; anaesthesiaType: boolean }>;
}
