import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let seller: string;
let outdoor: string;
let indoor: string;
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
const napaAt = async (outletId: string) =>
  ((await ph('get', `stock?outletId=${outletId}&productId=${napa}`, admin).expect(200)).body.items[0]?.qty as
    number | undefined) ?? 0;

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
  for (const [key, nature, balance, code, name, role] of [
    ['inventory', '1', 'debit', '1350', 'Medicine inventory', 'pharmacy_inventory'],
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['card', '1', 'debit', '1002', 'Card receipts', 'card_receipts'],
    ['receivable', '1', 'debit', '1201', 'Pharmacy receivable', 'pharmacy_receivable'],
    ['sales', '4', 'credit', '4101', 'Medicine sales', 'pharmacy_sales'],
    ['cogs', '5', 'debit', '5101', 'Cost of medicines sold', 'pharmacy_cogs'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role, glAccountId: gl[key] });
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
  // Seclo is never discounted; everything else takes the policy's 5 %.
  await create('pharmacy/product-discounts', { productId: seclo, isAllowed: false });
  outdoor = await create('pharmacy/outlets', { name: 'Outdoor pharmacy' });
  indoor = await create('pharmacy/outlets', { name: 'Indoor pharmacy' });
  await create('pharmacy/outlet-users', { outletId: outdoor, userId: created.body.id });
  await create('pharmacy/opening-stock', {
    outletId: outdoor,
    openedOn: '2026-01-01',
    lines: [
      { productId: napa, qty: 50, unitCost: 0.8, saleRate: 1.2, batchNo: 'A', expiryDate: '2026-03-31' },
      { productId: napa, qty: 100, unitCost: 0.85, saleRate: 1.2, batchNo: 'B', expiryDate: '2026-12-31' },
      { productId: seclo, qty: 20, unitCost: 4, saleRate: 6, batchNo: 'S', expiryDate: '2027-06-30' },
    ],
  });
});

const sale = (lines: { productId: string; qty: number }[], extra: Record<string, unknown> = {}, token = seller) =>
  ph('post', 'sales', token, { outletId: outdoor, soldOn: '2026-04-10', lines, tendered: 0, ...extra });

describe('pharmacy counter sales', () => {
  it('sells first expiring unexpired lots at their sale rate less the discount, paid in cash with change', async () => {
    expect((await ph('get', 'discount-policy', seller).expect(200)).body).toEqual({
      allowedByDefault: true,
      opdPercent: 5,
      ipdPercent: null,
    });
    expect(
      (await ph('put', 'discount-policy', seller, { allowedByDefault: true, opdPercent: 5, ipdPercent: 3 })).status,
    ).toBe(403);
    await ph('put', 'discount-policy', admin, { allowedByDefault: true, opdPercent: 5, ipdPercent: 3 }).expect(204);

    const short = await ph('post', 'sales/quote', seller, {
      outletId: outdoor,
      on: '2026-04-10',
      lines: [{ productId: napa, qty: 101 }],
    });
    // Lot A has expired: only lot B's 100 can be sold.
    expect([short.status, short.body.code]).toEqual([422, 'insufficient_stock']);
    const quote = await ph('post', 'sales/quote', seller, {
      outletId: outdoor,
      on: '2026-04-10',
      lines: [
        { productId: napa, qty: 60 },
        { productId: seclo, qty: 2 },
      ],
    }).expect(200);
    expect(quote.body).toMatchObject({ amount: 84, discount: 3.6, total: 80.4 });
    expect(
      quote.body.lines.map((line: { displayName: string; batchNo: string; discount: number }) => [
        line.displayName,
        line.batchNo,
        line.discount,
      ]),
    ).toEqual([
      ['Tab. Napa', 'B', 3.6],
      ['Tab. Seclo', 'S', 0],
    ]);
    expect(await napaAt(outdoor)).toBe(150);

    const lines = [
      { productId: napa, qty: 60 },
      { productId: seclo, qty: 2 },
    ];
    expect((await sale(lines, { tendered: 50 })).body.code).toBe('due_needs_member');
    expect((await sale(lines, { tendered: 100, method: 'card' })).body.code).toBe('overpaid');
    expect((await sale(lines, { tendered: 100, outletId: indoor })).body.code).toBe('no_outlet_access');
    const sold = await sale(lines, { tendered: 100, customerName: 'Rahim', mobileNo: '01711000000' }).expect(201);
    expect(sold.body).toMatchObject({ number: 'SI-2026-00001', total: 80.4, change: 19.6, due: 0 });
    expect(await napaAt(outdoor)).toBe(90);
    expect(await closing('cash')).toBe(80.4);
    expect(await closing('sales')).toBe(-80.4);
    // 60 × 0.85 + 2 × 4 at cost.
    expect(await closing('cogs')).toBe(59);
    expect(await closing('inventory')).toBe(-59);

    const view = await ph('get', `sales/${sold.body.id}`, seller).expect(200);
    expect(view.body).toMatchObject({
      customerName: 'Rahim',
      tendered: 100,
      paid: 80.4,
      change: 19.6,
      status: 'completed',
    });
    expect((await ph('get', `sales?outletId=${outdoor}&q=0171`, seller).expect(200)).body.total).toBe(1);
    await request(http)
      .post('/api/v1/reports/pharmacy.sale-receipt/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: sold.body.id } })
      .expect(200);
  });

  it('leaves dues for loyal members, collects them oldest first and cancels a sale nothing was collected on', async () => {
    const member = await create('pharmacy/loyal-members', { name: 'Karim', contactNo: '01811000000' });
    // 12 less 5 % = 11.40, 5 paid; 6 less 5 % = 5.70, nothing paid.
    const first = await sale([{ productId: napa, qty: 10 }], { loyalMemberId: member, tendered: 5 }).expect(201);
    expect(first.body.due).toBe(6.4);
    await sale([{ productId: napa, qty: 5 }], { loyalMemberId: member, soldOn: '2026-04-11' }).expect(201);
    expect((await ph('get', `loyal-members/${member}/dues`, seller).expect(200)).body).toMatchObject({ due: 12.1 });
    expect(await closing('receivable')).toBe(12.1);

    const collect = (amount: number) =>
      ph('post', `loyal-members/${member}/collections`, seller, { collectedOn: '2026-04-15', amount });
    expect((await collect(12.11)).body.code).toBe('overpayment');
    expect((await collect(8).expect(201)).body.number).toBe('DC-2026-00001');
    const dues = await ph('get', `loyal-members/${member}/dues`, seller).expect(200);
    expect(dues.body).toMatchObject({ due: 4.1, sales: [{ number: 'SI-2026-00002', due: 5.7, collected: 1.6 }] });
    expect(await closing('receivable')).toBe(4.1);
    expect(await closing('cash')).toBe(13);

    const second = (await ph('get', `sales?loyalMemberId=${member}`, seller).expect(200)).body.items.find(
      (item: { number: string }) => item.number === 'SI-2026-00002',
    );
    expect(
      (await ph('post', `sales/${second.id}/cancel`, admin, { version: second.version, on: '2026-04-15', reason: 'x' }))
        .body.code,
    ).toBe('sale_state');

    const third = await sale([{ productId: napa, qty: 20 }], { tendered: 22.8 }).expect(201);
    // 150 on hand (50 of them in the expired lot A) less 10, 5 and 20 sold.
    expect(await napaAt(outdoor)).toBe(115);
    expect(
      (await ph('post', `sales/${third.body.id}/cancel`, seller, { version: 1, on: '2026-04-10', reason: 'x' })).status,
    ).toBe(403);
    await ph('post', `sales/${third.body.id}/cancel`, admin, {
      version: 1,
      on: '2026-04-10',
      reason: 'Wrong patient',
    }).expect(204);
    expect(await napaAt(outdoor)).toBe(135);
    expect(await closing('cash')).toBe(13);
    expect((await ph('get', `sales/${third.body.id}`, seller).expect(200)).body).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Wrong patient',
    });
    await request(http)
      .post('/api/v1/reports/pharmacy.member-dues/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { loyalMemberId: member } })
      .expect(200);
  });
});
