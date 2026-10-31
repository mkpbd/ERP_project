import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let seller: string;
let accountant: string;
let outlet: string;
let napa: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

interface HeadView {
  key: string;
  unit: string;
  current: boolean;
  value: number;
  previous: number | null;
  dimensions: { key: string; label: string }[];
}
interface View {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  sections: { key: string; title: string; heads: HeadView[] }[];
}

async function login(identifier: string, password: string): Promise<string> {
  const response = await request(http)
    .post('/api/v1/auth/login')
    .set('X-Refresh-Token-Delivery', 'body')
    .send({ identifier, password })
    .expect(200);
  return response.body.accessToken as string;
}

async function create(path: string, body: Record<string, unknown>, token = admin): Promise<string> {
  const response = await request(http).post(`/api/v1/${path}`).set(bearer(token)).send(body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
  return response.body.id as string;
}

async function user(name: string, permissions: string[]): Promise<{ id: string; token: string }> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  const role = await create('roles', { name: `role-${name}`, permissions });
  await request(http)
    .post(`/api/v1/users/${created.body.id}/roles`)
    .set(bearer(admin))
    .send({ roleId: role })
    .expect(204);
  return { id: created.body.id as string, token: await login(`${name}@example.com`, PASSWORD) };
}

async function glAccount(nature: string, normalBalance: string, code: string, name: string) {
  const existing = await request(http).get('/api/v1/accounts/natures').set(bearer(admin));
  const natureId =
    (existing.body as { id: string; code: string }[]).find((entry) => entry.code === nature)?.id ??
    (await create('accounts/natures', {
      code: nature,
      name: `Nature ${nature}`,
      statement: ['4', '5'].includes(nature) ? 'profit_and_loss' : 'balance_sheet',
      normalBalance,
    }));
  const category = await create('accounts/categories', { natureId, code: `${code}C`, name: `${name} group` });
  const sub = await create('accounts/sub-categories', { categoryId: category, name: 'General' });
  const head4 = await create('accounts/level4-heads', { subCategoryId: sub, name: 'General' });
  const head5 = await create('accounts/level5-heads', { level4HeadId: head4, name: 'General' });
  return create('accounts/gl-accounts', { level5HeadId: head5, code, name });
}

const dashboard = async (token: string, query = '') =>
  (await request(http).get(`/api/v1/dashboard${query}`).set(bearer(token)).expect(200)).body as View;
const figure = (view: View, key: string) =>
  view.sections.flatMap((section) => section.heads).find((head) => head.key === key);
const split = (token: string, key: string, query: string) =>
  request(http).get(`/api/v1/dashboard/heads/${key}${query}`).set(bearer(token));

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  const counter = await user('seller', ['pharmacy:read', 'pharmacy:sell']);
  seller = counter.token;
  accountant = (await user('accountant', ['pharmacy:read', 'dashboard:finance'])).token;

  await create('accounts/fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [nature, balance, code, name, role] of [
    ['1', 'debit', '1350', 'Medicine inventory', 'pharmacy_inventory'],
    ['1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['1', 'debit', '1002', 'Card receipts', 'card_receipts'],
    ['1', 'debit', '1201', 'Pharmacy receivable', 'pharmacy_receivable'],
    ['4', 'credit', '4101', 'Medicine sales', 'pharmacy_sales'],
    ['5', 'debit', '5102', 'Sales discount', 'pharmacy_sales_discount'],
    ['5', 'debit', '5101', 'Cost of medicines sold', 'pharmacy_cogs'],
  ] as const) {
    await create('accounts/gl-roles', { role, glAccountId: await glAccount(nature, balance, code, name) });
  }
  const maker = await create('pharmacy/manufacturers', { name: 'Beximco' });
  napa = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Napa', manufacturerId: maker }),
    genericId: await create('pharmacy/generics', { name: 'Paracetamol' }),
    formationId: await create('pharmacy/formations', { name: 'Tablet', shortName: 'Tab.' }),
  });
  await create('pharmacy/product-discounts', { productId: napa, isAllowed: false });
  outlet = await create('pharmacy/outlets', { name: 'Outdoor pharmacy' });
  await create('pharmacy/outlet-users', { outletId: outlet, userId: counter.id });
  await create('pharmacy/opening-stock', {
    outletId: outlet,
    openedOn: '2026-01-01',
    lines: [{ productId: napa, qty: 100, unitCost: 6, saleRate: 10, batchNo: 'B', expiryDate: '2099-12-31' }],
  });
});

describe('dashboard', () => {
  it('works out every figure and every split of every section', async () => {
    const view = await dashboard(admin, '?from=2026-04-01&to=2026-04-30');
    expect(view.sections.map((section) => section.key)).toEqual([
      'money',
      'outpatients',
      'inpatients',
      'diagnostics',
      'laboratory',
      'pharmacy',
      'canteen',
      'staff',
    ]);
    expect([view.previousFrom, view.previousTo]).toEqual(['2026-03-02', '2026-03-31']);
    for (const head of view.sections.flatMap((section) => section.heads)) {
      expect(head.previous === null, head.key).toBe(head.current);
      for (const dimension of head.dimensions) {
        const response = await split(admin, head.key, `?from=2026-04-01&to=2026-04-30&by=${dimension.key}`);
        expect(response.status, `${head.key} by ${dimension.key}: ${JSON.stringify(response.body)}`).toBe(200);
      }
    }
  });

  it('shows each section to those who read its desk, and money only with dashboard:finance', async () => {
    // 30 tablets at 10, 300 paid in cash; 20 more the day before, by card.
    const sell = (soldOn: string, qty: number, method: string) =>
      request(http)
        .post('/api/v1/pharmacy/sales')
        .set(bearer(seller))
        .send({ outletId: outlet, soldOn, lines: [{ productId: napa, qty }], tendered: qty * 10, method })
        .expect(201);
    await sell('2026-04-10', 30, 'cash');
    await sell('2026-04-09', 20, 'card');

    const counter = await dashboard(seller, '?from=2026-04-10&to=2026-04-10');
    expect(counter.sections.map((section) => section.key)).toEqual(['pharmacy']);
    expect(counter.sections[0]!.heads.map((head) => head.key)).toEqual(['pharmacy.sales', 'pharmacy.expiring']);
    expect(figure(counter, 'pharmacy.sales')).toMatchObject({ value: 1, previous: 1 });
    const hidden = await split(seller, 'pharmacy.sold', '?from=2026-04-10');
    expect([hidden.status, hidden.body.code]).toEqual([404, 'dashboard_head_not_found']);

    const books = await dashboard(accountant, '?from=2026-04-09&to=2026-04-10');
    expect(books.sections.map((section) => section.key)).toEqual(['money', 'pharmacy']);
    expect(figure(books, 'money.received')).toMatchObject({ value: 500, previous: 0 });
    expect(figure(books, 'pharmacy.sold')).toMatchObject({ value: 500, unit: 'money' });
    expect(figure(books, 'pharmacy.stock-value')).toMatchObject({ value: 300, previous: null, current: true });
    const ways = await split(accountant, 'money.received', '?from=2026-04-09&to=2026-04-10&by=way').expect(200);
    expect(ways.body.rows).toEqual([
      { label: 'Cash', value: 300 },
      { label: 'Card', value: 200 },
    ]);
    const days = await split(accountant, 'money.received', '?from=2026-04-09&to=2026-04-10').expect(200);
    expect(days.body).toMatchObject({
      dimension: 'day',
      rows: [
        { label: '2026-04-09', value: 200 },
        { label: '2026-04-10', value: 300 },
      ],
    });
    const people = await split(accountant, 'pharmacy.sold', '?from=2026-04-09&to=2026-04-10&by=user').expect(200);
    expect(people.body.rows).toEqual([{ label: 'seller', value: 500 }]);
    const desks = await split(accountant, 'money.net', '?from=2026-04-09&to=2026-04-10&by=desk').expect(200);
    expect(desks.body.rows).toEqual([{ label: 'Pharmacy', value: 500 }]);
  });

  it('refuses days backwards or longer than a year, and splits it does not have', async () => {
    const backwards = await request(http).get('/api/v1/dashboard?from=2026-04-10&to=2026-04-01').set(bearer(admin));
    expect([backwards.status, backwards.body.code]).toEqual([422, 'invalid_period']);
    const long = await request(http).get('/api/v1/dashboard?from=2025-01-01&to=2026-04-01').set(bearer(admin));
    expect([long.status, long.body.code]).toEqual([422, 'period_too_long']);
    const unknown = await split(admin, 'pharmacy.nothing', '');
    expect(unknown.status).toBe(404);
    const by = await split(admin, 'pharmacy.stock-value', '?by=day');
    expect([by.status, by.body.code]).toEqual([422, 'invalid_dimension']);
    // No days asked: today, and the day before.
    const today = await dashboard(admin);
    expect(today.from).toBe(today.to);
    expect(today.previousTo < today.from).toBe(true);
  });
});
