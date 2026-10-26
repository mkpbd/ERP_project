import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let seller: string;
let outdoor: string;
let napa: string;
let seclo: string;
const gl: Record<string, string> = {};

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

async function create(path: string, body: Record<string, unknown>, token = admin): Promise<string> {
  const response = await request(http).post(`/api/v1/${path}`).set(bearer(token)).send(body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
  return response.body.id as string;
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

const ph = (method: 'get' | 'post' | 'put', path: string, token: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/pharmacy/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const closing = async (account: string) =>
  (
    await request(http)
      .get(`/api/v1/accounts/books/ledger?glAccountId=${gl[account]}&from=2026-01-01&to=2026-06-30`)
      .set(bearer(admin))
      .expect(200)
  ).body.closing as number;
const napaStock = async () =>
  (await ph('get', `stock?outletId=${outdoor}&productId=${napa}`, admin).expect(200)).body.items[0].qty as number;

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: 'seller@example.com', password: PASSWORD, displayName: 'Seller' })
    .expect(201);
  const role = await create('roles', { name: 'sellers', permissions: ['pharmacy:read', 'pharmacy:sell'] });
  await request(http)
    .post(`/api/v1/users/${created.body.id}/roles`)
    .set(bearer(admin))
    .send({ roleId: role })
    .expect(204);
  seller = await login('seller@example.com', PASSWORD);

  await create('accounts/fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, glRole] of [
    ['inventory', '1', 'debit', '1350', 'Medicine inventory', 'pharmacy_inventory'],
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['receivable', '1', 'debit', '1201', 'Pharmacy receivable', 'pharmacy_receivable'],
    ['sales', '4', 'credit', '4101', 'Medicine sales', 'pharmacy_sales'],
    ['discount', '5', 'debit', '5102', 'Sales discount', 'pharmacy_sales_discount'],
    ['cogs', '5', 'debit', '5101', 'Cost of medicines sold', 'pharmacy_cogs'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role: glRole, glAccountId: gl[key] });
  }

  const maker = await create('pharmacy/manufacturers', { name: 'Beximco' });
  const tablet = await create('pharmacy/formations', { name: 'Tablet', shortName: 'Tab.' });
  napa = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Napa', manufacturerId: maker }),
    genericId: await create('pharmacy/generics', { name: 'Paracetamol' }),
    formationId: tablet,
  });
  seclo = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Seclo', manufacturerId: maker }),
    genericId: await create('pharmacy/generics', { name: 'Omeprazole' }),
    formationId: tablet,
  });
  await create('pharmacy/product-discounts', { productId: seclo, isAllowed: false });
  outdoor = await create('pharmacy/outlets', { name: 'Outdoor pharmacy' });
  await create('pharmacy/outlet-users', { outletId: outdoor, userId: created.body.id });
  await create('pharmacy/opening-stock', {
    outletId: outdoor,
    openedOn: '2026-01-01',
    lines: [
      { productId: napa, qty: 100, unitCost: 0.85, saleRate: 1.2, batchNo: 'B', expiryDate: '2026-12-31' },
      { productId: seclo, qty: 20, unitCost: 4, saleRate: 6, batchNo: 'S', expiryDate: '2027-06-30' },
    ],
  });
  await ph('put', 'return-policies/opd', admin, { isEnabled: true, days: 7 }).expect(204);
});

describe('pharmacy returns from customers', () => {
  it('takes medicines back within the period at what they were sold for, into the same lots', async () => {
    expect((await ph('get', 'return-policies', seller).expect(200)).body).toEqual({
      opd: { isEnabled: true, days: 7 },
      ipd: null,
    });
    // 12 less 5 % = 11.40 for 10 Napa; 18 for 3 Seclo, never discounted.
    const sold = await ph('post', 'sales', seller, {
      outletId: outdoor,
      soldOn: '2026-04-10',
      lines: [
        { productId: napa, qty: 10 },
        { productId: seclo, qty: 3 },
      ],
      tendered: 30,
    }).expect(201);
    expect(sold.body.total).toBe(29.4);
    expect(await napaStock()).toBe(90);

    const giveBack = (version: number, lines: { line: number; qty: number }[], returnedOn = '2026-04-12') =>
      ph('post', `sales/${sold.body.id}/returns`, seller, { version, returnedOn, reason: 'Not needed', lines });
    const late = await giveBack(1, [{ line: 1, qty: 1 }], '2026-04-20');
    expect([late.status, late.body.code]).toEqual([422, 'return_period_over']);
    const returned = await giveBack(1, [
      { line: 1, qty: 3 },
      { line: 2, qty: 1 },
    ]).expect(201);
    expect(returned.body).toMatchObject({ number: 'SR-2026-00001', refund: 9.42, dueReduced: 0, cashRefund: 9.42 });
    // The same return submitted again carries the old version.
    expect((await giveBack(1, [{ line: 1, qty: 3 }])).body.code).toBe('stale_sale');
    expect((await giveBack(2, [{ line: 2, qty: 3 }])).body.code).toBe('over_return');
    expect(await napaStock()).toBe(93);

    // Gross 30 less 9.60 back; discount 0.60 less 0.18 back; cash 29.40 less 9.42; cost 20.50 less 6.55.
    expect(await closing('sales')).toBe(-20.4);
    expect(await closing('discount')).toBe(0.42);
    expect(await closing('cash')).toBe(19.98);
    expect(await closing('cogs')).toBe(13.95);

    const sale = await ph('get', `sales/${sold.body.id}`, seller).expect(200);
    expect(sale.body).toMatchObject({ returned: 9.42, lines: [{ returnedQty: 3 }, { returnedQty: 1 }] });
    const cancel = await ph('post', `sales/${sold.body.id}/cancel`, admin, {
      version: sale.body.version,
      on: '2026-04-12',
      reason: 'x',
    });
    expect(cancel.body.code).toBe('sale_state');

    const view = await ph('get', `sale-returns/${returned.body.id}`, seller).expect(200);
    expect(view.body).toMatchObject({
      saleNumber: 'SI-2026-00001',
      amount: 9.6,
      discount: 0.18,
      lines: [
        { saleLine: 1, displayName: 'Tab. Napa', batchNo: 'B', qty: 3, refund: 3.42 },
        { saleLine: 2, displayName: 'Tab. Seclo', qty: 1, refund: 6 },
      ],
    });
    expect((await ph('get', `sale-returns?saleId=${sold.body.id}`, seller).expect(200)).body.total).toBe(1);
    await request(http)
      .post('/api/v1/reports/pharmacy.return-receipt/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: returned.body.id } })
      .expect(200);
  });

  it("takes a loyal member's due down before paying anything back", async () => {
    const member = await create('pharmacy/loyal-members', { name: 'Karim', contactNo: '01811000000' });
    const sold = await ph('post', 'sales', seller, {
      outletId: outdoor,
      soldOn: '2026-04-10',
      loyalMemberId: member,
      lines: [{ productId: napa, qty: 5 }],
      tendered: 0,
    }).expect(201);
    expect(sold.body.due).toBe(5.7);
    const returned = await ph('post', `sales/${sold.body.id}/returns`, seller, {
      version: 1,
      returnedOn: '2026-04-11',
      lines: [{ line: 1, qty: 2 }],
    }).expect(201);
    expect(returned.body).toMatchObject({ refund: 2.28, dueReduced: 2.28, cashRefund: 0 });
    expect((await ph('get', `loyal-members/${member}/dues`, seller).expect(200)).body.due).toBe(3.42);
    expect(await closing('receivable')).toBe(3.42);
    expect(await closing('cash')).toBe(0);
    const over = await ph('post', `loyal-members/${member}/collections`, seller, {
      collectedOn: '2026-04-12',
      amount: 3.43,
    });
    expect(over.body.code).toBe('overpayment');
  });
});
