export interface ChargeableAdmission {
  readonly id: string;
  readonly number: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly uhid: number;
  /** The day admitted, in the organisation's time zone. */
  readonly admittedOn: string;
  readonly status: 'admitted' | 'discharged' | 'cancelled';
  /** A final bill is in force: nothing more is charged to the stay until it is cancelled. */
  readonly billed: boolean;
}

/** An admitted patient where they lie now. */
export interface WardInpatient extends ChargeableAdmission {
  readonly bedCode: string;
  readonly wardName: string;
  readonly bedCategoryId: string;
  readonly bedCategoryName: string;
}

/**
 * The hospital's admissions as other modules charge to them (the pharmacy's ward medicine), so that they never read
 * the hospital tables directly.
 */
export abstract class InpatientRegister {
  /**
   * The admission, locked for a charge until the transaction ends (the final bill takes the same lock, so a charge
   * and the bill never cross); null when there is none.
   */
  abstract lockForCharge(admissionId: string): Promise<ChargeableAdmission | null>;
  /** The admissions among `ids`, without a lock. */
  abstract find(ids: readonly string[]): Promise<ChargeableAdmission[]>;
  /** Patients admitted now, with their beds, by ward and bed (the kitchen's list). */
  abstract inpatients(): Promise<WardInpatient[]>;
  /** The bed categories (which meals each gets is the kitchen's). */
  abstract bedCategories(): Promise<{ id: string; name: string }[]>;
}
