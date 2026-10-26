import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let seller: string;
let outdoor: string;
let supplier: string;
let napa: string;
let seclo: string;
const gl: Record<string, string> = {};

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// Expiry is judged against today, so the lots are dated from it.
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const inDays = (days: number) => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

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

async function glAccount(nature: string, normalBalance: string, code: string, name: string, extra = {}) {
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
  return create('accounts/gl-accounts', { level5HeadId: head5, code, name, ...extra });
}

function binary(response: request.Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

const ph = (method: 'get' | 'post' | 'put', path: string, token: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/pharmacy/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};

/** The report's rows as arrays of cell values, with the PDF rendered too. */
async function sheet(key: string, params: Record<string, unknown>): Promise<unknown[][]> {
  await request(http)
    .post(`/api/v1/reports/${key}/render`)
    .set(bearer(admin))
    .send({ format: 'pdf', params })
    .expect(200);
  const result = await request(http)
    .post(`/api/v1/reports/${key}/render`)
    .set(bearer(admin))
    .send({ format: 'xlsx', params })
    .buffer(true)
    .parse(binary);
  expect(result.status, `${key}: ${result.body?.toString?.().slice(0, 300)}`).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(result.body as Buffer).buffer);
  return (workbook.worksheets[0]!.getSheetValues() as unknown[][]).filter(Boolean).map((row) =>
    Array.from(row)
      .slice(1)
      .map((value) => (value instanceof Date ? value.toISOString().slice(0, 10) : (value ?? null))),
  );
}
const rowOf = (rows: unknown[][], ...first: unknown[]) =>
  rows.find((row) => first.every((value, index) => row[index] === value));

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
    .send({ email: 'seller@example.com', password: PASSWORD, displayName: 'Seller Sumi' })
    .expect(201);
  const role = await create('roles', {
    name: 'sellers',
    permissions: ['pharmacy:read', 'pharmacy:sell', 'pharmacy:count'],
  });
  await request(http)
    .post(`/api/v1/users/${created.body.id}/roles`)
    .set(bearer(admin))
    .send({ roleId: role })
    .expect(204);
  seller = await login('seller@example.com', PASSWORD);

  await create('accounts/fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, glRole, extra] of [
    ['inventory', '1', 'debit', '1350', 'Medicine inventory', 'pharmacy_inventory', {}],
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand', {}],
    ['card', '1', 'debit', '1002', 'Card receipts', 'card_receipts', {}],
    ['receivable', '1', 'debit', '1201', 'Pharmacy receivable', 'pharmacy_receivable', {}],
    ['payable', '2', 'credit', '2101', 'Payable to suppliers', 'supplier_payable', { isControlAccount: true }],
    ['sales', '4', 'credit', '4101', 'Medicine sales', 'pharmacy_sales', {}],
    ['gain', '4', 'credit', '4102', 'Stock count gain', 'pharmacy_count_gain', {}],
    ['cogs', '5', 'debit', '5101', 'Cost of medicines sold', 'pharmacy_cogs', {}],
    ['discount', '5', 'debit', '5102', 'Sales discount', 'pharmacy_sales_discount', {}],
    ['damage', '5', 'debit', '5103', 'Expired and damaged medicines', 'pharmacy_damage_loss', {}],
    ['loss', '5', 'debit', '5104', 'Stock count loss', 'pharmacy_count_loss', {}],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name, extra);
    await create('accounts/gl-roles', { role: glRole, glAccountId: gl[key] });
  }
  const partyType = await create('accounts/sub-ledger-types', { name: 'Suppliers' });
  const party = await create('accounts/sub-ledgers', { typeId: partyType, name: 'Beximco Pharma' });
  const local = await create('scm/supplier-types', { name: 'Local' });
  supplier = await create('scm/suppliers', { typeId: local, name: 'Beximco Pharma', subLedgerId: party });

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
  await ph('put', 'discount-policy', admin, { allowedByDefault: true, opdPercent: 5, ipdPercent: 3 }).expect(204);
  await create('pharmacy/product-discounts', { productId: seclo, isAllowed: false });
  await ph('put', 'return-policies/opd', admin, { isEnabled: true, days: 7 }).expect(204);
  outdoor = await create('pharmacy/outlets', { name: 'Outdoor pharmacy' });
  await create('pharmacy/outlet-users', { outletId: outdoor, userId: created.body.id });
  await create('pharmacy/opening-stock', {
    outletId: outdoor,
    openedOn: '2026-01-01',
    lines: [{ productId: napa, qty: 10, unitCost: 0.7, saleRate: 1.2, batchNo: 'X', expiryDate: '2026-03-31' }],
  });
});

/** April 2026 at the outdoor pharmacy. */
async function april() {
  const receive = await ph('post', 'receives', admin, {
    outletId: outdoor,
    supplierId: supplier,
    receivedOn: '2026-04-01',
    supplierInvoiceNo: 'BX-1',
    lines: [
      { productId: napa, qty: 100, purchaseRate: 0.8, saleRate: 1.2, batchNo: 'A', expiryDate: inDays(20) },
      { productId: seclo, qty: 50, purchaseRate: 4, saleRate: 6, batchNo: 'S', expiryDate: inDays(400) },
    ],
  }).expect(201);
  await ph('post', `receives/${receive.body.id}/post`, admin, { version: 1 }).expect(200);
  await ph('post', 'supplier-payments', admin, {
    supplierId: supplier,
    paidOn: '2026-04-05',
    method: 'cash',
    lines: [{ receiveId: receive.body.id, amount: 100 }],
  }).expect(201);

  const sell = (token: string, lines: { productId: string; qty: number }[], extra: Record<string, unknown>) =>
    ph('post', 'sales', token, { outletId: outdoor, soldOn: '2026-04-10', lines, ...extra }).expect(201);
  // 12 less 5 % = 11.40 in cash; 12 by card (Seclo is not discounted).
  const first = await sell(seller, [{ productId: napa, qty: 10 }], { tendered: 20 });
  await sell(seller, [{ productId: seclo, qty: 2 }], { method: 'card', reference: 'VISA 4411', tendered: 12 });
  // A loyal member pays 5 of 11.40 and pays the rest on the 15th.
  const member = await create('pharmacy/loyal-members', { name: 'Karim', contactNo: '01811000000' });
  await sell(seller, [{ productId: napa, qty: 10 }], { loyalMemberId: member, tendered: 5 });
  await ph('post', `loyal-members/${member}/collections`, seller, {
    collectedOn: '2026-04-15',
    amount: 6.4,
    method: 'cash',
  }).expect(201);
  // The manager sells 5 Napa for 5.70 and cancels it the next day.
  const own = await sell(admin, [{ productId: napa, qty: 5 }], { tendered: 10 });
  await ph('post', `sales/${own.body.id}/cancel`, admin, {
    version: 1,
    on: '2026-04-11',
    reason: 'Wrong patient',
  }).expect(204);
  // Two Napa of the first sale come back on the 12th: 2.28 in cash.
  await ph('post', `sales/${first.body.id}/returns`, seller, {
    version: 1,
    returnedOn: '2026-04-12',
    reason: 'Not needed',
    lines: [{ line: 1, qty: 2 }],
  }).expect(201);
}

const april26 = { from: '2026-04-01', to: '2026-04-30' };

describe('pharmacy reports', () => {
  it('shows stock: product ledger, movement by kind, expired and expiring lots', async () => {
    await april();

    const ledger = await sheet('pharmacy.product-ledger', { outletId: outdoor, productId: napa, ...april26 });
    expect(ledger.find((row) => row[2] === 'Opening stock')?.[7]).toBe(10);
    // Opening 10 + 100 received − 10 − 10 − 5 sold + 5 cancelled + 2 returned.
    expect(ledger.at(-1)).toEqual(expect.arrayContaining(['Returned by customer', 'A', 2, 92]));
    expect(ledger.filter((row) => row[2] === 'Sold').map((row) => row[6])).toEqual([10, 10, 5]);
    expect(ledger.some((row) => row[2] === 'Sale cancelled' && row[5] === 5)).toBe(true);

    const movement = await sheet('pharmacy.stock-movement', { outletId: outdoor, ...april26 });
    // Opening, purchased, transfer in, customer returns, count +, sold, transfer out, supplier returns, count −,
    // closing, opening value, closing value.
    expect(rowOf(movement, 'Beximco', 'Tab. Napa')?.slice(2)).toEqual([10, 100, 0, 7, 0, 25, 0, 0, 0, 92, 7, 72.6]);
    expect(rowOf(movement, 'Beximco', 'Tab. Seclo')?.slice(2)).toEqual([0, 50, 0, 0, 0, 2, 0, 0, 0, 48, 0, 192]);

    const expiry = await sheet('pharmacy.expiry', { outletId: outdoor, days: 90 });
    expect(rowOf(expiry, 'Expired')).toEqual(
      expect.arrayContaining(['Outdoor pharmacy', 'Tab. Napa', 'X', '2026-03-31', 10, 7, 12]),
    );
    expect(rowOf(expiry, 'Expiring within 30 days')).toEqual(
      expect.arrayContaining(['Tab. Napa', 'A', inDays(20), 20, 82, 65.6, 98.4]),
    );
    expect(expiry.some((row) => row[2] === 'Tab. Seclo')).toBe(false);
  });

  it('shows trade: purchases per supplier, sales with returns and margin, and each counter', async () => {
    await april();

    const purchases = await sheet('pharmacy.purchase-summary', { ...april26, detail: true });
    expect(rowOf(purchases, 'Beximco Pharma', '2026-04-01')).toEqual(
      expect.arrayContaining(['GR-2026-00001', 'BX-1', 280, 100, 180]),
    );
    expect(rowOf(purchases, 'Beximco Pharma', null)).toEqual(expect.arrayContaining([1, 280, 100, 180, 0]));

    // Bills, units, gross, discount, net, units and value returned or cancelled, net sales, cost, margin, margin %.
    const byDay = await sheet('pharmacy.sales-summary', april26);
    // The cancelled sale stays on the 10th and comes off on the 11th, so the 10th never changes.
    expect(rowOf(byDay, '2026-04-10')?.slice(1)).toEqual([4, 27, 42, 1.5, 40.5, 0, 0, 40.5, 28, 12.5, 30.86]);
    // No margin % on a day of cancellations or returns alone (the empty last cell is not in the row).
    expect(rowOf(byDay, '2026-04-11')?.slice(1)).toEqual([0, 0, 0, 0, 0, 5, 5.7, -5.7, -4, -1.7]);
    expect(rowOf(byDay, '2026-04-12')?.slice(1)).toEqual([0, 0, 0, 0, 0, 2, 2.28, -2.28, -1.6, -0.68]);
    const tenth = await sheet('pharmacy.sales-summary', { from: '2026-04-10', to: '2026-04-10' });
    expect(rowOf(tenth, '2026-04-10')?.[5]).toBe(40.5);
    const byProduct = await sheet('pharmacy.sales-summary', { ...april26, by: 'product' });
    expect(rowOf(byProduct, 'Tab. Napa')?.slice(1)).toEqual([3, 25, 30, 1.5, 28.5, 7, 7.98, 20.52, 14.4, 6.12, 29.82]);
    expect(rowOf(byProduct, 'Tab. Seclo')?.slice(1)).toEqual([1, 2, 12, 0, 12, 0, 0, 12, 8, 4, 33.33]);
    const bySeller = await sheet('pharmacy.sales-summary', { ...april26, by: 'seller' });
    expect(rowOf(bySeller, 'Seller Sumi')?.[8]).toBe(32.52);

    // Bills, sales value, discount, due given, then cash/card/mobile/total for sales, collections, returns,
    // cancellations and the net.
    const counter = await sheet('pharmacy.cash-counter', april26);
    expect(rowOf(counter, 'Seller Sumi')?.slice(1)).toEqual([
      3, 34.8, 1.2, 6.4, 16.4, 12, 0, 28.4, 6.4, 0, 0, 6.4, -2.28, 0, 0, -2.28, 0, 0, 0, 0, 20.52, 12, 0, 32.52,
    ]);
    // The manager took 5.70 and paid it back on cancelling.
    expect(rowOf(counter, 'Root')?.slice(1, 5)).toEqual([1, 5.7, 0.3, 0]);
    expect(rowOf(counter, 'Root')?.slice(-4)).toEqual([0, 0, 0, 0]);
    expect(rowOf(counter, 'Total')?.slice(-4)).toEqual([20.52, 12, 0, 32.52]);
  });

  it('sums up applied stock counts side by side', async () => {
    await april();
    const opened = await ph('post', 'stock-counts', seller, { outletId: outdoor, countDate: '2026-04-30' }).expect(201);
    const lines = (await ph('get', `stock-counts/${opened.body.id}`, seller).expect(200)).body.lines as {
      lotId: string;
      batchNo: string;
    }[];
    const lot = (batch: string) => lines.find((line) => line.batchNo === batch)!.lotId;
    await ph('post', `stock-counts/${opened.body.id}/counts`, seller, {
      version: 1,
      counts: [
        { lotId: lot('X'), qty: 0, writeOff: true },
        { lotId: lot('A'), qty: 80 },
        { lotId: lot('S'), qty: 48 },
      ],
    }).expect(204);
    const early = await request(http)
      .post('/api/v1/reports/pharmacy.physical-inventory/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { countIds: [opened.body.id] } });
    expect([early.status, early.body.code]).toEqual([422, 'stock_count_state']);
    await ph('post', `stock-counts/${opened.body.id}/apply`, admin, { version: 2 }).expect(200);

    const summary = await sheet('pharmacy.physical-inventory', { countIds: [opened.body.id] });
    // Items, value, % of the 264.60 held at cost.
    expect(rowOf(summary, 'Lots counted')?.[1]).toBe(3);
    expect(rowOf(summary, 'Products counted')?.[1]).toBe(2);
    expect(rowOf(summary, 'Stock held at cost (ledger)')?.[2]).toBe(264.6);
    expect(rowOf(summary, 'Equal')?.slice(1, 3)).toEqual([1, 192]);
    expect(rowOf(summary, 'Short (count loss)')?.slice(1)).toEqual([1, -1.6, 0.6]);
    expect(rowOf(summary, 'Written off, expired or damaged')?.slice(1)).toEqual([1, -7, 2.65]);
    expect(rowOf(summary, 'Net deviation')?.slice(2)).toEqual([-8.6, -3.25]);
  });
});
