import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  balanceSheet,
  ledgerStatement,
  profitAndLoss,
  receiptsAndPayments,
  trialBalance,
  type AccountMovement,
  type BalanceSheet,
  type LedgerEntry,
  type LedgerStatement,
  type PostingLine,
  type ProfitAndLoss,
  type ReceiptsAndPayments,
  type StatementAccount,
  type TrialBalance,
} from '../domain/statements.js';
import { ACCOUNTS_READ } from './accounts.constants.js';

/** The earliest date anything can be posted on; "all time before" a date starts here. */
export const BEGINNING = '1900-01-01';
const MAX_DAYS = 3660;

export interface DayBookVoucher {
  readonly id: string;
  readonly number: string;
  readonly voucherDate: string;
  readonly journal: string;
  readonly narration: string | null;
  readonly lines: { readonly code: string; readonly name: string; readonly debit: number; readonly credit: number }[];
  readonly total: number;
}

export interface LedgerScope {
  readonly accountIds: readonly string[];
  readonly subLedgerId?: string | undefined;
}

/** Read side of the books: only posted vouchers (and reversed ones, whose reversal is posted too) count. */
export abstract class BooksReadRepository {
  abstract accounts(): Promise<(StatementAccount & { kind: 'bank' | 'cash' | 'other' })[]>;
  /** Sums per account before `from` and within `from`–`to`. */
  abstract movements(from: string, to: string): Promise<Map<string, AccountMovement>>;
  /** Balance (debit positive) before `from`. */
  abstract opening(scope: LedgerScope, from: string): Promise<number>;
  abstract entries(scope: LedgerScope, from: string, to: string): Promise<LedgerEntry[]>;
  abstract postingLines(from: string, to: string, accountIds: readonly string[]): Promise<PostingLine[]>;
  abstract dayBook(from: string, to: string): Promise<DayBookVoucher[]>;
  abstract subLedgerName(id: string): Promise<string | null>;
}

function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days > MAX_DAYS) throw new DomainError('invalid_period', 'Give a period of at most ten years');
}

export interface AccountLedger extends LedgerStatement {
  readonly title: string;
}

export class GetLedgerQuery extends Query<AccountLedger> {
  constructor(
    readonly actor: Actor,
    readonly from: string,
    readonly to: string,
    readonly scope:
      | { readonly glAccountId: string }
      | { readonly subLedgerId: string; readonly glAccountId?: string | undefined }
      | { readonly kind: 'cash' | 'bank' },
  ) {
    super();
  }
}

export class GetDayBookQuery extends Query<DayBookVoucher[]> {
  constructor(
    readonly actor: Actor,
    readonly from: string,
    readonly to: string,
  ) {
    super();
  }
}

export class GetTrialBalanceQuery extends Query<TrialBalance> {
  constructor(
    readonly actor: Actor,
    readonly from: string,
    readonly to: string,
  ) {
    super();
  }
}

export class GetProfitAndLossQuery extends Query<ProfitAndLoss> {
  constructor(
    readonly actor: Actor,
    readonly from: string,
    readonly to: string,
  ) {
    super();
  }
}

export class GetBalanceSheetQuery extends Query<BalanceSheet> {
  constructor(
    readonly actor: Actor,
    readonly asOf: string,
  ) {
    super();
  }
}

export class GetReceiptsAndPaymentsQuery extends Query<ReceiptsAndPayments> {
  constructor(
    readonly actor: Actor,
    readonly from: string,
    readonly to: string,
  ) {
    super();
  }
}

/** Shared by the queries and the reports. */
export class Books {
  constructor(private readonly read: BooksReadRepository) {}

  async ledger(from: string, to: string, scope: GetLedgerQuery['scope']): Promise<AccountLedger> {
    assertPeriod(from, to);
    const accounts = await this.read.accounts();
    let title: string;
    let ledgerScope: LedgerScope;
    if ('kind' in scope) {
      const ids = accounts.filter((account) => account.kind === scope.kind).map((account) => account.id);
      title = scope.kind === 'cash' ? 'All cash accounts' : 'All bank accounts';
      ledgerScope = { accountIds: ids };
    } else if ('subLedgerId' in scope) {
      const name = await this.read.subLedgerName(scope.subLedgerId);
      if (name === null) throw new NotFoundError('sub_ledger');
      const account = scope.glAccountId ? accounts.find((entry) => entry.id === scope.glAccountId) : undefined;
      if (scope.glAccountId && !account) throw new NotFoundError('gl_account');
      title = account ? `${name} — ${account.code} ${account.name}` : name;
      ledgerScope = { accountIds: account ? [account.id] : [], subLedgerId: scope.subLedgerId };
    } else {
      const account = accounts.find((entry) => entry.id === scope.glAccountId);
      if (!account) throw new NotFoundError('gl_account');
      title = `${account.code} ${account.name}`;
      ledgerScope = { accountIds: [account.id] };
    }
    const [opening, entries] = await Promise.all([
      this.read.opening(ledgerScope, from),
      this.read.entries(ledgerScope, from, to),
    ]);
    return { title, ...ledgerStatement(opening, entries) };
  }

  async trialBalance(from: string, to: string): Promise<TrialBalance> {
    assertPeriod(from, to);
    const [accounts, movements] = await Promise.all([this.read.accounts(), this.read.movements(from, to)]);
    return trialBalance(accounts, movements);
  }

  async profitAndLoss(from: string, to: string): Promise<ProfitAndLoss> {
    assertPeriod(from, to);
    const [accounts, movements] = await Promise.all([this.read.accounts(), this.read.movements(from, to)]);
    return profitAndLoss(accounts, movements);
  }

  async balanceSheet(asOf: string): Promise<BalanceSheet> {
    const [accounts, movements] = await Promise.all([this.read.accounts(), this.read.movements(BEGINNING, asOf)]);
    return balanceSheet(accounts, movements);
  }

  async receiptsAndPayments(from: string, to: string): Promise<ReceiptsAndPayments> {
    assertPeriod(from, to);
    const accounts = await this.read.accounts();
    const cash = accounts.filter((account) => account.kind !== 'other').map((account) => account.id);
    const [opening, lines] = await Promise.all([
      this.read.opening({ accountIds: cash }, from),
      this.read.postingLines(from, to, cash),
    ]);
    return receiptsAndPayments(
      opening,
      lines,
      new Set(cash),
      new Map(accounts.map((account) => [account.id, account])),
    );
  }

  dayBook(from: string, to: string): Promise<DayBookVoucher[]> {
    assertPeriod(from, to);
    return this.read.dayBook(from, to);
  }
}

abstract class BooksHandler {
  protected readonly books: Books;

  constructor(
    read: BooksReadRepository,
    private readonly access: AccessControl,
  ) {
    this.books = new Books(read);
  }

  protected authorize(actor: Actor): Promise<void> {
    return this.access.authorize(actor.userId, { permissions: [ACCOUNTS_READ] });
  }
}

@QueryHandler(GetLedgerQuery)
export class GetLedgerHandler extends BooksHandler implements IQueryHandler<GetLedgerQuery> {
  constructor(read: BooksReadRepository, access: AccessControl) {
    super(read, access);
  }

  async execute({ actor, from, to, scope }: GetLedgerQuery): Promise<AccountLedger> {
    await this.authorize(actor);
    return this.books.ledger(from, to, scope);
  }
}

@QueryHandler(GetDayBookQuery)
export class GetDayBookHandler extends BooksHandler implements IQueryHandler<GetDayBookQuery> {
  constructor(read: BooksReadRepository, access: AccessControl) {
    super(read, access);
  }

  async execute({ actor, from, to }: GetDayBookQuery): Promise<DayBookVoucher[]> {
    await this.authorize(actor);
    return this.books.dayBook(from, to);
  }
}

@QueryHandler(GetTrialBalanceQuery)
export class GetTrialBalanceHandler extends BooksHandler implements IQueryHandler<GetTrialBalanceQuery> {
  constructor(read: BooksReadRepository, access: AccessControl) {
    super(read, access);
  }

  async execute({ actor, from, to }: GetTrialBalanceQuery): Promise<TrialBalance> {
    await this.authorize(actor);
    return this.books.trialBalance(from, to);
  }
}

@QueryHandler(GetProfitAndLossQuery)
export class GetProfitAndLossHandler extends BooksHandler implements IQueryHandler<GetProfitAndLossQuery> {
  constructor(read: BooksReadRepository, access: AccessControl) {
    super(read, access);
  }

  async execute({ actor, from, to }: GetProfitAndLossQuery): Promise<ProfitAndLoss> {
    await this.authorize(actor);
    return this.books.profitAndLoss(from, to);
  }
}

@QueryHandler(GetBalanceSheetQuery)
export class GetBalanceSheetHandler extends BooksHandler implements IQueryHandler<GetBalanceSheetQuery> {
  constructor(read: BooksReadRepository, access: AccessControl) {
    super(read, access);
  }

  async execute({ actor, asOf }: GetBalanceSheetQuery): Promise<BalanceSheet> {
    await this.authorize(actor);
    return this.books.balanceSheet(asOf);
  }
}

@QueryHandler(GetReceiptsAndPaymentsQuery)
export class GetReceiptsAndPaymentsHandler extends BooksHandler implements IQueryHandler<GetReceiptsAndPaymentsQuery> {
  constructor(read: BooksReadRepository, access: AccessControl) {
    super(read, access);
  }

  async execute({ actor, from, to }: GetReceiptsAndPaymentsQuery): Promise<ReceiptsAndPayments> {
    await this.authorize(actor);
    return this.books.receiptsAndPayments(from, to);
  }
}

export const BOOK_HANDLERS = [
  GetLedgerHandler,
  GetDayBookHandler,
  GetTrialBalanceHandler,
  GetProfitAndLossHandler,
  GetBalanceSheetHandler,
  GetReceiptsAndPaymentsHandler,
];
