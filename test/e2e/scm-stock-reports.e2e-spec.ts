import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let main: string;
let ward: string;
let icu: string;

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function create(path: string, body: Record<string, unknown>): Promise<string> {
  const response = await request(http).post(`/api/v1/${path}`).set(bearer(admin)).send(body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
  return response.body.id as string;
}

function binary(response: request.Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

/** The report's table as Excel gives it: one object per row, keyed by column header. */
async function table(key: string, params: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const response = await request(http)
    .post(`/api/v1/reports/${key}/render`)
    .set(bearer(admin))
    .send({ format: 'xlsx', params })
    .buffer(true)
    .parse(binary);
  expect(response.status, String(response.body).slice(0, 300)).toBe(200);
  const pdf = await request(http)
    .post(`/api/v1/reports/${key}/render`)
    .set(bearer(admin))
    .send({ format: 'pdf', params });
  expect(pdf.status).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(response.body as Buffer).buffer);
  const rows: unknown[][] = [];
  workbook.worksheets[0]!.eachRow((row) => rows.push((row.values as unknown[]).slice(1)));
  // The banner rows are merged across the columns (one repeated value); the header row has distinct names.
  const headerAt = rows.findIndex((row) => new Set(row).size > 2 && row.every((cell) => typeof cell === 'string'));
  const headers = rows[headerAt] as string[];
  return rows
    .slice(headerAt + 1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? null])));
}

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = (
    await request(http)
      .post('/api/v1/auth/login')
      .set('X-Refresh-Token-Delivery', 'body')
      .send({ identifier: ADMIN.email, password: ADMIN.password })
      .expect(200)
  ).body.accessToken as string;

  main = await create('scm/main-stores', { name: 'Central store' });
  ward = await create('scm/sub-stores', { mainStoreId: main, name: 'Ward store' });
  icu = await create('scm/departments', { name: 'ICU' });
  const group = await create('scm/item-groups', { name: 'Surgical' });
  const subGroup = await create('scm/item-sub-groups', { groupId: group, name: 'Disposables' });
  const category = await create('scm/item-categories', { name: 'Consumables' });
  const subCategory = await create('scm/item-sub-categories', { categoryId: category, name: 'Medical' });
  const item = await create('scm/items', {
    name: 'Gloves',
    subGroupId: subGroup,
    subCategoryId: subCategory,
    unit: 'Box',
  });
  const gloves = await create('scm/item-variants', { itemId: item, name: 'Sterile 7.5', expiryRequired: true });

  await create('scm/opening-stock', {
    mainStoreId: main,
    openedOn: '2026-03-01',
    lines: [
      { variantId: gloves, qty: 20, unitCost: 100, batchNo: 'A', expiryDate: '2027-01-31' },
      { variantId: gloves, qty: 9, unitCost: 80, batchNo: 'OLD', expiryDate: '2026-03-31' },
    ],
  });
  // The expired lot is skipped: six of batch A go to the ward, then on to the ICU.
  await create('scm/stock-transfers', {
    from: { mainStoreId: main },
    to: { subStoreId: ward },
    transferDate: '2026-04-01',
    lines: [{ variantId: gloves, qty: 6 }],
  });
  await create('scm/store-issues', {
    subStoreId: ward,
    departmentId: icu,
    issueDate: '2026-04-02',
    lines: [{ variantId: gloves, qty: 6 }],
  });
  await create('scm/gate-passes', {
    passDate: '2026-04-16',
    kind: 'maintenance',
    partyName: 'Biomed Services',
    reference: 'ECG machine',
  });
});

describe('supply chain stock reports', () => {
  it('sums a store’s movements over a period, with opening and closing stock', async () => {
    expect(await table('scm.stock-movement', { mainStoreId: main, from: '2026-03-15', to: '2026-04-30' })).toEqual([
      expect.objectContaining({
        Item: 'Gloves',
        'Opening qty': 29,
        'Opening value': 2_720,
        'In qty': 0,
        'Out qty': 6,
        'Out value': 600,
        'Closing qty': 23,
        'Closing value': 2_120,
      }),
    ]);
    // Through the ward: in and out again, nothing left.
    expect(await table('scm.stock-movement', { subStoreId: ward, from: '2026-04-01', to: '2026-04-30' })).toEqual([
      expect.objectContaining({ 'Opening qty': 0, 'In qty': 6, 'Out qty': 6, 'Closing qty': 0, 'Closing value': 0 }),
    ]);
    const refused = await request(http)
      .post('/api/v1/reports/scm.stock-movement/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { from: '2026-04-01', to: '2026-04-30' } });
    expect(refused.body.code).toBe('invalid_store');
  });

  it('lists lots expiring soon or expired, everywhere or in one place', async () => {
    const soon = await table('scm.expiry', { asOf: '2026-04-10', withinDays: 30 });
    expect(soon).toEqual([
      expect.objectContaining({
        'Store / department': 'Central store',
        Batch: 'OLD',
        'Days left': -10,
        Quantity: 9,
        Value: 720,
      }),
    ]);
    expect(await table('scm.expiry', { asOf: '2026-04-10', withinDays: 30, includeExpired: false })).toEqual([]);
    const year = await table('scm.expiry', { asOf: '2026-04-10', withinDays: 300 });
    expect(year.map((lot) => [lot['Store / department'], lot.Batch, lot.Quantity])).toEqual([
      ['Central store', 'OLD', 9],
      ['Central store', 'A', 14],
      ['ICU', 'A', 6],
    ]);
    expect(
      (await table('scm.expiry', { departmentId: icu, asOf: '2026-04-10', withinDays: 300 })).map((lot) => lot.Value),
    ).toEqual([600]);
  });

  it('registers every stock document and gate pass in a period', async () => {
    const all = await table('scm.movement-register', { from: '2026-03-01', to: '2026-04-30' });
    expect(all.map((row) => [row.Kind, row['Store / department'], row['Qty in'], row['Qty out']])).toEqual([
      ['Opening stock', 'Central store', 29, 0],
      ['Transfer', 'Central store', 0, 6],
      ['Transfer', 'Ward store', 6, 0],
      ['Issue', 'ICU', 6, 0],
      ['Issue', 'Ward store', 0, 6],
    ]);
    const transfers = await table('scm.movement-register', {
      kind: 'transfer',
      mainStoreId: main,
      from: '2026-03-01',
      to: '2026-04-30',
    });
    expect(transfers).toEqual([expect.objectContaining({ Items: 1, 'Value out': 600 })]);
    expect(await table('scm.gate-pass-register', { from: '2026-04-01', to: '2026-04-30' })).toEqual([
      expect.objectContaining({ 'Gate pass': 'GP-2026-00001', Kind: 'Maintenance', Party: 'Biomed Services' }),
    ]);
    expect(await table('scm.gate-pass-register', { kind: 'other', from: '2026-04-01', to: '2026-04-30' })).toEqual([]);
  });
});
