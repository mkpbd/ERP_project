import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let counter: string;
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

function binary(response: request.Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

const ph = (method: 'get' | 'post', path: string, token: string, body?: Record<string, unknown>) => {
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
const lotsOf = async (productId: string) =>
  (
    (await ph('get', `stock?outletId=${outdoor}&productId=${productId}`, admin).expect(200)).body.items[0]?.lots ?? []
  ).map((lot: { batchNo: string; qty: number }) => [lot.batchNo, lot.qty]);

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
    .send({ email: 'counter@example.com', password: PASSWORD, displayName: 'Counter' })
    .expect(201);
  const role = await create('roles', { name: 'counters', permissions: ['pharmacy:read', 'pharmacy:count'] });
  await request(http)
    .post(`/api/v1/users/${created.body.id}/roles`)
    .set(bearer(admin))
    .send({ roleId: role })
    .expect(204);
  counter = await login('counter@example.com', PASSWORD);

  await create('accounts/fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, glRole] of [
    ['inventory', '1', 'debit', '1350', 'Medicine inventory', 'pharmacy_inventory'],
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['sales', '4', 'credit', '4101', 'Medicine sales', 'pharmacy_sales'],
    ['gain', '4', 'credit', '4102', 'Stock count gain', 'pharmacy_count_gain'],
    ['discount', '5', 'debit', '5102', 'Sales discount', 'pharmacy_sales_discount'],
    ['cogs', '5', 'debit', '5101', 'Cost of medicines sold', 'pharmacy_cogs'],
    ['loss', '5', 'debit', '5104', 'Stock count loss', 'pharmacy_count_loss'],
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
  outdoor = await create('pharmacy/outlets', { name: 'Outdoor pharmacy' });
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

describe('pharmacy stock counts', () => {
  it('counts lot by lot and applies against the ledger as of the count date at apply time', async () => {
    const opened = await ph('post', 'stock-counts', counter, { outletId: outdoor, countDate: '2026-04-30' }).expect(
      201,
    );
    expect(opened.body).toMatchObject({ number: 'SC-2026-00001', lines: 3 });
    const view = async () => (await ph('get', `stock-counts/${opened.body.id}`, counter).expect(200)).body;
    const lotOf = async (batch: string) =>
      ((await view()).lines as { batchNo: string; lotId: string }[]).find((line) => line.batchNo === batch)!.lotId;
    const [a, b, s] = [await lotOf('A'), await lotOf('B'), await lotOf('S')];
    expect(
      (await view()).lines.map((line: { batchNo: string; systemQty: number; expired: boolean }) => [
        line.batchNo,
        line.systemQty,
        line.expired,
      ]),
    ).toEqual([
      ['A', 50, true],
      ['B', 100, false],
      ['S', 20, false],
    ]);

    await ph('post', `stock-counts/${opened.body.id}/counts`, counter, {
      version: 1,
      counts: [
        { lotId: b, qty: 95 },
        { lotId: s, qty: 20 },
      ],
    }).expect(204);
    const early = await ph('post', `stock-counts/${opened.body.id}/apply`, admin, { version: 2 });
    expect([early.status, early.body.code]).toEqual([422, 'uncounted_lines']);
    await ph('post', `stock-counts/${opened.body.id}/counts`, counter, {
      version: 2,
      counts: [{ lotId: a, qty: 0, note: 'Expired, sent for disposal' }],
    }).expect(204);
    // A lot on the shelf the ledger never had.
    const found = await ph('post', `stock-counts/${opened.body.id}/lots`, counter, {
      version: 3,
      productId: napa,
      batchNo: 'C',
      expiryDate: '2027-03-31',
      saleRate: 1.2,
      countedQty: 10,
    });
    expect(found.body.code).toBe('cost_needed');
    await ph('post', `stock-counts/${opened.body.id}/lots`, counter, {
      version: 3,
      productId: napa,
      batchNo: 'C',
      expiryDate: '2027-03-31',
      saleRate: 1.2,
      unitCost: 0.9,
      countedQty: 10,
    }).expect(204);

    // Three Napa sold, dated before the count date, entered after the count was opened.
    await ph('post', 'sales', admin, {
      outletId: outdoor,
      soldOn: '2026-04-20',
      lines: [{ productId: napa, qty: 3 }],
      tendered: 10,
    }).expect(201);

    expect((await ph('post', `stock-counts/${opened.body.id}/apply`, counter, { version: 4 })).status).toBe(403);
    const applied = await ph('post', `stock-counts/${opened.body.id}/apply`, admin, { version: 4 }).expect(200);
    // Lot B: 95 counted against 97 held then (not the 100 it was opened with): 2 short at 0.85; lot A 50 at 0.80
    // short; lot C 10 over at 0.90.
    expect(applied.body).toMatchObject({ shortage: 41.7, excess: 9, voucherNumber: expect.stringMatching(/^JV-/) });
    expect(await lotsOf(napa)).toEqual([
      ['B', 95],
      ['C', 10],
    ]);
    expect(await lotsOf(seclo)).toEqual([['S', 20]]);
    expect(await closing('loss')).toBe(41.7);
    expect(await closing('gain')).toBe(-9);
    expect((await ph('post', `stock-counts/${opened.body.id}/apply`, admin, { version: 5 })).body.code).toBe(
      'stock_count_state',
    );

    const result = await request(http)
      .post('/api/v1/reports/pharmacy.count-result/render')
      .set(bearer(admin))
      .send({ format: 'xlsx', params: { id: opened.body.id, differencesOnly: true } })
      .buffer(true)
      .parse(binary)
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(result.body as Buffer).buffer);
    const values = workbook.worksheets[0]!.getSheetValues().flat();
    expect(values).toContain(-2);
    expect(values).toContain(-50);
    expect(values).toContain(10);
    for (const key of ['pharmacy.count-sheet', 'pharmacy.count-result']) {
      await request(http)
        .post(`/api/v1/reports/${key}/render`)
        .set(bearer(admin))
        .send({ format: 'pdf', params: { id: opened.body.id } })
        .expect(200);
    }
  });

  it('counts some products only, is not applied by who opened it, and is cancelled with a reason', async () => {
    const opened = await ph('post', 'stock-counts', admin, {
      outletId: outdoor,
      countDate: '2026-04-30',
      productIds: [seclo],
    }).expect(201);
    expect(opened.body.lines).toBe(1);
    const lot = (await ph('get', `stock-counts/${opened.body.id}`, admin).expect(200)).body.lines[0].lotId;
    await ph('post', `stock-counts/${opened.body.id}/counts`, admin, {
      version: 1,
      counts: [{ lotId: lot, qty: 18 }],
    }).expect(204);
    const own = await ph('post', `stock-counts/${opened.body.id}/apply`, admin, { version: 2 });
    expect([own.status, own.body.code]).toEqual([403, 'self_approval']);
    await ph('post', `stock-counts/${opened.body.id}/cancel`, admin, { version: 2, reason: 'Recount tomorrow' }).expect(
      204,
    );
    expect((await ph('get', `stock-counts?outletId=${outdoor}&status=cancelled`, counter).expect(200)).body.total).toBe(
      1,
    );
    expect(await lotsOf(seclo)).toEqual([['S', 20]]);
  });
});
