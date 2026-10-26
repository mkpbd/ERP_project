import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { text } from './patient.js';

/** Old OPD.PatientVisitTypes: OPDMaiden, OPDNew, OPDOld (follow-up), OPDReport (showing reports). */
export const VISIT_TYPES = ['first', 'new', 'follow_up', 'report'] as const;
export type VisitType = (typeof VISIT_TYPES)[number];
export const APPOINTMENT_STATUSES = ['booked', 'arrived', 'no_show', 'cancelled'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface DoctorFees {
  readonly firstVisitFee: number;
  readonly newVisitFee: number;
  readonly followUpFee: number;
  readonly reportFee: number;
}

/** The doctor's fee for a kind of visit. */
export function feeFor(fees: DoctorFees, visitType: VisitType): number {
  switch (visitType) {
    case 'first':
      return fees.firstVisitFee;
    case 'new':
      return fees.newVisitFee;
    case 'follow_up':
      return fees.followUpFee;
    case 'report':
      return fees.reportFee;
  }
}

export interface Sitting {
  readonly startTime: string;
  readonly slotMinutes: number;
  readonly maxPatients: number;
}

/** Old slot list: serial n comes at the start time plus (n − 1) slots. */
export function slotTime(sitting: Sitting, serial: number): string {
  const [hours, minutes] = sitting.startTime.split(':').map(Number) as [number, number];
  const at = hours * 60 + minutes + (serial - 1) * sitting.slotMinutes;
  // A sitting running past midnight keeps counting on the same day's clock.
  const wrapped = at % (24 * 60);
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** 0 = Sunday … 6 = Saturday, as the old DayOfWeek. */
export const weekdayOf = (isoDay: string) => new Date(`${isoDay}T00:00:00Z`).getUTCDay();

/**
 * The serial to book: the one asked for when it is free and within the sitting, else the first free one. The old
 * page checked a serial in the handler and again with unique indexes; here it is chosen under a lock on the doctor's
 * day and the unique index stays as the last guard.
 */
export function chooseSerial(sitting: Sitting, taken: ReadonlySet<number>, wanted: number | null): number {
  if (wanted !== null) {
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > sitting.maxPatients) {
      throw new DomainError('invalid_serial', `Serials run from 1 to ${sitting.maxPatients}`);
    }
    if (taken.has(wanted)) throw new ConflictError('serial_taken', `Serial ${wanted} is booked already`);
    return wanted;
  }
  for (let serial = 1; serial <= sitting.maxPatients; serial += 1) if (!taken.has(serial)) return serial;
  throw new DomainError('fully_booked', `All ${sitting.maxPatients} serials are booked`);
}

export interface AppointmentProps {
  id: string;
  doctorId: string;
  appointmentDate: string;
  serial: number;
  slotTime: string;
  visitType: VisitType;
  patientId: string | null;
  patientName: string;
  mobileNo: string;
  referredById: string | null;
  fee: number;
  status: AppointmentStatus;
  statusReason: string | null;
  remarks: string | null;
  bookedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Old OPD.DoctorAppointments: a serial with a doctor on a day, for a patient (registered or not yet). */
export class Appointment {
  private constructor(private readonly props: AppointmentProps) {}

  static book(
    params: Omit<
      AppointmentProps,
      'status' | 'statusReason' | 'version' | 'createdAt' | 'updatedAt' | 'patientName' | 'remarks'
    > & { patientName: string; remarks: string | null; today: string; now: Date },
  ): Appointment {
    if (params.appointmentDate < params.today) {
      throw new DomainError('invalid_date', 'An appointment is not booked for a day gone by');
    }
    const patientName = text(params.patientName, 150, 'name');
    if (!patientName) throw new DomainError('invalid_name', "Give the patient's name");
    const { today: _today, now, ...rest } = params;
    return new Appointment({
      ...rest,
      patientName,
      remarks: text(params.remarks, 300, 'remarks'),
      status: 'booked',
      statusReason: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: AppointmentProps): Appointment {
    return new Appointment({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get doctorId(): string {
    return this.props.doctorId;
  }
  get appointmentDate(): string {
    return this.props.appointmentDate;
  }
  get serial(): number {
    return this.props.serial;
  }
  get status(): AppointmentStatus {
    return this.props.status;
  }
  get patientId(): string | null {
    return this.props.patientId;
  }

  /** The patient came (to be billed and seen); a booking without a registered patient is registered first. */
  arrive(today: string, now: Date): void {
    this.assertBooked('marked arrived');
    if (this.props.patientId === null) {
      throw new DomainError('patient_not_registered', 'Register the patient and attach them first');
    }
    if (this.props.appointmentDate !== today) {
      throw new DomainError('invalid_date', 'A patient arrives on the day of the appointment');
    }
    this.props.status = 'arrived';
    this.touch(now);
  }

  /** The day went by without the patient. */
  noShow(today: string, now: Date): void {
    this.assertBooked('marked a no-show');
    if (this.props.appointmentDate > today) {
      throw new DomainError('invalid_date', 'A patient misses an appointment only on or after its day');
    }
    this.props.status = 'no_show';
    this.touch(now);
  }

  cancel(reason: string, now: Date): void {
    this.assertBooked('cancelled');
    const why = text(reason, 300, 'reason');
    if (!why) throw new DomainError('invalid_remarks', 'Give a reason');
    this.props.status = 'cancelled';
    this.props.statusReason = why;
    this.touch(now);
  }

  /** The patient registered after booking (old: registering from the appointment linked the UHID back). */
  attach(patient: { id: string; fullName: string; mobileNo: string }, now: Date): void {
    this.assertBooked('changed');
    this.props.patientId = patient.id;
    this.props.patientName = patient.fullName;
    this.props.mobileNo = patient.mobileNo;
    this.touch(now);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_appointment', 'The appointment was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<AppointmentProps> {
    return { ...this.props };
  }

  private assertBooked(action: string): void {
    if (this.props.status !== 'booked') {
      throw new DomainError(
        'appointment_state',
        `A ${this.props.status.replace('_', '-')} appointment cannot be ${action}`,
      );
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}
