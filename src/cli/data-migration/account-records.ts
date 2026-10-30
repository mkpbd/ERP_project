import { accept, reject, type Transformed } from './legacy-records.js';

/** Text as it is kept here: whitespace collapsed, trimmed, cut to `max`; null when nothing is left. */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const cleaned = String(value).replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned.slice(0, max);
}

export interface LegacyNature {
  readonly Id: number;
  readonly Name: string | null;
  readonly CodeNo: string | null;
  /** Old MasterStatements.Name of the nature. */
  readonly Statement: string | null;
}

/**
 * Old Account.NatureOfAccounts → account_natures. The old table had no normal balance: it is read from the name
 * (assets and expenses are debit, liabilities, equity and income credit), and the statement from the master statement
 * (or, when it says nothing, from the name too).
 */
export function natureRecord(row: LegacyNature): Transformed<{
  code: string;
  name: string;
  statement: 'balance_sheet' | 'profit_and_loss';
  normalBalance: 'debit' | 'credit';
}> {
  const name = text(row.Name, 150);
  if (!name) return reject<never>('no_name');
  const words = name.toLowerCase();
  const normalBalance = /asset|expense|expenditure|cost|loss/.test(words)
    ? 'debit'
    : /liabilit|equity|capital|income|revenue|fund|reserve|profit/.test(words)
      ? 'credit'
      : null;
  if (!normalBalance) return reject<never>('unknown_nature');
  const master = (row.Statement ?? '').toLowerCase();
  const statement = /profit|loss|income/.test(master)
    ? 'profit_and_loss'
    : /balance|position/.test(master)
      ? 'balance_sheet'
      : /income|revenue|expense|expenditure|cost/.test(words)
        ? 'profit_and_loss'
        : 'balance_sheet';
  return accept({ code: text(row.CodeNo, 30) ?? `N${row.Id}`, name, statement, normalBalance });
}

export function glKind(value: unknown): 'bank' | 'cash' | 'other' {
  const kind = text(value, 20)?.toLowerCase() ?? '';
  return kind.startsWith('bank') ? 'bank' : kind.startsWith('cash') ? 'cash' : 'other';
}

export interface LegacyGeneralLedger {
  readonly Id: string;
  readonly Name: string | null;
  readonly GLCodeNo: string | null;
  readonly Level5HeadId: string;
  readonly COADescriptionId: string | null;
  readonly IsControlAccount: boolean | null;
  readonly IsCostCenter: boolean | null;
  readonly BankCashOth: string | null;
  readonly IsActive: boolean | null;
  readonly IsRecurringCost: boolean | null;
  readonly IsBillingContainDetails: boolean | null;
  readonly IsDeleted: boolean | null;
}

/** Old Account.GeneralLedgers → gl_accounts (the head and description are looked up by the loader). */
export function glAccountRecord(row: LegacyGeneralLedger): Transformed<{
  code: string;
  name: string;
  kind: 'bank' | 'cash' | 'other';
  isControlAccount: boolean;
  requiresCostCenter: boolean;
  isRecurringCost: boolean;
  billingHasDetails: boolean;
  isActive: boolean;
}> {
  const name = text(row.Name, 200);
  if (!name) return reject<never>('no_name');
  const code = text(row.GLCodeNo, 30)?.toUpperCase();
  if (!code) return reject<never>('no_code');
  return accept({
    code,
    name,
    kind: glKind(row.BankCashOth),
    isControlAccount: row.IsControlAccount === true,
    requiresCostCenter: row.IsCostCenter === true,
    isRecurringCost: row.IsRecurringCost === true,
    billingHasDetails: row.IsBillingContainDetails === true,
    isActive: row.IsActive !== false && row.IsDeleted !== true,
  });
}

/** Old fiscal years were calendar years (FiscalYears.FYear == the posting date's year). */
export function fiscalYearRecord(year: unknown): Transformed<{ label: string; startsOn: string; endsOn: string }> {
  const value = typeof year === 'number' ? year : Number.parseInt(String(year), 10);
  if (!Number.isInteger(value) || value < 1990 || value > 2100) return reject<never>('invalid_year');
  return accept({ label: String(value), startsOn: `${value}-01-01`, endsOn: `${value}-12-31` });
}

/** The day before `day` (YYYY-MM-DD): the opening voucher's date for a cut-over. */
export function dayBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** An account's balance in the old books, already matched to this system's ids. */
export interface Balance {
  readonly glAccountId: string;
  readonly subLedgerId: string | null;
  readonly costCenterId: string | null;
  readonly debit: number;
  readonly credit: number;
}

export interface OpeningLine {
  readonly glAccountId: string;
  readonly subLedgerId: string | null;
  readonly costCenterId: string | null;
  readonly debit: number;
  readonly credit: number;
}

/** Below this (in paisa), a difference between the old books' debits and credits is rounding of their float sums. */
export const ROUNDING_TOLERANCE = 100;

const paisa = (value: number) => Math.round(value * 100);

/**
 * The opening voucher's lines: each account's (and sub-ledger's, cost centre's) net balance on its side, zero
 * balances left out. Debits must equal credits; a difference of under one taka (float rounding in the old sums) is
 * put on the largest line of the short side and reported, a bigger one refuses the whole opening.
 */
export function openingLines(
  balances: readonly Balance[],
): { ok: true; lines: OpeningLine[]; total: number; adjusted: number } | { ok: false; difference: number } {
  const nets = new Map<string, { line: Omit<OpeningLine, 'debit' | 'credit'>; net: number }>();
  for (const balance of balances) {
    const key = `${balance.glAccountId}|${balance.subLedgerId ?? ''}|${balance.costCenterId ?? ''}`;
    const entry = nets.get(key) ?? {
      line: { glAccountId: balance.glAccountId, subLedgerId: balance.subLedgerId, costCenterId: balance.costCenterId },
      net: 0,
    };
    entry.net += paisa(balance.debit) - paisa(balance.credit);
    nets.set(key, entry);
  }
  const lines = [...nets.values()]
    .filter((entry) => entry.net !== 0)
    .map((entry) => ({ ...entry.line, net: entry.net }));
  const difference = lines.reduce((sum, line) => sum + line.net, 0);
  if (Math.abs(difference) >= ROUNDING_TOLERANCE) return { ok: false, difference: difference / 100 };
  if (difference !== 0) {
    // More debit than credit: the largest credit line takes the difference, and the other way round.
    const side = lines.filter((line) => (difference > 0 ? line.net < 0 : line.net > 0));
    const largest = side.sort((a, b) => Math.abs(b.net) - Math.abs(a.net))[0];
    if (!largest) return { ok: false, difference: difference / 100 };
    largest.net -= difference;
  }
  const total = lines.reduce((sum, line) => sum + Math.max(line.net, 0), 0);
  return {
    ok: true,
    lines: lines.map(({ net, ...line }) => ({
      ...line,
      debit: net > 0 ? net / 100 : 0,
      credit: net < 0 ? -net / 100 : 0,
    })),
    total: total / 100,
    adjusted: difference / 100,
  };
}
