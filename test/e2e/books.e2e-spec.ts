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

describe('PF book', () => {
  it('keeps the trust’s vouchers and statements apart from the main books', async () => {
    const asAdmin = async (path: string, body: Record<string, unknown>) => {
      const response = await request(http).post(`/api/v1/${path}`).set(bearer(admin)).send(body);
      expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
      return response.body.id as string;
    };
    const fundNature = await create('natures', {
      code: 'P1',
      name: 'PF fund assets',
      statement: 'balance_sheet',
      normalBalance: 'debit',
      book: 'pf',
    });
    await create('natures', {
      code: 'P2',
      name: 'PF members',
      statement: 'balance_sheet',
      normalBalance: 'credit',
      book: 'pf',
    });
    const fundBank = await account('P1', '', '', '', 'P101', 'PF bank account', { kind: 'bank' });
    const members = await account('P2', '', '', '', 'P201', 'Members’ contributions', { isControlAccount: true });
    const pfJournal = await create('journal-types', { shortName: 'PFJ', name: 'PF journal', book: 'pf' });
    const natures = await request(http).get('/api/v1/accounts/natures?book=pf').set(bearer(accountant)).expect(200);
    expect(natures.body.map((nature: { code: string }) => nature.code)).toEqual(['P1', 'P2']);

    // A PF member is a sub-ledger linked to their staff record.
    const division = await asAdmin('hr/divisions', { name: 'Clinical' });
    const department = await asAdmin('hr/departments', { divisionId: division, name: 'Nursing' });
    const staffId = await asAdmin('hr/staff', {
      employeeNo: 'N-001',
      fullName: 'Jane',
      joiningDate: '2023-03-10',
      departmentId: department,
      subDepartmentId: await asAdmin('hr/sub-departments', { departmentId: department, name: 'ICU' }),
      designationId: await asAdmin('hr/designations', { name: 'Staff Nurse' }),
      serviceNature: 'Permanent',
      salaryStatus: 'Regular',
    });
    const memberType = await create('sub-ledger-types', { name: 'PF members' });
    const jane = await create('sub-ledgers', { typeId: memberType, name: 'Jane (N-001)', staffId });
    const linked = await request(http)
      .get(`/api/v1/accounts/sub-ledgers?staffId=${staffId}`)
      .set(bearer(accountant))
      .expect(200);
    expect(linked.body.map((entry: { id: string }) => entry.id)).toEqual([jane]);
    const ghost = await request(http)
      .post('/api/v1/accounts/sub-ledgers')
      .set(bearer(accountant))
      .send({ typeId: memberType, name: 'Ghost', staffId: '00000000-0000-4000-8000-000000000000' })
      .expect(404);
    expect(ghost.body.code).toBe('staff_not_found');

    await post(pfJournal, '2025-09-30', [
      [fundBank, 3_600, 0],
      [members, 0, 3_600, { subLedgerId: jane }],
    ]);
    const mixed = await request(http)
      .post('/api/v1/accounts/vouchers')
      .set(bearer(accountant))
      .send({
        journalTypeId: pfJournal,
        voucherDate: '2025-09-30',
        lines: [
          { glAccountId: fundBank, debit: 100, credit: 0 },
          { glAccountId: gl.capital, debit: 0, credit: 100 },
        ],
      })
      .expect(422);
    expect(mixed.body.detail).toMatch(/3001 belongs to the main book/);
    const journals = await request(http).get('/api/v1/accounts/journal-types?book=main').set(bearer(accountant));
    expect(journals.body.map((journal: { shortName: string }) => journal.shortName)).toEqual(['JV']);
    await request(http)
      .post('/api/v1/accounts/vouchers')
      .set(bearer(accountant))
      .send({
        journalTypeId: journals.body[0].id,
        voucherDate: '2025-09-30',
        lines: [
          { glAccountId: gl.bank, debit: 100, credit: 0 },
          { glAccountId: members, debit: 0, credit: 100 },
        ],
      })
      .expect(422);

    const get = (path: string) => request(http).get(`/api/v1/accounts/${path}`).set(bearer(accountant)).expect(200);
    const pfTrial = await get('statements/trial-balance?from=2025-07-01&to=2025-09-30&book=pf');
    expect(pfTrial.body).toMatchObject({ balanced: true, totals: { closingDebit: 3_600, closingCredit: 3_600 } });
    const mainTrial = await get('statements/trial-balance?from=2025-08-01&to=2025-09-30');
    expect(mainTrial.body.totals).toMatchObject({ closingDebit: 133_000, closingCredit: 133_000 });
    const pfDayBook = await get('books/day-book?from=2025-07-01&to=2025-09-30&book=pf');
    expect(pfDayBook.body).toHaveLength(1);
    const pfBalance = await get('statements/balance-sheet?asOf=2025-09-30&book=pf');
    expect(pfBalance.body).toMatchObject({ totalDebit: 3_600, totalCredit: 3_600, balanced: true });
    const owed = await get(`books/ledger?subLedgerId=${jane}&from=2025-07-01&to=2026-06-30`);
    expect(owed.body).toMatchObject({ title: 'Jane (N-001)', closing: -3_600 });

    // Once used, a nature or journal type stays in its book.
    for (const path of [`natures/${fundNature}`, `journal-types/${pfJournal}`]) {
      const moved = await request(http)
        .patch(`/api/v1/accounts/${path}`)
        .set(bearer(accountant))
        .send({ book: 'main' })
        .expect(409);
      expect(moved.body.code).toBe('book_in_use');
    }

    await request(http)
      .post('/api/v1/reports/accounts.trial-balance/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { from: '2025-07-01', to: '2025-09-30', book: 'pf' } })
      .expect(200);
  });

  it('registers the fund’s deposits, fixed deposits and the TDS rules', async () => {
    await create('pf-deposits', { year: 2025, month: 9, amount: 3_600, chequeNo: 'CHQ-1', depositedOn: '2025-10-05' });
    const twice = await request(http)
      .post('/api/v1/accounts/pf-deposits')
      .set(bearer(accountant))
      .send({ year: 2025, month: 9, amount: 1 })
      .expect(409);
    expect(twice.body.code).toBe('pf_deposit_exists');
    const deposits = await request(http).get('/api/v1/accounts/pf-deposits?year=2025').set(bearer(accountant));
    expect(deposits.body).toMatchObject([{ month: 9, amount: 3_600, chequeNo: 'CHQ-1' }]);

    const fdr = await create('pf-fixed-deposits', {
      fdrNo: 'fdr-001',
      bankName: 'Sonali Bank',
      amount: 500_000,
      interestRatePercent: 9.5,
      openedOn: '2025-01-01',
      maturesOn: '2026-01-01',
    });
    const sameNo = await request(http)
      .post('/api/v1/accounts/pf-fixed-deposits')
      .set(bearer(accountant))
      .send({ fdrNo: 'FDR-001', bankName: 'Other', amount: 1, openedOn: '2025-01-01', maturesOn: '2025-06-01' })
      .expect(409);
    expect(sameNo.body.code).toBe('pf_fixed_deposit_exists');
    await request(http)
      .post('/api/v1/accounts/pf-fixed-deposits')
      .set(bearer(accountant))
      .send({ fdrNo: 'FDR-002', bankName: 'Other', amount: 1, openedOn: '2025-06-01', maturesOn: '2025-01-01' })
      .expect(400);
    await request(http)
      .patch(`/api/v1/accounts/pf-fixed-deposits/${fdr}`)
      .set(bearer(accountant))
      .send({ withdrawnOn: '2026-01-02' })
      .expect(422);
    await request(http)
      .patch(`/api/v1/accounts/pf-fixed-deposits/${fdr}`)
      .set(bearer(accountant))
      .send({ withdrawnOn: '2026-01-02', withdrawnAmount: 547_500 })
      .expect(200);

    await create('tds-rules', { section: '52', description: 'Supply of goods', category: 'Supplier', ratePercent: 5 });
    await create('tds-rules', { description: 'Professional fees', category: 'Consultant', ratePercent: 10 });
    const rules = await request(http).get('/api/v1/accounts/tds-rules?category=Supplier').set(bearer(accountant));
    expect(rules.body).toMatchObject([{ section: '52', ratePercent: 5, effectiveFrom: null }]);
    await request(http)
      .post('/api/v1/accounts/tds-rules')
      .set(bearer(accountant))
      .send({ description: 'Too much', category: 'X', ratePercent: 101 })
      .expect(400);
    await request(http).get('/api/v1/accounts/tds-rules').set(bearer(plain)).expect(403);
  });
});

describe('budgets', () => {
  it("keeps each income and expense account's budget for the year, against what was posted", async () => {
    const years = await request(http).get('/api/v1/accounts/fiscal-years').set(bearer(accountant)).expect(200);
    const year = (years.body as { id: string }[])[0]!.id;
    const budget = (lines: object[], token = accountant) =>
      request(http).put(`/api/v1/accounts/budgets/${year}`).set(bearer(token)).send({ lines });
    const view = (query = '') =>
      request(http).get(`/api/v1/accounts/budgets/${year}${query}`).set(bearer(accountant)).expect(200);

    const cash = await budget([{ glAccountId: gl.cash, amount: 1000 }]);
    expect([cash.status, cash.body.code]).toEqual([422, 'not_budgetable']);
    const twice = await budget([
      { glAccountId: gl.sales, amount: 1 },
      { glAccountId: gl.sales, amount: 2 },
    ]);
    expect([twice.status, twice.body.code]).toEqual([422, 'duplicate_account']);
    expect((await budget([], plain)).status).toBe(403);

    await budget([
      { glAccountId: gl.sales, amount: 120_000, note: 'Up a tenth on last year' },
      { glAccountId: gl.salary, amount: 60_000 },
    ]).expect(204);
    const sofar = await view('?to=2025-09-30');
    expect(sofar.body.lines).toEqual([
      expect.objectContaining({
        code: '4001',
        side: 'income',
        budget: 120_000,
        actual: 30_000,
        variance: -90_000,
        usedPercent: 25,
        note: 'Up a tenth on last year',
      }),
      expect.objectContaining({ code: '5001', side: 'expense', budget: 60_000, actual: 15_000, usedPercent: 25 }),
    ]);
    expect(sofar.body).toMatchObject({
      to: '2025-09-30',
      income: { budget: 120_000, actual: 30_000 },
      expense: { budget: 60_000, actual: 15_000 },
      profit: { budget: 60_000, actual: 15_000 },
    });
    expect((await view()).body.to).toBe('2026-06-30');
    const outside = await request(http).get(`/api/v1/accounts/budgets/${year}?to=2026-07-01`).set(bearer(accountant));
    expect([outside.status, outside.body.code]).toEqual([422, 'invalid_period']);

    for (const format of ['pdf', 'xlsx']) {
      await request(http)
        .post('/api/v1/reports/accounts.budget-vs-actual/render')
        .set(bearer(admin))
        .send({ format, params: { fiscalYearId: year, to: '2025-09-30' } })
        .expect(200);
    }

    // The whole budget is replaced: what is left shows what was posted, with no budget.
    await budget([]).expect(204);
    expect((await view()).body.lines).toEqual([
      expect.objectContaining({ code: '4001', budgeted: false, budget: 0, usedPercent: null }),
      expect.objectContaining({ code: '5001', budgeted: false, actual: 15_000 }),
    ]);
  });
});
