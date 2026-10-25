export interface StaffSummary {
  readonly id: string;
  readonly employeeNo: string;
  readonly fullName: string;
  readonly departmentId: string;
  readonly department: string;
  readonly designation: string;
  readonly joiningDate: string;
  readonly status: 'active' | 'inactive' | 'separated';
  readonly sex: 'male' | 'female' | 'other' | null;
  readonly userId: string | null;
  /** Free text in the old data; salary statements treat "bank" (any case) as bank transfer. */
  readonly paymentMode: string | null;
  readonly bankAccountNo: string | null;
}

export interface StaffSearch {
  readonly departmentId?: string | undefined;
  /** Employee number or name, partial, any case. */
  readonly q?: string | undefined;
  readonly activeOnly?: boolean | undefined;
}

/**
 * Read-only view of staff records published by the HR module, so that payroll and
 * other modules never read the HR tables directly. Results are ordered by employee number.
 */
export abstract class StaffDirectory {
  abstract findSummaries(staffIds: readonly string[]): Promise<StaffSummary[]>;
  abstract search(search: StaffSearch): Promise<StaffSummary[]>;
  abstract staffIdForUser(userId: string): Promise<string | null>;
  /** A festival's name, or null when unknown. */
  abstract festivalName(festivalId: string): Promise<string | null>;
  /** Staff who observe a festival (for festival bonuses). */
  abstract festivalObservers(festivalId: string): Promise<string[]>;
  /**
   * Leave days taken in a calendar year (approved applications plus recorded leave, by start date), per person.
   * People with none are left out.
   */
  abstract leaveDaysTaken(year: number, staffIds: readonly string[]): Promise<Map<string, number>>;
}
