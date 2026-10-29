export interface PatientSummary {
  readonly id: string;
  readonly uhid: number;
  readonly name: string;
  readonly sex: string;
  readonly dateOfBirth: string;
  /** A+, O- …, or null when not known. */
  readonly bloodGroup: string | null;
  readonly isActive: boolean;
}

/** The hospital's registered patients for other modules (the blood bank), which never read the patient tables. */
export abstract class PatientDirectory {
  abstract find(ids: readonly string[]): Promise<Map<string, PatientSummary>>;
}
