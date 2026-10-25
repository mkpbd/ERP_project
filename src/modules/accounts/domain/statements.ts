/** Amounts are kept in paisa while adding up, so totals are exact. */
const paisa = (amount: number) => Math.round(amount * 100);
const taka = (amount: number) => amount / 100;

export interface LedgerEntry {
  readonly date: string;
  readonly voucherId: string;
  readonly voucherNumber: string;
  readonly narration: string | null;
  /** The other accounts of the voucher, e.g. "4001 Sales". */
  readonly contra: string;
  readonly debit: number;
  readonly credit: number;
}

export interface LedgerStatement {
  /** Debit balance positive, credit balance negative. */
  readonly opening: number;
  readonly rows: (LedgerEntry & { readonly balance: number })[];
  readonly totalDebit: number;
  readonly totalCredit: number;
  readonly closing: number;
}

/** An account statement: opening balance, then each entry with the running balance (debit positive). */
export function ledgerStatement(opening: number, entries: readonly LedgerEntry[]): LedgerStatement {
  let balance = paisa(opening);
  let debit = 0;
  let credit = 0;
  const rows = entries.map((entry) => {
    balance += paisa(entry.debit) - paisa(entry.credit);
    debit += paisa(entry.debit);
    credit += paisa(entry.credit);
    return { ...entry, balance: taka(balance) };
  });
  return { opening, rows, totalDebit: taka(debit), totalCredit: taka(credit), closing: taka(balance) };
}

export type NormalBalance = 'debit' | 'credit';

/** Where an account sits: its nature, category and (if mapped) statement heads. */
export interface StatementAccount {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly nature: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly statement: 'balance_sheet' | 'profit_and_loss';
    readonly normalBalance: NormalBalance;
  };
  readonly category: string;
  readonly statementHead: { readonly broad: string; readonly sub: string } | null;
}

/** Debit and credit sums of one account, before the period and within it. */
export interface AccountMovement {
  readonly accountId: string;
  readonly openingDebit: number;
  readonly openingCredit: number;
  readonly debit: number;
  readonly credit: number;
}

export interface TrialBalanceRow {
  readonly code: string;
  readonly name: string;
  readonly nature: string;
  readonly opening: number;
  readonly debit: number;
  readonly credit: number;
  readonly closingDebit: number;
  readonly closingCredit: number;
}

export interface TrialBalance {
  readonly rows: TrialBalanceRow[];
  readonly totals: Omit<TrialBalanceRow, 'code' | 'name' | 'nature'>;
  /** Debits equal credits, as they must when every voucher is balanced. */
  readonly balanced: boolean;
}

/** Every account with a balance or movement: opening (debit positive), period debit and credit, closing. */
export function trialBalance(
  accounts: readonly StatementAccount[],
  movements: ReadonlyMap<string, AccountMovement>,
): TrialBalance {
  const totals = { opening: 0, debit: 0, credit: 0, closingDebit: 0, closingCredit: 0 };
  const rows: TrialBalanceRow[] = [];
  for (const account of accounts) {
    const movement = movements.get(account.id);
    if (!movement) continue;
    const opening = paisa(movement.openingDebit) - paisa(movement.openingCredit);
    const debit = paisa(movement.debit);
    const credit = paisa(movement.credit);
    const closing = opening + debit - credit;
    if (opening === 0 && debit === 0 && credit === 0) continue;
    totals.opening += opening;
    totals.debit += debit;
    totals.credit += credit;
    totals.closingDebit += Math.max(0, closing);
    totals.closingCredit += Math.max(0, -closing);
    rows.push({
      code: account.code,
      name: account.name,
      nature: account.nature.name,
      opening: taka(opening),
      debit: taka(debit),
      credit: taka(credit),
      closingDebit: taka(Math.max(0, closing)),
      closingCredit: taka(Math.max(0, -closing)),
    });
  }
  return {
    rows,
    totals: {
      opening: taka(totals.opening),
      debit: taka(totals.debit),
      credit: taka(totals.credit),
      closingDebit: taka(totals.closingDebit),
      closingCredit: taka(totals.closingCredit),
    },
    balanced: totals.debit === totals.credit && totals.closingDebit === totals.closingCredit,
  };
}

export interface StatementGroup {
  readonly title: string;
  readonly accounts: { readonly code: string; readonly name: string; readonly amount: number }[];
  readonly total: number;
}

export interface StatementSection {
  readonly nature: string;
  readonly normalBalance: NormalBalance;
  readonly groups: StatementGroup[];
  readonly total: number;
}

/**
 * The accounts of one statement, by nature, then by statement head (when mapped) or category; amounts in each
 * nature's normal direction (income as credit − debit, expenses as debit − credit). Zero accounts are left out.
 */
function sections(
  accounts: readonly StatementAccount[],
  amountOf: (account: StatementAccount) => number,
  statement: StatementAccount['nature']['statement'],
): StatementSection[] {
  const byNature = new Map<string, { nature: StatementAccount['nature']; groups: Map<string, StatementGroup> }>();
  for (const account of accounts) {
    if (account.nature.statement !== statement) continue;
    const raw = paisa(amountOf(account));
    const amount = account.nature.normalBalance === 'debit' ? raw : -raw;
    if (amount === 0) continue;
    const entry = byNature.get(account.nature.id) ?? {
      nature: account.nature,
      groups: new Map<string, StatementGroup>(),
    };
    byNature.set(account.nature.id, entry);
    const title = account.statementHead
      ? `${account.statementHead.broad} › ${account.statementHead.sub}`
      : account.category;
    const group = entry.groups.get(title) ?? { title, accounts: [], total: 0 };
    group.accounts.push({ code: account.code, name: account.name, amount: taka(amount) });
    entry.groups.set(title, { ...group, total: taka(paisa(group.total) + amount) });
  }
  return [...byNature.values()]
    .sort((a, b) => a.nature.code.localeCompare(b.nature.code))
    .map(({ nature, groups }) => {
      const list = [...groups.values()];
      return {
        nature: nature.name,
        normalBalance: nature.normalBalance,
        groups: list,
        total: taka(list.reduce((sum, group) => sum + paisa(group.total), 0)),
      };
    });
}

const net = (movement: AccountMovement | undefined, cumulative: boolean) =>
  movement ? (cumulative ? movement.openingDebit - movement.openingCredit : 0) + movement.debit - movement.credit : 0;

/** Credit-normal sections less debit-normal ones: income less expenses. */
const profitOf = (list: readonly StatementSection[]) =>
  taka(list.reduce((sum, section) => sum + (section.normalBalance === 'credit' ? 1 : -1) * paisa(section.total), 0));

export interface ProfitAndLoss {
  readonly sections: StatementSection[];
  /** Profit (positive) or loss (negative). */
  readonly netProfit: number;
}

/** Profit and loss for the period (movements only). */
export function profitAndLoss(
  accounts: readonly StatementAccount[],
  movements: ReadonlyMap<string, AccountMovement>,
): ProfitAndLoss {
  const list = sections(accounts, (account) => net(movements.get(account.id), false), 'profit_and_loss');
  return { sections: list, netProfit: profitOf(list) };
}

export interface BalanceSheet {
  /** Assets (debit-normal natures). */
  readonly debitSections: StatementSection[];
  /** Liabilities and equity (credit-normal natures). */
  readonly creditSections: StatementSection[];
  /** Income less expenses of all time up to the date (no closing entries are made yet). */
  readonly profitToDate: number;
  readonly totalDebit: number;
  readonly totalCredit: number;
  readonly balanced: boolean;
}

/** Balances up to a date (movements here are cumulative: opening + period). */
export function balanceSheet(
  accounts: readonly StatementAccount[],
  movements: ReadonlyMap<string, AccountMovement>,
): BalanceSheet {
  const amount = (account: StatementAccount) => net(movements.get(account.id), true);
  const all = sections(accounts, amount, 'balance_sheet');
  const profitToDate = profitOf(sections(accounts, amount, 'profit_and_loss'));
  const debitSections = all.filter((section) => section.normalBalance === 'debit');
  const creditSections = all.filter((section) => section.normalBalance === 'credit');
  const totalDebit = debitSections.reduce((sum, section) => sum + paisa(section.total), 0);
  const totalCredit = creditSections.reduce((sum, section) => sum + paisa(section.total), 0) + paisa(profitToDate);
  return {
    debitSections,
    creditSections,
    profitToDate,
    totalDebit: taka(totalDebit),
    totalCredit: taka(totalCredit),
    balanced: totalDebit === totalCredit,
  };
}

/** A posted voucher line, for receipts and payments. */
export interface PostingLine {
  readonly voucherId: string;
  readonly accountId: string;
  readonly debit: number;
  readonly credit: number;
}

export interface ReceiptsAndPayments {
  readonly opening: number;
  readonly receipts: { readonly code: string; readonly name: string; readonly amount: number }[];
  readonly payments: { readonly code: string; readonly name: string; readonly amount: number }[];
  readonly totalReceipts: number;
  readonly totalPayments: number;
  readonly closing: number;
}

/**
 * Old SpGetReceiptsAndPayment: what came into and went out of the cash and bank accounts in the period, by the
 * other account of each voucher (its net credit is a receipt, its net debit a payment). Moves between cash and
 * bank accounts cancel out.
 */
export function receiptsAndPayments(
  opening: number,
  lines: readonly PostingLine[],
  cashAccounts: ReadonlySet<string>,
  accounts: ReadonlyMap<string, { code: string; name: string }>,
): ReceiptsAndPayments {
  const byVoucher = new Map<string, PostingLine[]>();
  for (const line of lines) byVoucher.set(line.voucherId, [...(byVoucher.get(line.voucherId) ?? []), line]);
  const flows = new Map<string, number>();
  let cashChange = 0;
  for (const voucherLines of byVoucher.values()) {
    if (!voucherLines.some((line) => cashAccounts.has(line.accountId))) continue;
    for (const line of voucherLines) {
      const change = paisa(line.debit) - paisa(line.credit);
      if (cashAccounts.has(line.accountId)) cashChange += change;
      else flows.set(line.accountId, (flows.get(line.accountId) ?? 0) - change);
    }
  }
  const named = (accountId: string, amount: number) => ({
    code: accounts.get(accountId)?.code ?? '',
    name: accounts.get(accountId)?.name ?? '',
    amount: taka(Math.abs(amount)),
  });
  const entries = [...flows.entries()].sort(([a], [b]) =>
    (accounts.get(a)?.code ?? '').localeCompare(accounts.get(b)?.code ?? ''),
  );
  const receipts = entries.filter(([, amount]) => amount > 0).map(([id, amount]) => named(id, amount));
  const payments = entries.filter(([, amount]) => amount < 0).map(([id, amount]) => named(id, amount));
  const sum = (list: { amount: number }[]) => taka(list.reduce((total, entry) => total + paisa(entry.amount), 0));
  return {
    opening,
    receipts,
    payments,
    totalReceipts: sum(receipts),
    totalPayments: sum(payments),
    closing: taka(paisa(opening) + cashChange),
  };
}
