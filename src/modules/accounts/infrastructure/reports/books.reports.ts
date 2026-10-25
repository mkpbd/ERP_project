import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { Books, type BooksReadRepository } from '../../application/statements.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const period = z.strictObject({ from: day, to: day });
const describePeriod = (params: { from: string; to: string }) => `${params.from} to ${params.to}`;

/** A balance shown as an amount with Dr or Cr. */
const side = (balance: number) => ({ amount: Math.abs(balance), side: balance > 0 ? 'Dr' : balance < 0 ? 'Cr' : '' });

function ledgerReport(
  key: string,
  title: string,
  description: string,
  params: z.ZodType<{ from: string; to: string }>,
  scopeOf: (params: never) => Parameters<Books['ledger']>[2],
  books: Books,
): ReportDefinition {
  return defineReport({
    key,
    title,
    group: 'Accounts',
    description,
    params,
    async load(input) {
      const ledger = await books.ledger(input.from, input.to, scopeOf(input as never));
      return {
        ...ledger,
        opening: side(ledger.opening),
        closing: side(ledger.closing),
        rows: ledger.rows.map((row) => ({ ...row, side: side(row.balance) })),
      };
    },
    describe: (input, data) => `${data.title} · ${describePeriod(input)}`,
    pdf: { engine: 'html', template: template('ledger'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'date', header: 'Date', format: 'date' },
        { key: 'voucherNumber', header: 'Voucher', width: 22 },
        { key: 'narration', header: 'Narration', width: 36 },
        { key: 'contra', header: 'Other accounts', width: 36 },
        { key: 'debit', header: 'Debit', format: 'money' },
        { key: 'credit', header: 'Credit', format: 'money' },
        { key: 'balance', header: 'Balance (Dr +)', format: 'money' },
      ],
      rows: data.rows.map(({ side: _side, ...row }) => ({ ...row })),
    }),
  });
}

export function bookReports(read: BooksReadRepository): ReportDefinition[] {
  const books = new Books(read);
  return [
    ledgerReport(
      'accounts.ledger',
      'General ledger',
      'One account with opening balance, every posted entry and the running balance.',
      z.strictObject({ from: day, to: day, glAccountId: z.uuid() }),
      (input: { glAccountId: string }) => ({ glAccountId: input.glAccountId }),
      books,
    ),
    ledgerReport(
      'accounts.sub-ledger',
      'Sub-ledger statement',
      "A party's entries (optionally under one account) with the running balance.",
      z.strictObject({ from: day, to: day, subLedgerId: z.uuid(), glAccountId: z.uuid().optional() }),
      (input: { subLedgerId: string; glAccountId?: string }) => ({
        subLedgerId: input.subLedgerId,
        glAccountId: input.glAccountId,
      }),
      books,
    ),
    ledgerReport(
      'accounts.cash-book',
      'Cash and bank book',
      'All cash accounts (or all bank accounts) together, with the running balance.',
      z.strictObject({ from: day, to: day, kind: z.enum(['cash', 'bank']).default('cash') }),
      (input: { kind: 'cash' | 'bank' }) => ({ kind: input.kind }),
      books,
    ),
    defineReport({
      key: 'accounts.day-book',
      title: 'Day book',
      group: 'Accounts',
      description: 'Every posted voucher of the period with its lines.',
      params: period,
      async load(input) {
        const vouchers = await books.dayBook(input.from, input.to);
        return { vouchers, total: vouchers.reduce((sum, voucher) => sum + voucher.total, 0) };
      },
      describe: describePeriod,
      pdf: { engine: 'html', template: template('day-book') },
    }),
    defineReport({
      key: 'accounts.trial-balance',
      title: 'Trial balance',
      group: 'Accounts',
      description: 'Opening balance, period debits and credits, and closing balance of every account.',
      params: period,
      load: (input) => books.trialBalance(input.from, input.to),
      describe: describePeriod,
      pdf: { engine: 'html', template: template('trial-balance'), landscape: true },
      xlsx: (data) => ({
        columns: [
          { key: 'code', header: 'Code', width: 12 },
          { key: 'name', header: 'Account', width: 34 },
          { key: 'nature', header: 'Nature', width: 14 },
          { key: 'opening', header: 'Opening (Dr +)', format: 'money' },
          { key: 'debit', header: 'Debit', format: 'money' },
          { key: 'credit', header: 'Credit', format: 'money' },
          { key: 'closingDebit', header: 'Closing debit', format: 'money' },
          { key: 'closingCredit', header: 'Closing credit', format: 'money' },
        ],
        rows: data.rows.map((row) => ({ ...row })),
      }),
    }),
    defineReport({
      key: 'accounts.profit-and-loss',
      title: 'Profit and loss account',
      group: 'Accounts',
      description: 'Income and expenses of the period by nature and statement head, with the net result.',
      params: period,
      async load(input) {
        const statement = await books.profitAndLoss(input.from, input.to);
        return {
          sides: [
            {
              title: null,
              sections: statement.sections,
              extra: [],
              total: {
                label: statement.netProfit >= 0 ? 'Net profit' : 'Net loss',
                amount: Math.abs(statement.netProfit),
              },
            },
          ],
          note: null,
          warn: false,
        };
      },
      describe: describePeriod,
      pdf: { engine: 'html', template: template('sections') },
    }),
    defineReport({
      key: 'accounts.balance-sheet',
      title: 'Balance sheet',
      group: 'Accounts',
      description: 'Assets against liabilities and equity at a date, with income less expenses to date.',
      params: z.strictObject({ asOf: day }),
      async load(input) {
        const sheet = await books.balanceSheet(input.asOf);
        return {
          sides: [
            {
              title: 'Assets',
              sections: sheet.debitSections,
              extra: [],
              total: { label: 'Total assets', amount: sheet.totalDebit },
            },
            {
              title: 'Liabilities and equity',
              sections: sheet.creditSections,
              extra: [{ label: 'Profit and loss to date', amount: sheet.profitToDate }],
              total: { label: 'Total liabilities and equity', amount: sheet.totalCredit },
            },
          ],
          note: sheet.balanced ? null : 'The balance sheet does not balance.',
          warn: !sheet.balanced,
        };
      },
      describe: (input) => `As of ${input.asOf}`,
      pdf: { engine: 'html', template: template('sections') },
    }),
    defineReport({
      key: 'accounts.receipts-payments',
      title: 'Receipts and payments',
      group: 'Accounts',
      description: 'Cash and bank opening, what came in and went out by account, and closing.',
      params: period,
      load: (input) => books.receiptsAndPayments(input.from, input.to),
      describe: describePeriod,
      pdf: { engine: 'html', template: template('receipts-payments') },
    }),
  ];
}
