import type { SalaryLineAmounts, SalarySheetStatus } from './salary-sheet.js';
import type { SalaryBreakdown, SalaryIncrementProps, SalaryPolicyTerms, StaffSalary } from './salary.js';

export abstract class StaffSalaryRepository {
  /** Locks the row until the surrounding transaction ends. */
  abstract findForUpdate(staffId: string): Promise<StaffSalary | null>;
  /** Throws ConflictError when the person already has a salary; NotFoundError for a missing staff, policy or cycle. */
  abstract insert(salary: StaffSalary): Promise<void>;
  abstract update(salary: StaffSalary): Promise<void>;
}

export abstract class SalaryPolicyRepository {
  abstract terms(policyId: string): Promise<SalaryPolicyTerms | null>;
}

export abstract class SalaryIncrementRepository {
  /** Throws ConflictError when the person already has an increment in that month. */
  abstract insert(increment: SalaryIncrementProps): Promise<void>;
  abstract pending(year: number, month: number): Promise<SalaryIncrementProps[]>;
  /** Marks the month's pending increments committed; returns how many. */
  abstract commit(year: number, month: number, committedBy: string, now: Date): Promise<number>;
  abstract remove(ids: readonly string[]): Promise<void>;
}

/** One person's inputs for a pay month (only people with a salary structure). */
export interface SalaryLineFacts {
  readonly staffId: string;
  readonly salary: SalaryBreakdown;
  readonly overtimeHours: number;
  readonly overtimeAmount: number;
  readonly lwpDays: number;
  readonly otherDeduction: number;
  readonly punishment: number;
  readonly arrear: number;
  readonly allowance: number;
  readonly specialAllowance: number;
  readonly advance: number;
  readonly paid: number;
}

/** A person's line on an approved sheet, with their details as they were. */
export interface SalarySheetLine extends SalaryLineAmounts {
  readonly staffId: string;
  readonly employeeNo: string;
  readonly fullName: string;
  readonly departmentId: string;
  readonly department: string;
  readonly designation: string;
  readonly joiningDate: string;
  readonly paymentMode: string | null;
  readonly bankAccountNo: string | null;
}

export interface SalarySheetHeader {
  readonly id: string;
  readonly year: number;
  readonly month: number;
  readonly status: SalarySheetStatus;
}

export abstract class SalarySheetRepository {
  abstract facts(year: number, month: number): Promise<SalaryLineFacts[]>;
  /** Locks the sheet row until the transaction ends. */
  abstract lock(year: number, month: number): Promise<SalarySheetHeader | null>;
  /** Creates or replaces the month's approved sheet and its lines. */
  abstract saveApproved(
    sheet: { id: string; year: number; month: number; approvedBy: string; approvedAt: Date },
    lines: readonly SalarySheetLine[],
  ): Promise<void>;
  abstract commit(sheetId: string, committedBy: string, now: Date): Promise<void>;
}

/** Whether a pay month's salary sheet is committed; its inputs can no longer change. */
export abstract class PayPeriods {
  abstract isClosed(year: number, month: number): Promise<boolean>;
}
