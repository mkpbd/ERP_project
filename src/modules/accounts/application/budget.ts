import { Command, CommandHandler, Query, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { ACCOUNTS_MANAGE, ACCOUNTS_READ } from './accounts.constants.js';
import { BooksReadRepository } from './statements.js';

export const MAX_BUDGET_LINES = 2000;

const paisa = (value: number) => Math.round(value * 100);
const taka = (paisas: number) => paisas / 100;

export interface BudgetYear {
  readonly id: string;
  readonly label: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly isClosed: boolean;
}

export interface BudgetInput {
  readonly glAccountId: string;
  readonly amount: number;
  readonly note: string | null;
}

export abstract class BudgetRepository {
  abstract fiscalYear(id: string): Promise<BudgetYear | null>;
  abstract lines(fiscalYearId: string): Promise<BudgetInput[]>;
  /** The year's whole budget, replaced. */
  abstract replace(fiscalYearId: string, lines: readonly BudgetInput[], by: string, at: Date): Promise<void>;
}

export interface BudgetLine {
  readonly glAccountId: string;
  readonly code: string;
  readonly name: string;
  readonly nature: string;
  /** Income (credit-normal) or expense (debit-normal). */
  readonly side: 'income' | 'expense';
  readonly budgeted: boolean;
  readonly budget: number;
  /** Posted from the year's start to the date. */
  readonly actual: number;
  /** Actual less budget. */
  readonly variance: number;
  /** Actual as a share of the budget; null without a budget. */
  readonly usedPercent: number | null;
  readonly note: string | null;
}

export interface BudgetTotals {
  readonly budget: number;
  readonly actual: number;
}

export interface BudgetView {
  readonly fiscalYear: BudgetYear;
  readonly to: string;
  readonly lines: BudgetLine[];
  readonly income: BudgetTotals;
  readonly expense: BudgetTotals;
  /** Income less expenses. */
  readonly profit: BudgetTotals;
}

/** Old Budget Settings: the year's budget, account by account (income and expense accounts of the main books). */
export class SetBudgetCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly fiscalYearId: string,
    readonly lines: readonly BudgetInput[],
  ) {
    super();
  }
}

/** The year's budget against what was posted from its start to a date (its end when left out). */
export class GetBudgetQuery extends Query<BudgetView> {
  constructor(
    readonly actor: Actor,
    readonly fiscalYearId: string,
    readonly to: string | null,
  ) {
    super();
  }
}

/** The income and expense accounts of the main books, by id. */
async function budgetAccounts(books: BooksReadRepository) {
  const accounts = await books.accounts();
  return new Map(
    accounts
      .filter((account) => account.book === 'main' && account.nature.statement === 'profit_and_loss')
      .map((account) => [account.id, account]),
  );
}

@CommandHandler(SetBudgetCommand)
export class SetBudgetHandler implements ICommandHandler<SetBudgetCommand> {
  constructor(
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly budgets: BudgetRepository,
    private readonly books: BooksReadRepository,
  ) {}

  async execute({ actor, fiscalYearId, lines }: SetBudgetCommand): Promise<void> {
    await this.access.authorize(actor.userId, { permissions: [ACCOUNTS_MANAGE] });
    if (lines.length > MAX_BUDGET_LINES) {
      throw new DomainError('invalid_lines', `A budget has at most ${MAX_BUDGET_LINES} accounts`);
    }
    if (new Set(lines.map((line) => line.glAccountId)).size !== lines.length) {
      throw new DomainError('duplicate_account', 'An account is in the budget twice');
    }
    const year = await this.budgets.fiscalYear(fiscalYearId);
    if (!year) throw new NotFoundError('fiscal_year');
    if (year.isClosed) throw new DomainError('fiscal_year_closed', `${year.label} is closed`);
    const accounts = await budgetAccounts(this.books);
    const all = new Set((await this.books.accounts()).map((account) => account.id));
    for (const line of lines) {
      if (!all.has(line.glAccountId)) throw new NotFoundError('gl_account');
      if (!accounts.has(line.glAccountId)) {
        throw new DomainError('not_budgetable', 'Only income and expense accounts of the main books have a budget');
      }
    }
    await this.tx.run(async () => {
      await this.budgets.replace(fiscalYearId, lines, actor.userId, this.clock.now());
      await this.audit.record({
        action: 'accounts.budget_set',
        actorUserId: actor.userId,
        resourceType: 'budget',
        resourceId: fiscalYearId,
        metadata: { accounts: lines.length, total: taka(lines.reduce((sum, line) => sum + paisa(line.amount), 0)) },
      });
    });
  }
}

@QueryHandler(GetBudgetQuery)
export class GetBudgetHandler implements IQueryHandler<GetBudgetQuery> {
  constructor(
    private readonly access: AccessControl,
    private readonly budgets: BudgetRepository,
    private readonly books: BooksReadRepository,
  ) {}

  async execute({ actor, fiscalYearId, to }: GetBudgetQuery): Promise<BudgetView> {
    await this.access.authorize(actor.userId, { permissions: [ACCOUNTS_READ] });
    return budgetView(this.budgets, this.books, fiscalYearId, to);
  }
}

/** Every budgeted account, and every income or expense account with postings, budget against actual. */
export async function budgetView(
  budgets: BudgetRepository,
  books: BooksReadRepository,
  fiscalYearId: string,
  to: string | null,
): Promise<BudgetView> {
  const year = await budgets.fiscalYear(fiscalYearId);
  if (!year) throw new NotFoundError('fiscal_year');
  const until = to ?? year.endsOn;
  if (until < year.startsOn || until > year.endsOn) {
    throw new DomainError('invalid_period', `The date is outside ${year.label}`);
  }
  const [accounts, planned, movements] = await Promise.all([
    budgetAccounts(books),
    budgets.lines(fiscalYearId),
    books.movements(year.startsOn, until),
  ]);
  const byAccount = new Map(planned.map((line) => [line.glAccountId, line]));
  const lines: BudgetLine[] = [];
  for (const account of accounts.values()) {
    const plan = byAccount.get(account.id);
    const movement = movements.get(account.id);
    const side = account.nature.normalBalance === 'credit' ? 'income' : 'expense';
    const net = movement ? paisa(movement.debit) - paisa(movement.credit) : 0;
    const actual = taka(side === 'income' ? -net : net);
    if (!plan && actual === 0) continue;
    const budget = plan?.amount ?? 0;
    lines.push({
      glAccountId: account.id,
      code: account.code,
      name: account.name,
      nature: account.nature.name,
      side,
      budgeted: plan !== undefined,
      budget,
      actual,
      variance: taka(paisa(actual) - paisa(budget)),
      usedPercent: budget > 0 ? Math.round((actual / budget) * 1000) / 10 : null,
      note: plan?.note ?? null,
    });
  }
  const total = (side: 'income' | 'expense'): BudgetTotals => {
    const own = lines.filter((line) => line.side === side);
    return {
      budget: taka(own.reduce((sum, line) => sum + paisa(line.budget), 0)),
      actual: taka(own.reduce((sum, line) => sum + paisa(line.actual), 0)),
    };
  };
  const income = total('income');
  const expense = total('expense');
  return {
    fiscalYear: year,
    to: until,
    lines,
    income,
    expense,
    profit: {
      budget: taka(paisa(income.budget) - paisa(expense.budget)),
      actual: taka(paisa(income.actual) - paisa(expense.actual)),
    },
  };
}

export const BUDGET_HANDLERS = [SetBudgetHandler, GetBudgetHandler];
