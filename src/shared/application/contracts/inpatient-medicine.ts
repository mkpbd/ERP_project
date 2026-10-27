/** One ward issue as it stands on an admission's bill: what was issued less what came back. */
export interface MedicineCharge {
  readonly issueId: string;
  readonly number: string;
  readonly issuedOn: string;
  readonly outletName: string;
  /** Net of the indoor discount and of returns; never below 0. */
  readonly amount: number;
}

/**
 * The medicine the pharmacy issued to an admitted patient's ward, published for the hospital's indoor bill, so that
 * the hospital never reads the pharmacy tables directly.
 */
export abstract class InpatientMedicine {
  /** The admission's ward issues with something still charged, oldest first. */
  abstract charges(admissionId: string): Promise<MedicineCharge[]>;
  /** Ward indents of the admission not issued or cancelled yet. */
  abstract openIndents(admissionId: string): Promise<number>;
}
