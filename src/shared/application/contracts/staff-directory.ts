export interface StaffSummary {
  readonly id: string;
  readonly employeeNo: string;
  readonly fullName: string;
  readonly departmentId: string;
  readonly department: string;
  readonly designation: string;
  readonly joiningDate: string;
  readonly status: 'active' | 'inactive' | 'separated';
  readonly userId: string | null;
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
}
