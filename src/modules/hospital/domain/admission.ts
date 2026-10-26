import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { text } from './patient.js';

export const ADMISSION_KINDS = ['emergency', 'elective'] as const;
export type AdmissionKind = (typeof ADMISSION_KINDS)[number];
/** The old system had none: a discharge was the final bill being saved. */
export const DISCHARGE_TYPES = ['normal', 'lama', 'referred', 'absconded', 'death'] as const;
export type DischargeType = (typeof DISCHARGE_TYPES)[number];
export type AdmissionStatus = 'admitted' | 'discharged' | 'cancelled';
export const MAX_ADDITIONAL_DOCTORS = 10;

export interface BedStay {
  readonly bedId: string;
  readonly fromAt: Date;
  readonly toAt: Date | null;
  /** The bed's daily rate when the patient was put in it. */
  readonly dailyRate: number;
  readonly reason: string | null;
  readonly movedBy: string | null;
}

export interface AdmissionDoctor {
  readonly doctorId: string;
  readonly role: 'primary' | 'additional';
  readonly fromAt: Date;
  readonly toAt: Date | null;
}

export interface AdmissionProps {
  id: string;
  number: string;
  patientId: string;
  admittedAt: Date;
  kind: AdmissionKind;
  reason: string | null;
  referredById: string | null;
  corporateClientId: string | null;
  staffId: string | null;
  admissionFee: number;
  status: AdmissionStatus;
  dischargedAt: Date | null;
  dischargeType: DischargeType | null;
  dischargeNote: string | null;
  cancelReason: string | null;
  admittedBy: string | null;
  closedBy: string | null;
  stays: BedStay[];
  doctors: AdmissionDoctor[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old IPDPatientRecords with IPDCabinAllocationRecords and AssignedDoctorRecords: one stay from admission to
 * discharge, the beds it had (each from when to when, at its rate then) and the doctors who looked after the patient.
 * The old record was rewritten whole by every page, so a stale page could undo a discharge; here each change is its
 * own step on the current version.
 */
export class Admission {
  private constructor(private readonly props: AdmissionProps) {}

  static admit(params: {
    id: string;
    number: string;
    patientId: string;
    kind: AdmissionKind;
    reason: string | null;
    referredById: string | null;
    corporateClientId: string | null;
    staffId: string | null;
    admissionFee: number;
    bed: { id: string; dailyRate: number };
    doctorId: string;
    additionalDoctorIds: readonly string[];
    by: string;
    at: Date;
  }): Admission {
    const admission = new Admission({
      id: params.id,
      number: params.number,
      patientId: params.patientId,
      admittedAt: params.at,
      kind: params.kind,
      reason: text(params.reason, 500, 'reason for admission'),
      referredById: params.referredById,
      corporateClientId: params.corporateClientId,
      staffId: params.staffId,
      admissionFee: params.admissionFee,
      status: 'admitted',
      dischargedAt: null,
      dischargeType: null,
      dischargeNote: null,
      cancelReason: null,
      admittedBy: params.by,
      closedBy: null,
      stays: [
        {
          bedId: params.bed.id,
          fromAt: params.at,
          toAt: null,
          dailyRate: params.bed.dailyRate,
          reason: 'Admitted',
          movedBy: params.by,
        },
      ],
      doctors: [{ doctorId: params.doctorId, role: 'primary', fromAt: params.at, toAt: null }],
      version: 1,
      createdAt: params.at,
      updatedAt: params.at,
    });
    admission.putAdditional(params.additionalDoctorIds, params.at);
    return admission;
  }

  static restore(props: AdmissionProps): Admission {
    return new Admission({ ...props, stays: [...props.stays], doctors: [...props.doctors] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get patientId(): string {
    return this.props.patientId;
  }
  get status(): AdmissionStatus {
    return this.props.status;
  }
  get currentBedId(): string | null {
    return this.props.stays.find((stay) => stay.toAt === null)?.bedId ?? null;
  }
  get primaryDoctorId(): string | null {
    return this.props.doctors.find((doctor) => doctor.role === 'primary' && doctor.toAt === null)?.doctorId ?? null;
  }

  /** Old Cabin Transfer (no reason kept): the patient moves to another bed; returns the bed left. */
  transfer(bed: { id: string; dailyRate: number }, reason: string, by: string, at: Date): string {
    this.assertAdmitted('moved');
    const why = text(reason, 200, 'reason');
    if (!why) throw new DomainError('invalid_remarks', 'Give the reason for the move');
    const left = this.currentBedId!;
    if (left === bed.id) throw new DomainError('same_bed', 'The patient is in this bed already');
    this.closeStay(at);
    this.props.stays.push({
      bedId: bed.id,
      fromAt: at,
      toAt: null,
      dailyRate: bed.dailyRate,
      reason: why,
      movedBy: by,
    });
    this.touch(at);
    return left;
  }

  /** Old Assigned Doctor Transfer: another consultant takes the patient over. */
  changeConsultant(doctorId: string, at: Date): void {
    this.assertAdmitted('changed');
    if (this.primaryDoctorId === doctorId)
      throw new DomainError('same_doctor', 'This doctor is the consultant already');
    this.props.doctors = this.props.doctors.map((doctor) =>
      doctor.toAt === null && (doctor.role === 'primary' || doctor.doctorId === doctorId)
        ? { ...doctor, toAt: at }
        : doctor,
    );
    this.props.doctors.push({ doctorId, role: 'primary', fromAt: at, toAt: null });
    this.touch(at);
  }

  /** Old AdditionalDoctorIds (a list kept as text, with no history): the doctors who also see the patient. */
  setAdditional(doctorIds: readonly string[], at: Date): void {
    this.assertAdmitted('changed');
    this.putAdditional(doctorIds, at);
    this.touch(at);
  }

  /** Leaves the hospital; returns the bed left. A discharge other than normal needs a note. */
  discharge(params: { type: DischargeType; note: string | null; by: string; at: Date }): string {
    this.assertAdmitted('discharged');
    const note = text(params.note, 1000, 'note');
    if (params.type !== 'normal' && !note) {
      throw new DomainError('invalid_remarks', 'Say why (left against advice, referred where, absconded, death)');
    }
    const left = this.close(params.at, params.by);
    this.props.status = 'discharged';
    this.props.dischargedAt = params.at;
    this.props.dischargeType = params.type;
    this.props.dischargeNote = note;
    return left;
  }

  /** Old admission cancel (admitted by mistake); returns the bed left. */
  cancel(reason: string, by: string, at: Date): string {
    this.assertAdmitted('cancelled');
    const why = text(reason, 300, 'reason');
    if (!why) throw new DomainError('invalid_remarks', 'Give a reason');
    const left = this.close(at, by);
    this.props.status = 'cancelled';
    this.props.cancelReason = why;
    return left;
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_admission', 'The admission was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<AdmissionProps> {
    return { ...this.props, stays: [...this.props.stays], doctors: [...this.props.doctors] };
  }

  private putAdditional(doctorIds: readonly string[], at: Date): void {
    const wanted = [...new Set(doctorIds)];
    if (wanted.length > MAX_ADDITIONAL_DOCTORS) {
      throw new DomainError('invalid_doctors', `At most ${MAX_ADDITIONAL_DOCTORS} additional doctors`);
    }
    if (wanted.includes(this.primaryDoctorId ?? '')) {
      throw new DomainError('invalid_doctors', 'The consultant is not also an additional doctor');
    }
    const current = new Set(
      this.props.doctors
        .filter((doctor) => doctor.role === 'additional' && doctor.toAt === null)
        .map((doctor) => doctor.doctorId),
    );
    this.props.doctors = this.props.doctors.map((doctor) =>
      doctor.role === 'additional' && doctor.toAt === null && !wanted.includes(doctor.doctorId)
        ? { ...doctor, toAt: at }
        : doctor,
    );
    for (const doctorId of wanted) {
      if (!current.has(doctorId)) this.props.doctors.push({ doctorId, role: 'additional', fromAt: at, toAt: null });
    }
  }

  private closeStay(at: Date): void {
    this.props.stays = this.props.stays.map((stay) => (stay.toAt === null ? { ...stay, toAt: at } : stay));
  }

  private close(at: Date, by: string): string {
    const left = this.currentBedId!;
    this.closeStay(at);
    this.props.doctors = this.props.doctors.map((doctor) => (doctor.toAt === null ? { ...doctor, toAt: at } : doctor));
    this.props.closedBy = by;
    this.touch(at);
    return left;
  }

  private assertAdmitted(action: string): void {
    if (this.props.status !== 'admitted') {
      throw new DomainError('admission_state', `A ${this.props.status} admission cannot be ${action}`);
    }
  }

  private touch(at: Date): void {
    this.props.version += 1;
    this.props.updatedAt = at;
  }
}
