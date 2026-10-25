import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
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
  type FestivalBonusSheet,
  type LedgerStatement,
  type SalaryListFilter,
  type SavedSalarySheet,
  type StaffSalaryView,
} from '../../application/read-models.js';
import {
  SalaryIncrementRepository,
  SalaryPolicyRepository,
  StaffSalaryRepository,
  type IncomeTaxDeduction,
  type LeaveEncashmentLine,
  type SalarySheetLine,
} from '../../domain/repositories.js';
import type { PfMovements } from '../../domain/pf.js';
import {
  incrementArrear,
  isIncrementDue,
  StaffSalary,
  type SalaryIncrementProps,
  type SalaryPolicyTerms,
} from '../../domain/salary.js';
import {
  festivalBonuses,
  festivalBonusLines,
  incomeTaxDeductions,
  leaveEncashments,
  pfLedgerEntries,
  salaryIncrements,
  salaryPolicies,
  salaryReviewCycles,
  salarySheetLines,
  salarySheets,
  staffDues,
  staffSalaries,
} from './payroll.schema.js';

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

  async savedSheet(year: number, month: number): Promise<SavedSalarySheet | null> {
    const [sheet] = await this.context.db
      .select()
      .from(salarySheets)
      .where(and(eq(salarySheets.year, year), eq(salarySheets.month, month)));
    if (!sheet) return null;
    const lines = await this.context.db
      .select()
      .from(salarySheetLines)
      .where(eq(salarySheetLines.sheetId, sheet.id))
      .orderBy(asc(salarySheetLines.department), asc(salarySheetLines.employeeNo));
    return {
      status: sheet.status,
      approvedAt: sheet.approvedAt,
      committedAt: sheet.committedAt,
      lines: lines.map(({ sheetId: _sheet, ...line }) => line),
    };
  }

  async sheetLine(year: number, month: number, staffId: string): Promise<SalarySheetLine | null> {
    const [row] = await this.context.db
      .select({ line: salarySheetLines })
      .from(salarySheetLines)
      .innerJoin(salarySheets, eq(salarySheets.id, salarySheetLines.sheetId))
      .where(and(eq(salarySheets.year, year), eq(salarySheets.month, month), eq(salarySheetLines.staffId, staffId)));
    if (!row) return null;
    const { sheetId: _sheet, ...line } = row.line;
    return line;
  }

  async festivalBonusSheet(bonusId: string): Promise<FestivalBonusSheet | null> {
    const [schedule] = await this.context.db
      .select({
        id: festivalBonuses.id,
        festivalId: festivalBonuses.festivalId,
        payYear: festivalBonuses.payYear,
        payMonth: festivalBonuses.payMonth,
        percentOfBasic: festivalBonuses.percentOfBasic,
        joinedBy: festivalBonuses.joinedBy,
        payWithSalary: festivalBonuses.payWithSalary,
      })
      .from(festivalBonuses)
      .where(eq(festivalBonuses.id, bonusId));
    if (!schedule) return null;
    const [rows, festivalName] = await Promise.all([
      this.context.db
        .select()
        .from(festivalBonusLines)
        .where(eq(festivalBonusLines.bonusId, bonusId))
        .orderBy(asc(festivalBonusLines.department), asc(festivalBonusLines.employeeNo)),
      this.staff.festivalName(schedule.festivalId),
    ]);
    return {
      schedule: { ...schedule, festivalName: festivalName ?? '' },
      status: rows[0]?.status ?? null,
      lines: rows.map(({ bonusId: _bonus, status: _status, approvedBy: _by, approvedAt: _at, ...line }) => line),
    };
  }

  async leaveEncashments(payYear: number, payMonth: number): Promise<LeaveEncashmentLine[]> {
    const rows = await this.context.db
      .select()
      .from(leaveEncashments)
      .where(and(eq(leaveEncashments.payYear, payYear), eq(leaveEncashments.payMonth, payMonth)))
      .orderBy(asc(leaveEncashments.department), asc(leaveEncashments.employeeNo));
    return rows.map(
      ({ payYear: _year, payMonth: _month, leaveYear: _leave, approvedBy: _by, approvedAt: _at, ...line }) => line,
    );
  }

  async pfStatement(staffId: string, from: string, to: string): Promise<LedgerStatement> {
    const [deductions, entries] = await Promise.all([
      this.context.db
        .select({ year: salarySheets.year, month: salarySheets.month, pf: salarySheetLines.pf })
        .from(salarySheetLines)
        .innerJoin(salarySheets, eq(salarySheets.id, salarySheetLines.sheetId))
        .where(and(eq(salarySheetLines.staffId, staffId), eq(salarySheets.status, 'committed'))),
      this.context.db.select().from(pfLedgerEntries).where(eq(pfLedgerEntries.staffId, staffId)),
    ]);
    const movements = [
      ...entries.map((entry) => ({
        date: entry.entryDate,
        description: [PF_ENTRY_LABELS[entry.type], entry.remarks].filter(Boolean).join(' — '),
        credit: entry.credit,
        debit: entry.debit,
      })),
      ...deductions
        .filter((row) => row.pf > 0)
        .map((row) => ({
          date: monthEnd(row.year, row.month),
          description: `PF deduction, ${MONTH_NAMES[row.month - 1]} ${row.year}`,
          credit: row.pf,
          debit: 0,
        })),
    ];
    return statement(movements, from, to, (credit, debit) => credit - debit);
  }

  async pfMovements(staffId?: string): Promise<PfMovements[]> {
    const [deductions, entries] = await Promise.all([
      this.context.db
        .select({
          staffId: salarySheetLines.staffId,
          year: salarySheets.year,
          month: salarySheets.month,
          pf: salarySheetLines.pf,
        })
        .from(salarySheetLines)
        .innerJoin(salarySheets, eq(salarySheets.id, salarySheetLines.sheetId))
        .where(
          and(
            eq(salarySheets.status, 'committed'),
            gt(salarySheetLines.pf, 0),
            staffId ? eq(salarySheetLines.staffId, staffId) : undefined,
          ),
        ),
      this.context.db
        .select({
          staffId: pfLedgerEntries.staffId,
          date: pfLedgerEntries.entryDate,
          type: pfLedgerEntries.type,
          credit: pfLedgerEntries.credit,
          debit: pfLedgerEntries.debit,
        })
        .from(pfLedgerEntries)
        .where(staffId ? eq(pfLedgerEntries.staffId, staffId) : undefined),
    ]);
    const people = new Map<
      string,
      { staffId: string; deductions: PfMovements['deductions'][number][]; entries: PfMovements['entries'][number][] }
    >();
    const person = (id: string) => {
      const found = people.get(id) ?? { staffId: id, deductions: [], entries: [] };
      people.set(id, found);
      return found;
    };
    for (const row of deductions) {
      person(row.staffId).deductions.push({ date: monthEnd(row.year, row.month), amount: row.pf });
    }
    for (const { staffId: id, ...entry } of entries) person(id).entries.push(entry);
    return [...people.values()];
  }

  async duesStatement(staffId: string, from: string, to: string, serviceUnitId?: string): Promise<LedgerStatement> {
    const rows = await this.context.db
      .select()
      .from(staffDues)
      .where(
        and(eq(staffDues.staffId, staffId), serviceUnitId ? eq(staffDues.serviceUnitId, serviceUnitId) : undefined),
      );
    return statement(
      rows.map((row) => ({
        date: row.entryDate,
        description: [row.particulars, row.reference].filter(Boolean).join(' — '),
        credit: row.credit,
        debit: row.debit,
      })),
      from,
      to,
      (credit, debit) => debit - credit,
    );
  }

  async incomeTaxDeductions(payYear: number, payMonth: number): Promise<IncomeTaxDeduction[]> {
    const rows = await this.context.db
      .select()
      .from(incomeTaxDeductions)
      .where(and(eq(incomeTaxDeductions.payYear, payYear), eq(incomeTaxDeductions.payMonth, payMonth)));
    return rows.map(({ updatedBy: _by, updatedAt: _at, ...row }) => row);
  }
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const PF_ENTRY_LABELS = {
  opening: 'Opening balance',
  contribution: 'Contribution',
  interest: 'Interest',
  withdrawal: 'Withdrawal',
  settlement: 'Settlement',
  adjustment: 'Adjustment',
} as const;

const monthEnd = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
const cents = (amount: number) => Math.round(amount * 100) / 100;

/** Opening balance before `from`, then each movement up to `to` with the running balance. */
function statement(
  movements: { date: string; description: string; credit: number; debit: number }[],
  from: string,
  to: string,
  effect: (credit: number, debit: number) => number,
): LedgerStatement {
  const sorted = [...movements].sort((a, b) => a.date.localeCompare(b.date));
  let balance = cents(
    sorted.filter((movement) => movement.date < from).reduce((sum, m) => sum + effect(m.credit, m.debit), 0),
  );
  const opening = balance;
  const rows = sorted
    .filter((movement) => movement.date >= from && movement.date <= to)
    .map((movement) => {
      balance = cents(balance + effect(movement.credit, movement.debit));
      return { ...movement, balance };
    });
  return { opening, rows, closing: balance };
}
