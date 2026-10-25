import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { StaffDirectory, type StaffSummary } from '../../../../shared/application/contracts/staff-directory.js';
import { toPage, offsetOf, type Page } from '../../../../shared/application/pagination.js';
import { ConflictError, NotFoundError } from '../../../../shared/domain/errors.js';
import {
  foreignKeyViolationConstraint,
  uniqueViolationConstraint,
} from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  PayrollReadRepository,
  type IncrementCandidate,
  type IncrementFilter,
  type SalaryIncrementView,
  type SalaryListFilter,
  type StaffSalaryView,
} from '../../application/read-models.js';
import { SalaryIncrementRepository, SalaryPolicyRepository, StaffSalaryRepository } from '../../domain/repositories.js';
import {
  incrementArrear,
  isIncrementDue,
  StaffSalary,
  type SalaryIncrementProps,
  type SalaryPolicyTerms,
} from '../../domain/salary.js';
import { salaryIncrements, salaryPolicies, salaryReviewCycles, staffSalaries } from './payroll.schema.js';

const REFERENCES: Record<string, string> = {
  staff_salaries_staff_id_staff_records_id_fk: 'staff',
  staff_salaries_policy_id_salary_policies_id_fk: 'salary_policy',
  staff_salaries_review_cycle_id_salary_review_cycles_id_fk: 'salary_review_cycle',
};

function rethrow(error: unknown): never {
  const unique = uniqueViolationConstraint(error);
  if (unique === 'staff_salaries_pkey') {
    throw new ConflictError('salary_exists', 'This person already has a salary; revise it instead');
  }
  if (unique === 'salary_increments_staff_period_uq') {
    throw new ConflictError('increment_exists', 'This person already has an increment in that month');
  }
  const reference = foreignKeyViolationConstraint(error);
  if (reference !== null) throw new NotFoundError(REFERENCES[reference] ?? 'referenced_record');
  throw error;
}

function rowOf(salary: StaffSalary) {
  const { createdAt: _created, ...props } = salary.toSnapshot();
  return props;
}

@Injectable()
export class DrizzleStaffSalaryRepository extends StaffSalaryRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(staffId: string): Promise<StaffSalary | null> {
    const [row] = await this.context.db
      .select()
      .from(staffSalaries)
      .where(eq(staffSalaries.staffId, staffId))
      .for('update');
    return row ? StaffSalary.restore(row) : null;
  }

  async insert(salary: StaffSalary): Promise<void> {
    await this.context.db.insert(staffSalaries).values(salary.toSnapshot()).catch(rethrow);
  }

  async update(salary: StaffSalary): Promise<void> {
    await this.context.db
      .update(staffSalaries)
      .set(rowOf(salary))
      .where(eq(staffSalaries.staffId, salary.staffId))
      .catch(rethrow);
  }
}

@Injectable()
export class DrizzleSalaryPolicyRepository extends SalaryPolicyRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async terms(policyId: string): Promise<SalaryPolicyTerms | null> {
    const [row] = await this.context.db
      .select({
        basicPercentOfGross: salaryPolicies.basicPercentOfGross,
        houseRentPercentOfBasic: salaryPolicies.houseRentPercentOfBasic,
        medicalPercentOfBasic: salaryPolicies.medicalPercentOfBasic,
        pfPercentOfBasic: salaryPolicies.pfPercentOfBasic,
        cpfPercentOfBasic: salaryPolicies.cpfPercentOfBasic,
        conveyanceCap: salaryPolicies.conveyanceCap,
      })
      .from(salaryPolicies)
      .where(eq(salaryPolicies.id, policyId));
    return row ?? null;
  }
}

@Injectable()
export class DrizzleSalaryIncrementRepository extends SalaryIncrementRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insert(increment: SalaryIncrementProps): Promise<void> {
    await this.context.db.insert(salaryIncrements).values(increment).catch(rethrow);
  }

  async pending(year: number, month: number): Promise<SalaryIncrementProps[]> {
    const rows = await this.context.db
      .select()
      .from(salaryIncrements)
      .where(
        and(eq(salaryIncrements.year, year), eq(salaryIncrements.month, month), eq(salaryIncrements.status, 'pending')),
      );
    return rows.map((row) => ({ ...row, createdBy: row.createdBy ?? '' }));
  }

  async commit(year: number, month: number, committedBy: string, now: Date): Promise<number> {
    const rows = await this.context.db
      .update(salaryIncrements)
      .set({ status: 'committed', committedBy, committedAt: now })
      .where(
        and(eq(salaryIncrements.year, year), eq(salaryIncrements.month, month), eq(salaryIncrements.status, 'pending')),
      )
      .returning({ id: salaryIncrements.id });
    return rows.length;
  }

  async remove(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.context.db.delete(salaryIncrements).where(inArray(salaryIncrements.id, [...ids]));
  }
}

const staffFields = (person: StaffSummary) => ({
  employeeNo: person.employeeNo,
  fullName: person.fullName,
  department: person.department,
  designation: person.designation,
});

/**
 * Staff details come from the HR module's StaffDirectory, never from HR tables, so lists are joined in
 * memory. Salaries number in the thousands at most, which keeps this cheap.
 */
@Injectable()
export class DrizzlePayrollReadRepository extends PayrollReadRepository {
  constructor(
    private readonly context: DbContext,
    private readonly staff: StaffDirectory,
  ) {
    super();
  }

  private salaryRows(staffIds?: readonly string[]) {
    return this.context.db
      .select({ salary: staffSalaries, policyName: salaryPolicies.name, reviewCycleName: salaryReviewCycles.name })
      .from(staffSalaries)
      .innerJoin(salaryPolicies, eq(salaryPolicies.id, staffSalaries.policyId))
      .leftJoin(salaryReviewCycles, eq(salaryReviewCycles.id, staffSalaries.reviewCycleId))
      .where(staffIds ? inArray(staffSalaries.staffId, [...staffIds]) : undefined);
  }

  private static view(
    row: Awaited<ReturnType<DrizzlePayrollReadRepository['salaryRows']>>[number],
    person: StaffSummary,
  ): StaffSalaryView {
    const { createdAt: _created, ...salary } = row.salary;
    return {
      ...salary,
      ...staffFields(person),
      joiningDate: person.joiningDate,
      policyName: row.policyName,
      reviewCycleName: row.reviewCycleName,
    };
  }

  async listSalaries(filter: SalaryListFilter): Promise<Page<StaffSalaryView>> {
    const people = await this.staff.search({ departmentId: filter.departmentId, q: filter.q });
    if (people.length === 0) return toPage([], 0, filter);
    const rows = await this.salaryRows(people.map((person) => person.id));
    const bySalary = new Map(
      rows
        .filter((row) => !filter.policyId || row.salary.policyId === filter.policyId)
        .map((row) => [row.salary.staffId, row]),
    );
    // The directory returns people ordered by employee number.
    const matched = people.filter((person) => bySalary.has(person.id));
    const offset = offsetOf(filter);
    const items = matched
      .slice(offset, offset + filter.pageSize)
      .map((person) => DrizzlePayrollReadRepository.view(bySalary.get(person.id)!, person));
    return toPage(items, matched.length, filter);
  }

  async getSalary(staffId: string): Promise<StaffSalaryView | null> {
    const [[row], [person]] = await Promise.all([this.salaryRows([staffId]), this.staff.findSummaries([staffId])]);
    return row && person ? DrizzlePayrollReadRepository.view(row, person) : null;
  }

  async listIncrements(filter: IncrementFilter): Promise<SalaryIncrementView[]> {
    const departmentStaff = filter.departmentId
      ? (await this.staff.search({ departmentId: filter.departmentId })).map((person) => person.id)
      : null;
    if (departmentStaff?.length === 0) return [];
    const rows = await this.context.db
      .select()
      .from(salaryIncrements)
      .where(
        and(
          filter.year ? eq(salaryIncrements.year, filter.year) : undefined,
          filter.month ? eq(salaryIncrements.month, filter.month) : undefined,
          filter.staffId ? eq(salaryIncrements.staffId, filter.staffId) : undefined,
          departmentStaff ? inArray(salaryIncrements.staffId, departmentStaff) : undefined,
          filter.status ? eq(salaryIncrements.status, filter.status) : undefined,
        ),
      )
      .limit(5000);
    const people = new Map(
      (await this.staff.findSummaries([...new Set(rows.map((row) => row.staffId))])).map((person) => [
        person.id,
        person,
      ]),
    );
    return rows
      .flatMap((row) => {
        const person = people.get(row.staffId);
        return person
          ? [
              {
                id: row.id,
                staffId: row.staffId,
                ...staffFields(person),
                year: row.year,
                month: row.month,
                method: row.method,
                amount: row.amount,
                arrear: row.arrear,
                before: row.before,
                status: row.status,
                createdAt: row.createdAt,
                committedAt: row.committedAt,
              },
            ]
          : [];
      })
      .sort((a, b) => a.year - b.year || a.month - b.month || a.employeeNo.localeCompare(b.employeeNo));
  }

  async incrementCandidates(year: number, month: number): Promise<IncrementCandidate[]> {
    const due = (await this.staff.search({ activeOnly: true })).filter((person) =>
      isIncrementDue(person.joiningDate, year, month),
    );
    if (due.length === 0) return [];
    const ids = due.map((person) => person.id);
    const [rows, applied] = await Promise.all([
      this.salaryRows(ids),
      this.context.db
        .select({ staffId: salaryIncrements.staffId })
        .from(salaryIncrements)
        .where(
          and(
            eq(salaryIncrements.year, year),
            eq(salaryIncrements.month, month),
            inArray(salaryIncrements.staffId, ids),
          ),
        ),
    ]);
    const salaries = new Map(rows.map((row) => [row.salary.staffId, row.salary]));
    const done = new Set(applied.map((row) => row.staffId));
    return due
      .filter((person) => salaries.has(person.id))
      .sort((a, b) => a.joiningDate.localeCompare(b.joiningDate) || a.employeeNo.localeCompare(b.employeeNo))
      .map((person) => {
        const salary = salaries.get(person.id)!;
        const amountDue = StaffSalary.restore(salary).incrementDue();
        return {
          staffId: person.id,
          ...staffFields(person),
          joiningDate: person.joiningDate,
          gross: salary.gross,
          method: salary.incrementMethod,
          amountDue,
          arrear: amountDue === null ? null : incrementArrear(amountDue, person.joiningDate, year, month),
          applied: done.has(person.id),
        };
      });
  }
}
