export interface ClinicDoctor {
  readonly id: string;
  readonly name: string;
  readonly degrees: string | null;
  readonly specialityName: string | null;
  readonly isActive: boolean;
  /** The user account the doctor signs in with, if any. */
  readonly userId: string | null;
}

export interface ClinicAppointment {
  readonly id: string;
  readonly doctorId: string;
  /** Null until the patient booked by name is registered. */
  readonly patientId: string | null;
  readonly appointmentDate: string;
  readonly serial: number;
  readonly visitType: 'first' | 'new' | 'follow_up' | 'report';
  readonly status: 'booked' | 'arrived' | 'no_show' | 'cancelled';
  readonly referredByName: string | null;
}

/**
 * The hospital's doctors and their chamber appointments for the clinical module (prescriptions), which never reads the
 * hospital tables directly.
 */
export abstract class OutpatientClinic {
  /** The doctor whose user account this is, or null. */
  abstract doctorOfUser(userId: string): Promise<ClinicDoctor | null>;
  abstract doctors(ids: readonly string[]): Promise<Map<string, ClinicDoctor>>;
  abstract appointment(id: string): Promise<ClinicAppointment | null>;
}
