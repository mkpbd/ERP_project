import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { IncrementMethod, IncrementStatus, SalaryBreakdown, SalarySnapshot } from '../domain/salary.js';

export interface StaffSalaryView extends SalaryBreakdown {
  readonly staffId: string;
  readonly employeeNo: string;
  readonly fullName: string;
  readonly department: string;
  readonly designation: string;
  readonly joiningDate: string;
  readonly policyId: string;
  readonly policyName: string;
  readonly pfEnabled: boolean;
  readonly specialAllowance: number;
  readonly otherFixed: number;
  readonly overtimeRatePerHour: number;
  readonly taxableAmount: number;
  readonly incrementMethod: IncrementMethod;
  readonly incrementPercent: number;
  readonly fixedIncrement: number;
  readonly reviewCycleId: string | null;
  readonly reviewCycleName: string | null;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface SalaryListFilter extends PageRequest {
  readonly departmentId?: string | undefined;
  readonly policyId?: string | undefined;
  /** Employee number or name. */
  readonly q?: string | undefined;
}

export interface SalaryIncrementView {
  readonly id: string;
  readonly staffId: string;
  readonly employeeNo: string;
  readonly fullName: string;
  readonly department: string;
  readonly designation: string;
  readonly year: number;
  readonly month: number;
  readonly method: IncrementMethod;
  readonly amount: number;
  readonly arrear: number;
  readonly before: SalarySnapshot;
  readonly status: IncrementStatus;
  readonly createdAt: Date;
  readonly committedAt: Date | null;
}

export interface IncrementFilter {
  readonly year?: number | undefined;
  readonly month?: number | undefined;
  readonly staffId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly status?: IncrementStatus | undefined;
}

/** A person whose increment is due in a pay month, with what their method gives. */
export interface IncrementCandidate {
  readonly staffId: string;
  readonly employeeNo: string;
  readonly fullName: string;
  readonly department: string;
  readonly designation: string;
  readonly joiningDate: string;
  readonly gross: number;
  readonly method: IncrementMethod;
  /** null for the individual method: enter it when applying. */
  readonly amountDue: number | null;
  readonly arrear: number | null;
  /** Already incremented in this month. */
  readonly applied: boolean;
}

export abstract class PayrollReadRepository {
  abstract listSalaries(filter: SalaryListFilter): Promise<Page<StaffSalaryView>>;
  abstract getSalary(staffId: string): Promise<StaffSalaryView | null>;
  abstract listIncrements(filter: IncrementFilter): Promise<SalaryIncrementView[]>;
  /** Active staff with a salary whose joining anniversary fell in the month before the pay month. */
  abstract incrementCandidates(year: number, month: number): Promise<IncrementCandidate[]>;
}
