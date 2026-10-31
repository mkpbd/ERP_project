import { Injectable } from '@nestjs/common';
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { TaxableMonth } from '../../domain/income-tax.js';
import {
  IncomeTaxRepository,
  type IncomeTaxDeduction,
  type TaxDeposit,
  type TaxYear,
  type TaxYearFacts,
} from '../../domain/repositories.js';
import {
  festivalBonuses,
  festivalBonusLines,
  incomeTaxDeductions,
  incomeTaxYears,
  leaveEncashments,
  salarySheetLines,
  salarySheets,
  staffSalaries,
  taxChallans,
} from './payroll.schema.js';

type TaxYearRow = typeof incomeTaxYears.$inferSelect;

export const taxYearOf = (row: TaxYearRow): TaxYear => ({
  id: row.id,
  label: row.label,
  startsOn: row.startsOn,
  endsOn: row.endsOn,
  slabs: { male: row.maleSlabs, female: row.femaleSlabs },
  exemptionCap: { male: row.maleExemptionCap, female: row.femaleExemptionCap },
  rebateOnTaxablePercent: row.rebateOnTaxablePercent,
  investmentAllowancePercent: row.investmentAllowancePercent,
  rebateOnInvestmentPercent: row.rebateOnInvestmentPercent,
  rebateCap: row.rebateCap,
  minimumMonthlyTax: row.minimumMonthlyTax,
  minimumTaxGross: { male: row.maleMinimumTaxGross, female: row.femaleMinimumTaxGross },
  expectedBonusBasics: row.expectedBonusBasics,
});

/** year × 12 + month of a yyyy-mm-dd date. */
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

@Injectable()
export class DrizzleIncomeTaxRepository extends IncomeTaxRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async taxYearOn(date: string): Promise<TaxYear | null> {
    const [row] = await this.context.db
      .select()
      .from(incomeTaxYears)
      .where(and(lte(incomeTaxYears.startsOn, date), gte(incomeTaxYears.endsOn, date)));
    return row ? taxYearOf(row) : null;
  }

  async taxYear(id: string): Promise<TaxYear | null> {
    const [row] = await this.context.db.select().from(incomeTaxYears).where(eq(incomeTaxYears.id, id));
    return row ? taxYearOf(row) : null;
  }

  async facts(startsOn: string, endsOn: string, staffIds?: readonly string[]): Promise<TaxYearFacts[]> {
    const from = monthIndex(startsOn);
    const to = monthIndex(endsOn);
    const between = (year: PgColumn, month: PgColumn) => sql`${year} * 12 + ${month} between ${from} and ${to}`;
    const people = staffIds ? [...staffIds] : null;
    const [salaries, months, bonuses, encashments] = await Promise.all([
      this.context.db
        .select({
          staffId: staffSalaries.staffId,
          gross: staffSalaries.gross,
          basic: staffSalaries.basic,
          houseRent: staffSalaries.houseRent,
          medical: staffSalaries.medical,
          conveyance: staffSalaries.conveyance,
          otherAllowance: staffSalaries.otherAllowance,
          pf: staffSalaries.pf,
        })
        .from(staffSalaries)
        .where(people ? inArray(staffSalaries.staffId, people) : undefined),
      this.context.db
        .select({
          staffId: salarySheetLines.staffId,
          basic: salarySheetLines.basic,
          houseRent: salarySheetLines.houseRent,
          medical: salarySheetLines.medical,
          conveyance: salarySheetLines.conveyance,
          otherAllowance: salarySheetLines.otherAllowance,
          overtime: salarySheetLines.overtime,
          allowance: salarySheetLines.allowance,
          specialAllowance: salarySheetLines.specialAllowance,
          arrear: salarySheetLines.arrear,
          pf: salarySheetLines.pf,
          incomeTax: salarySheetLines.incomeTax,
        })
        .from(salarySheetLines)
        .innerJoin(salarySheets, eq(salarySheets.id, salarySheetLines.sheetId))
        .where(
          and(
            between(salarySheets.year, salarySheets.month),
            people ? inArray(salarySheetLines.staffId, people) : undefined,
          ),
        ),
      this.context.db
        .select({
          staffId: festivalBonusLines.staffId,
          amount: festivalBonusLines.amount,
          percent: festivalBonuses.percentOfBasic,
        })
        .from(festivalBonusLines)
        .innerJoin(festivalBonuses, eq(festivalBonuses.id, festivalBonusLines.bonusId))
        .where(
          and(
            between(festivalBonuses.payYear, festivalBonuses.payMonth),
            people ? inArray(festivalBonusLines.staffId, people) : undefined,
          ),
        ),
      this.context.db
        .select({ staffId: leaveEncashments.staffId, amount: leaveEncashments.amount })
        .from(leaveEncashments)
        .where(
          and(
            between(leaveEncashments.payYear, leaveEncashments.payMonth),
            people ? inArray(leaveEncashments.staffId, people) : undefined,
          ),
        ),
    ]);
    const group = <T extends { staffId: string }>(rows: T[]) => {
      const byStaff = new Map<string, T[]>();
      for (const row of rows) byStaff.set(row.staffId, [...(byStaff.get(row.staffId) ?? []), row]);
      return byStaff;
    };
    const monthsBy = group(months);
    const bonusesBy = group(bonuses);
    const encashedBy = group(encashments);
    return salaries.map(({ staffId, ...current }) => ({
      staffId,
      current,
      months: (monthsBy.get(staffId) ?? []).map(({ staffId: _staff, ...month }): TaxableMonth => month),
      bonuses: (bonusesBy.get(staffId) ?? []).map((bonus) => ({
        amount: bonus.amount,
        basics: bonus.percent / 100,
      })),
      leaveEncashment: (encashedBy.get(staffId) ?? []).reduce((sum, row) => sum + row.amount, 0),
    }));
  }

  async replaceComputed(
    payYear: number,
    payMonth: number,
    rows: readonly IncomeTaxDeduction[],
    updatedBy: string,
    updatedAt: Date,
  ): Promise<void> {
    await this.context.db
      .delete(incomeTaxDeductions)
      .where(
        and(
          eq(incomeTaxDeductions.payYear, payYear),
          eq(incomeTaxDeductions.payMonth, payMonth),
          eq(incomeTaxDeductions.source, 'computed'),
        ),
      );
    for (let start = 0; start < rows.length; start += 500) {
      await this.context.db
        .insert(incomeTaxDeductions)
        .values(rows.slice(start, start + 500).map((row) => ({ ...row, updatedBy, updatedAt })))
        // A deduction entered by hand stays.
        .onConflictDoNothing();
    }
  }

  async setManual(row: IncomeTaxDeduction, updatedBy: string, updatedAt: Date): Promise<void> {
    const values = { ...row, updatedBy, updatedAt };
    await this.context.db
      .insert(incomeTaxDeductions)
      .values(values)
      .onConflictDoUpdate({
        target: [incomeTaxDeductions.staffId, incomeTaxDeductions.payYear, incomeTaxDeductions.payMonth],
        set: values,
      });
  }

  async deposits(staffId: string, startsOn: string, endsOn: string): Promise<TaxDeposit[]> {
    const from = monthIndex(startsOn);
    const to = monthIndex(endsOn);
    const within = (year: PgColumn, month: PgColumn) => sql`${year} * 12 + ${month} between ${from} and ${to}`;
    const [deductions, challans] = await Promise.all([
      this.context.db
        .select({
          payYear: incomeTaxDeductions.payYear,
          payMonth: incomeTaxDeductions.payMonth,
          deducted: incomeTaxDeductions.monthlyTax,
        })
        .from(incomeTaxDeductions)
        .where(
          and(
            eq(incomeTaxDeductions.staffId, staffId),
            within(incomeTaxDeductions.payYear, incomeTaxDeductions.payMonth),
          ),
        ),
      this.context.db
        .select({
          payYear: taxChallans.payYear,
          payMonth: taxChallans.payMonth,
          challanNo: taxChallans.challanNo,
          challanDate: taxChallans.challanDate,
          bank: taxChallans.bank,
          deposited: taxChallans.amount,
        })
        .from(taxChallans)
        .where(and(eq(taxChallans.staffId, staffId), within(taxChallans.payYear, taxChallans.payMonth))),
    ]);
    const months = new Map<number, TaxDeposit>();
    const empty = { deducted: null, challanNo: null, challanDate: null, bank: null, deposited: null };
    for (const row of deductions) {
      months.set(row.payYear * 12 + row.payMonth, { ...empty, ...row });
    }
    for (const { payYear, payMonth, ...challan } of challans) {
      const key = payYear * 12 + payMonth;
      months.set(key, { ...(months.get(key) ?? { ...empty, payYear, payMonth }), ...challan });
    }
    return [...months].sort(([a], [b]) => a - b).map(([, month]) => month);
  }

  async removeManual(staffId: string, payYear: number, payMonth: number): Promise<boolean> {
    const rows = await this.context.db
      .delete(incomeTaxDeductions)
      .where(
        and(
          eq(incomeTaxDeductions.staffId, staffId),
          eq(incomeTaxDeductions.payYear, payYear),
          eq(incomeTaxDeductions.payMonth, payMonth),
          eq(incomeTaxDeductions.source, 'manual'),
        ),
      )
      .returning({ staffId: incomeTaxDeductions.staffId });
    return rows.length > 0;
  }
}
