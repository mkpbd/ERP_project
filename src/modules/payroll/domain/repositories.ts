import type { SalaryIncrementProps, SalaryPolicyTerms, StaffSalary } from './salary.js';

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
