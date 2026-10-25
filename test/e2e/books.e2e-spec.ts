import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let accountant: string;
let plain: string;
let gl: Record<'cash' | 'bank' | 'payable' | 'capital' | 'sales' | 'salary', string>;
let supplier: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function login(identifier: string, password: string): Promise<string> {
  const response = await request(http)
    .post('/api/v1/auth/login')
    .set('X-Refresh-Token-Delivery', 'body')
    .send({ identifier, password })
    .expect(200);
  return response.body.accessToken as string;
}

async function create(path: string, body: Record<string, unknown>): Promise<string> {
  const response = await request(http).post(`/api/v1/accounts/${path}`).set(bearer(accountant)).send(body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
  return response.body.id as string;
}

async function user(name: string, permissions: string[]): Promise<string> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  if (permissions.length > 0) {
    const role = await request(http)
      .post('/api/v1/roles')
      .set(bearer(admin))
      .send({ name: `role-${name}`, permissions })
      .expect(201);
    await request(http)
      .post(`/api/v1/users/${created.body.id}/roles`)
      .set(bearer(admin))
      .send({ roleId: role.body.id })
      .expect(204);
  }
  return login(`${name}@example.com`, PASSWORD);
}

/** Nature → category → … → one account, returning the account id. */
async function account(
  natureCode: string,
  natureName: string,
  statement: string,
  normalBalance: string,
  code: string,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const existing = await request(http).get('/api/v1/accounts/natures').set(bearer(accountant));
  const nature =
    (existing.body as { id: string; code: string }[]).find((entry) => entry.code === natureCode)?.id ??
    (await create('natures', { code: natureCode, name: natureName, statement, normalBalance }));
  const category = await create('categories', { natureId: nature, code: `${code}C`, name: `${name} group` });
  const sub = await create('sub-categories', { categoryId: category, name: 'General' });
  const head4 = await create('level4-heads', { subCategoryId: sub, name: 'General' });
  const head5 = await create('level5-heads', { level4HeadId: head4, name: 'General' });
  return create('gl-accounts', { level5HeadId: head5, code, name, ...extra });
}

const post = (
  journalTypeId: string,
  voucherDate: string,
  lines: [string, number, number, Record<string, unknown>?][],
  postIt = true,
) =>
  request(http)
    .post('/api/v1/accounts/vouchers')
    .set(bearer(accountant))
    .send({
      journalTypeId,
      voucherDate,
      post: postIt,
      lines: lines.map(([glAccountId, debit, credit, extra]) => ({ glAccountId, debit, credit, ...extra })),
    })
    .expect(201);

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  accountant = await user('accountant', ['accounts:read', 'accounts:manage', 'vouchers:write', 'vouchers:post']);
  plain = await user('plain', []);
  gl = {
    cash: await account('1', 'Assets', 'balance_sheet', 'debit', '1001', 'Cash', { kind: 'cash' }),
    bank: await account('1', 'Assets', 'balance_sheet', 'debit', '1002', 'Bank', { kind: 'bank' }),
    payable: await account('2', 'Liabilities', 'balance_sheet', 'credit', '2001', 'Payables', {
      isControlAccount: true,
    }),
    capital: await account('3', 'Equity', 'balance_sheet', 'credit', '3001', 'Capital'),
    sales: await account('4', 'Income', 'profit_and_loss', 'credit', '4001', 'Sales'),
    salary: await account('5', 'Expenses', 'profit_and_loss', 'debit', '5001', 'Salaries'),
  };
  const types = await create('sub-ledger-types', { name: 'Suppliers' });
  supplier = await create('sub-ledgers', { typeId: types, name: 'ACI Limited' });
  await create('fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  const jv = await create('journal-types', { shortName: 'JV', name: 'Journal' });
  await post(jv, '2025-07-01', [
    [gl.bank, 100_000, 0],
    [gl.capital, 0, 100_000],
  ]);
  await post(jv, '2025-08-01', [
    [gl.cash, 30_000, 0],
    [gl.sales, 0, 30_000],
  ]);
  await post(jv, '2025-08-31', [
    [gl.salary, 12_000, 0],
    [gl.bank, 0, 12_000],
  ]);
  await post(jv, '2025-09-01', [
    [gl.cash, 5_000, 0],
    [gl.bank, 0, 5_000],
  ]);
  await post(jv, '2025-09-15', [
    [gl.salary, 3_000, 0],
    [gl.payable, 0, 3_000, { subLedgerId: supplier }],
  ]);
  // A draft does not count; a reversed voucher and its reversal cancel out.
  await post(
    jv,
    '2025-09-20',
    [
      [gl.cash, 999, 0],
      [gl.sales, 0, 999],
    ],
    false,
  );
  const mistake = await post(jv, '2025-09-21', [
    [gl.cash, 700, 0],
    [gl.sales, 0, 700],
  ]);
  await request(http)
    .post(`/api/v1/accounts/vouchers/${mistake.body.id}/reverse`)
    .set(bearer(accountant))
    .send({ version: 2, voucherDate: '2025-09-22' })
    .expect(200);
});

describe('books and statements', () => {
  it('reads ledgers, the day book and the statements from posted vouchers', async () => {
    const get = (path: string) => request(http).get(`/api/v1/accounts/${path}`).set(bearer(accountant)).expect(200);

    const bank = await get(`books/ledger?glAccountId=${gl.bank}&from=2025-08-01&to=2025-09-30`);
    expect(bank.body).toMatchObject({ title: '1002 Bank', opening: 100_000, totalCredit: 17_000, closing: 83_000 });
    expect(bank.body.rows.map((row: { contra: string; balance: number }) => [row.contra, row.balance])).toEqual([
      ['5001 Salaries', 88_000],
      ['1001 Cash', 83_000],
    ]);
    const owed = await get(`books/ledger?subLedgerId=${supplier}&from=2025-07-01&to=2026-06-30`);
    expect(owed.body).toMatchObject({ title: 'ACI Limited', closing: -3_000 });
    const cash = await get('books/cash?kind=cash&from=2025-07-01&to=2025-09-30');
    expect(cash.body).toMatchObject({ title: 'All cash accounts', closing: 35_000 });
    const dayBook = await get('books/day-book?from=2025-09-01&to=2025-09-30');
    expect(dayBook.body).toHaveLength(4);

    const tb = await get('statements/trial-balance?from=2025-08-01&to=2025-09-30');
    expect(tb.body).toMatchObject({ balanced: true, totals: { closingDebit: 133_000, closingCredit: 133_000 } });
    const pl = await get('statements/profit-and-loss?from=2025-07-01&to=2025-09-30');
    expect(pl.body.netProfit).toBe(15_000);
    const bs = await get('statements/balance-sheet?asOf=2025-09-30');
    expect(bs.body).toMatchObject({ totalDebit: 118_000, totalCredit: 118_000, profitToDate: 15_000, balanced: true });
    const flows = await get('statements/receipts-and-payments?from=2025-08-01&to=2025-09-30');
    // The reversed receipt and its reversal net out per account.
    expect(flows.body).toMatchObject({
      opening: 100_000,
      totalReceipts: 30_000,
      totalPayments: 12_000,
      closing: 118_000,
    });

    await request(http)
      .get('/api/v1/accounts/statements/trial-balance?from=2025-08-01&to=2025-09-30')
      .set(bearer(plain))
      .expect(403);
    await request(http)
      .get('/api/v1/accounts/statements/trial-balance?from=2025-09-30&to=2025-08-01')
      .set(bearer(accountant))
      .expect(422);

    for (const [key, params, formats] of [
      ['accounts.ledger', { glAccountId: gl.bank, from: '2025-07-01', to: '2025-09-30' }, ['pdf', 'xlsx']],
      ['accounts.sub-ledger', { subLedgerId: supplier, from: '2025-07-01', to: '2025-09-30' }, ['pdf']],
      ['accounts.cash-book', { kind: 'bank', from: '2025-07-01', to: '2025-09-30' }, ['pdf']],
      ['accounts.day-book', { from: '2025-07-01', to: '2025-09-30' }, ['pdf']],
      ['accounts.trial-balance', { from: '2025-07-01', to: '2025-09-30' }, ['pdf', 'xlsx']],
      ['accounts.profit-and-loss', { from: '2025-07-01', to: '2025-09-30' }, ['pdf']],
      ['accounts.balance-sheet', { asOf: '2025-09-30' }, ['pdf']],
      ['accounts.receipts-payments', { from: '2025-07-01', to: '2025-09-30' }, ['pdf']],
    ] as const) {
      for (const format of formats) {
        const response = await request(http)
          .post(`/api/v1/reports/${key}/render`)
          .set(bearer(admin))
          .send({ format, params });
        expect(response.status, `${key} ${format}: ${JSON.stringify(response.body).slice(0, 200)}`).toBe(200);
      }
    }
  });
});
