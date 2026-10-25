import { describe, expect, it } from 'vitest';
import {
  balanceSheet,
  ledgerStatement,
  profitAndLoss,
  receiptsAndPayments,
  trialBalance,
  type AccountMovement,
  type PostingLine,
  type StatementAccount,
} from '../../../src/modules/accounts/domain/statements.js';

const nature = (
  code: string,
  name: string,
  statement: 'balance_sheet' | 'profit_and_loss',
  normalBalance: 'debit' | 'credit',
) => ({
  id: code,
  code,
  name,
  statement,
  normalBalance,
});
const ASSETS = nature('1', 'Assets', 'balance_sheet', 'debit');
const LIABILITIES = nature('2', 'Liabilities', 'balance_sheet', 'credit');
const EQUITY = nature('3', 'Equity', 'balance_sheet', 'credit');
const INCOME = nature('4', 'Income', 'profit_and_loss', 'credit');
const EXPENSES = nature('5', 'Expenses', 'profit_and_loss', 'debit');
const account = (
  id: string,
  code: string,
  n: StatementAccount['nature'],
  category: string,
  head: StatementAccount['statementHead'] = null,
) => ({
  id,
  code,
  name: id,
  nature: n,
  category,
  statementHead: head,
});
const accounts: StatementAccount[] = [
  account('cash', '1001', ASSETS, 'Current assets', { broad: 'Current assets', sub: 'Cash and bank' }),
  account('bank', '1002', ASSETS, 'Current assets', { broad: 'Current assets', sub: 'Cash and bank' }),
  account('payable', '2001', LIABILITIES, 'Current liabilities'),
  account('capital', '3001', EQUITY, 'Capital'),
  account('sales', '4001', INCOME, 'Operating income'),
  account('salary', '5001', EXPENSES, 'Staff costs'),
];

// A small hospital's first quarter.
const vouchers: { id: string; date: string; lines: [string, number, number][] }[] = [
  {
    id: 'v1',
    date: '2025-07-01',
    lines: [
      ['bank', 100_000, 0],
      ['capital', 0, 100_000],
    ],
  },
  {
    id: 'v2',
    date: '2025-08-01',
    lines: [
      ['cash', 30_000, 0],
      ['sales', 0, 30_000],
    ],
  },
  {
    id: 'v3',
    date: '2025-08-31',
    lines: [
      ['salary', 12_000, 0],
      ['bank', 0, 12_000],
    ],
  },
  {
    id: 'v4',
    date: '2025-09-01',
    lines: [
      ['cash', 5_000, 0],
      ['bank', 0, 5_000],
    ],
  },
  {
    id: 'v5',
    date: '2025-09-15',
    lines: [
      ['salary', 3_000, 0],
      ['payable', 0, 3_000],
    ],
  },
];
function movements(from: string, to: string): Map<string, AccountMovement> {
  const result = new Map<string, AccountMovement>();
  for (const voucher of vouchers) {
    if (voucher.date > to) continue;
    for (const [accountId, debit, credit] of voucher.lines) {
      const current = result.get(accountId) ?? { accountId, openingDebit: 0, openingCredit: 0, debit: 0, credit: 0 };
      result.set(
        accountId,
        voucher.date < from
          ? { ...current, openingDebit: current.openingDebit + debit, openingCredit: current.openingCredit + credit }
          : { ...current, debit: current.debit + debit, credit: current.credit + credit },
      );
    }
  }
  return result;
}

describe('books and statements', () => {
  it('keeps a running balance in a ledger', () => {
    const entry = (debit: number, credit: number) => ({
      date: '2025-08-01',
      voucherId: 'v',
      voucherNumber: 'JV-1',
      narration: null,
      contra: '',
      debit,
      credit,
    });
    const ledger = ledgerStatement(100_000, [entry(0, 12_000), entry(0.1, 0), entry(0.2, 0)]);
    expect(ledger.rows.map((row) => row.balance)).toEqual([88_000, 88_000.1, 88_000.3]);
    expect(ledger).toMatchObject({ totalDebit: 0.3, totalCredit: 12_000, closing: 88_000.3 });
  });

  it('balances the trial balance for a period', () => {
    const tb = trialBalance(accounts, movements('2025-08-01', '2025-08-31'));
    expect(tb.balanced).toBe(true);
    expect(tb.totals).toMatchObject({
      debit: 42_000,
      credit: 42_000,
      closingDebit: 130_000,
      closingCredit: 130_000,
    });
    expect(tb.rows.find((row) => row.code === '1002')).toMatchObject({
      opening: 100_000,
      credit: 12_000,
      closingDebit: 88_000,
    });
    expect(tb.rows.map((row) => row.code)).not.toContain('2001');
  });

  it('works out profit and loss with heads or categories', () => {
    const pl = profitAndLoss(accounts, movements('2025-08-01', '2025-09-30'));
    expect(pl.netProfit).toBe(15_000);
    expect(pl.sections.map((section) => [section.nature, section.total])).toEqual([
      ['Income', 30_000],
      ['Expenses', 15_000],
    ]);
    expect(pl.sections[1]!.groups[0]).toMatchObject({ title: 'Staff costs', total: 15_000 });
  });

  it('balances the balance sheet with profit to date', () => {
    const sheet = balanceSheet(accounts, movements('1900-01-01', '2025-09-30'));
    expect(sheet).toMatchObject({ totalDebit: 118_000, totalCredit: 118_000, profitToDate: 15_000, balanced: true });
    expect(sheet.debitSections[0]!.groups[0]).toMatchObject({
      title: 'Current assets › Cash and bank',
      total: 118_000,
    });
    expect(sheet.creditSections.map((section) => section.nature)).toEqual(['Liabilities', 'Equity']);
  });

  it('lists receipts and payments by the other account; transfers cancel out', () => {
    const lines: PostingLine[] = vouchers
      .filter((voucher) => voucher.date >= '2025-08-01')
      .flatMap((voucher) =>
        voucher.lines.map(([accountId, debit, credit]) => ({ voucherId: voucher.id, accountId, debit, credit })),
      );
    const names = new Map(accounts.map((entry) => [entry.id, entry]));
    const flows = receiptsAndPayments(100_000, lines, new Set(['cash', 'bank']), names);
    expect(flows).toEqual({
      opening: 100_000,
      receipts: [{ code: '4001', name: 'sales', amount: 30_000 }],
      payments: [{ code: '5001', name: 'salary', amount: 12_000 }],
      totalReceipts: 30_000,
      totalPayments: 12_000,
      closing: 118_000,
    });
  });
});
