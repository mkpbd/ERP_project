import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { BudgetRepository, type BudgetInput, type BudgetYear } from '../../application/budget.js';
import { accountBudgets, fiscalYears } from './accounts.schema.js';

@Injectable()
export class DrizzleBudgetRepository extends BudgetRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async fiscalYear(id: string): Promise<BudgetYear | null> {
    const [row] = await this.context.db
      .select({
        id: fiscalYears.id,
        label: fiscalYears.label,
        startsOn: fiscalYears.startsOn,
        endsOn: fiscalYears.endsOn,
        isClosed: fiscalYears.isClosed,
      })
      .from(fiscalYears)
      .where(eq(fiscalYears.id, id));
    return row ?? null;
  }

  async lines(fiscalYearId: string): Promise<BudgetInput[]> {
    return this.context.db
      .select({ glAccountId: accountBudgets.glAccountId, amount: accountBudgets.amount, note: accountBudgets.note })
      .from(accountBudgets)
      .where(eq(accountBudgets.fiscalYearId, fiscalYearId));
  }

  async replace(fiscalYearId: string, lines: readonly BudgetInput[], by: string, at: Date): Promise<void> {
    await this.context.db.delete(accountBudgets).where(eq(accountBudgets.fiscalYearId, fiscalYearId));
    if (lines.length === 0) return;
    await this.context.db
      .insert(accountBudgets)
      .values(lines.map((line) => ({ ...line, fiscalYearId, updatedBy: by, updatedAt: at })));
  }
}
