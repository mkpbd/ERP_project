import { Injectable } from '@nestjs/common';
import { and, eq, sum, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  PayPeriods,
  SalarySheetRepository,
  type SalaryLineFacts,
  type SalarySheetHeader,
  type SalarySheetLine,
} from '../../domain/repositories.js';
import {
  allowancePayments,
  festivalBonuses,
  festivalBonusLines,
  incomeTaxDeductions,
  salaryArrears,
  salaryDeductions,
  salaryIncrements,
  salaryOvertimes,
  salaryPayments,
  salaryPunishments,
  salarySheetLines,
  salarySheets,
  staffSalaries,
} from './payroll.schema.js';

type Totals = Map<string, Record<string, number>>;

@Injectable()
export class DrizzleSalarySheetRepository extends SalarySheetRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  /** Sums the given columns per person for one pay month. */
  private async sumBy(
    table: PgTable & { staffId: PgColumn },
    columns: Record<string, PgColumn>,
    where: SQL | undefined,
  ): Promise<Totals> {
    const rows = await this.context.db
      .select({
        staffId: table.staffId,
        ...Object.fromEntries(Object.entries(columns).map(([key, column]) => [key, sum(column).mapWith(Number)])),
      })
      .from(table)
      .where(where)
      .groupBy(table.staffId);
    return new Map(
      rows.map((row) => {
        const { staffId, ...amounts } = row as { staffId: string } & Record<string, number | null>;
        return [staffId, Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value ?? 0]))];
      }),
    );
  }

  async facts(year: number, month: number): Promise<SalaryLineFacts[]> {
    const pay = (table: { payYear: PgColumn; payMonth: PgColumn }) =>
      and(eq(table.payYear, year), eq(table.payMonth, month));
    const [salaries, overtime, deductions, punishments, arrears, incrementArrears, allowances, payments] =
      await Promise.all([
        this.context.db.select().from(staffSalaries),
        this.sumBy(
          salaryOvertimes,
          { hours: salaryOvertimes.hours, amount: salaryOvertimes.amount },
          pay(salaryOvertimes),
        ),
        this.sumBy(
          salaryDeductions,
          { lwpDays: salaryDeductions.lwpDays, other: salaryDeductions.otherDeduction },
          pay(salaryDeductions),
        ),
        this.sumBy(salaryPunishments, { amount: salaryPunishments.amount }, pay(salaryPunishments)),
        this.sumBy(salaryArrears, { amount: salaryArrears.amount }, pay(salaryArrears)),
        this.sumBy(
          salaryIncrements,
          { amount: salaryIncrements.arrear },
          and(eq(salaryIncrements.year, year), eq(salaryIncrements.month, month)),
        ),
        this.sumBy(
          allowancePayments,
          { other: allowancePayments.otherAllowance, special: allowancePayments.specialAllowance },
          pay(allowancePayments),
        ),
        this.sumBy(
          salaryPayments,
          { advance: salaryPayments.advancePaid, paid: salaryPayments.salaryPaid },
          pay(salaryPayments),
        ),
      ]);
    // Approved festival bonuses paid with this month's salary.
    const bonusRows = await this.context.db
      .select({ staffId: festivalBonusLines.staffId, amount: sum(festivalBonusLines.amount).mapWith(Number) })
      .from(festivalBonusLines)
      .innerJoin(festivalBonuses, eq(festivalBonuses.id, festivalBonusLines.bonusId))
      .where(
        and(
          eq(festivalBonuses.payWithSalary, true),
          eq(festivalBonuses.payYear, year),
          eq(festivalBonuses.payMonth, month),
        ),
      )
      .groupBy(festivalBonusLines.staffId);
    const bonuses = new Map(bonusRows.map((row) => [row.staffId, row.amount ?? 0]));
    const taxRows = await this.context.db
      .select({ staffId: incomeTaxDeductions.staffId, monthlyTax: incomeTaxDeductions.monthlyTax })
      .from(incomeTaxDeductions)
      .where(and(eq(incomeTaxDeductions.payYear, year), eq(incomeTaxDeductions.payMonth, month)));
    const taxes = new Map(taxRows.map((row) => [row.staffId, row.monthlyTax]));
    const of = (totals: Totals, staffId: string, key: string) => totals.get(staffId)?.[key] ?? 0;
    return salaries.map((salary) => ({
      staffId: salary.staffId,
      salary,
      overtimeHours: of(overtime, salary.staffId, 'hours'),
      overtimeAmount: of(overtime, salary.staffId, 'amount'),
      lwpDays: of(deductions, salary.staffId, 'lwpDays'),
      otherDeduction: of(deductions, salary.staffId, 'other'),
      punishment: of(punishments, salary.staffId, 'amount'),
      arrear: of(arrears, salary.staffId, 'amount') + of(incrementArrears, salary.staffId, 'amount'),
      allowance: of(allowances, salary.staffId, 'other'),
      specialAllowance: of(allowances, salary.staffId, 'special'),
      advance: of(payments, salary.staffId, 'advance'),
      paid: of(payments, salary.staffId, 'paid'),
      festivalBonus: bonuses.get(salary.staffId) ?? 0,
      incomeTax: taxes.get(salary.staffId) ?? 0,
    }));
  }

  async lock(year: number, month: number): Promise<SalarySheetHeader | null> {
    const [row] = await this.context.db
      .select({ id: salarySheets.id, year: salarySheets.year, month: salarySheets.month, status: salarySheets.status })
      .from(salarySheets)
      .where(and(eq(salarySheets.year, year), eq(salarySheets.month, month)))
      .for('update');
    return row ?? null;
  }

  async saveApproved(
    sheet: { id: string; year: number; month: number; approvedBy: string; approvedAt: Date },
    lines: readonly SalarySheetLine[],
  ): Promise<void> {
    await this.context.db
      .insert(salarySheets)
      .values({ ...sheet, status: 'approved' })
      .onConflictDoUpdate({
        target: [salarySheets.year, salarySheets.month],
        set: { approvedBy: sheet.approvedBy, approvedAt: sheet.approvedAt, status: 'approved' },
      });
    await this.context.db.delete(salarySheetLines).where(eq(salarySheetLines.sheetId, sheet.id));
    for (let start = 0; start < lines.length; start += 500) {
      await this.context.db
        .insert(salarySheetLines)
        .values(lines.slice(start, start + 500).map((line) => ({ ...line, sheetId: sheet.id })));
    }
  }

  async commit(sheetId: string, committedBy: string, now: Date): Promise<void> {
    await this.context.db
      .update(salarySheets)
      .set({ status: 'committed', committedBy, committedAt: now })
      .where(eq(salarySheets.id, sheetId));
  }
}

@Injectable()
export class DrizzlePayPeriods extends PayPeriods {
  constructor(private readonly context: DbContext) {
    super();
  }

  /** Takes a share lock so a commit waits for writes already checking the month. */
  async isClosed(year: number, month: number): Promise<boolean> {
    const [row] = await this.context.db
      .select({ status: salarySheets.status })
      .from(salarySheets)
      .where(and(eq(salarySheets.year, year), eq(salarySheets.month, month)))
      .for('share');
    return row?.status === 'committed';
  }
}
