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
}
