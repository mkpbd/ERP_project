/** A unit of blood issued to an admitted patient as it stands on the indoor bill. */
export interface BloodCharge {
  readonly issueId: string;
  readonly number: string;
  readonly issuedOn: string;
  /** The component and its unit number. */
  readonly description: string;
  readonly amount: number;
}

/**
 * The blood the blood bank issued to an admitted patient, published for the hospital's indoor bill, so that the
 * hospital never reads the blood bank's tables.
 */
export abstract class InpatientBlood {
  abstract charges(admissionId: string): Promise<BloodCharge[]>;
}
