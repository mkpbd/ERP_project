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
let ecg: string;
let aci: string;
let accumulatedGl: string;

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
  const response = await request(http).post(`/api/v1/${path}`).set(bearer(admin)).send(body);
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
      statement: nature === '5' ? 'profit_and_loss' : 'balance_sheet',
      normalBalance,
    }));
  const category = await create('accounts/categories', { natureId, code: `${code}C`, name: `${name} group` });
  const sub = await create('accounts/sub-categories', { categoryId: category, name: 'General' });
  const head4 = await create('accounts/level4-heads', { subCategoryId: sub, name: 'General' });
  const head5 = await create('accounts/level5-heads', { level4HeadId: head4, name: 'General' });
  return create('accounts/gl-accounts', { level5HeadId: head5, code, name, ...extra });
}

const scm = (method: 'get' | 'post' | 'patch', path: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/scm/${path}`).set(bearer(admin));
  return body ? call.send(body) : call;
};
const assets = async () =>
  (await scm('get', 'fixed-assets').expect(200)).body.items as {
    id: string;
    assetNo: string;
    placeName: string;
    accumulated: number | null;
    bookValue: number;
  }[];

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);

  await create('accounts/fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  const equipment = await glAccount('1', 'debit', '1500', 'Medical equipment');
  accumulatedGl = await glAccount('1', 'debit', '1590', 'Accumulated depreciation');
  const payable = await glAccount('2', 'credit', '2101', 'Payable to suppliers', { isControlAccount: true });
  const expense = await glAccount('5', 'debit', '5900', 'Depreciation expense');
  await create('accounts/gl-roles', { role: 'store_inventory', glAccountId: equipment });
  await create('accounts/gl-roles', { role: 'supplier_payable', glAccountId: payable });
  await create('accounts/gl-roles', { role: 'depreciation_expense', glAccountId: expense });
  await create('accounts/gl-roles', { role: 'accumulated_depreciation', glAccountId: accumulatedGl });
  const partyType = await create('accounts/sub-ledger-types', { name: 'Suppliers' });
  const party = await create('accounts/sub-ledgers', { typeId: partyType, name: 'Medical Systems Ltd' });

  main = await create('scm/main-stores', { name: 'Central store' });
  ward = await create('scm/sub-stores', { mainStoreId: main, name: 'Ward store' });
  icu = await create('scm/departments', { name: 'ICU' });
  const group = await create('scm/item-groups', { name: 'Equipment' });
  const subGroup = await create('scm/item-sub-groups', { groupId: group, name: 'Diagnostic' });
  const category = await create('scm/item-categories', { name: 'Fixed assets' });
  const subCategory = await create('scm/item-sub-categories', { categoryId: category, name: 'Medical' });
  const item = await create('scm/items', {
    name: 'ECG machine',
    subGroupId: subGroup,
    subCategoryId: subCategory,
    unit: 'Pcs',
    isAsset: true,
  });
  ecg = await create('scm/item-variants', { itemId: item, name: '12 channel' });
  const local = await create('scm/supplier-types', { name: 'Local' });
  aci = await create('scm/suppliers', { typeId: local, name: 'Medical Systems Ltd', subLedgerId: party });
});

describe('fixed assets', () => {
  it('registers every piece received, follows it and depreciates it', async () => {
    const fraction = await scm('post', 'stock-receives', {
      mainStoreId: main,
      supplierId: aci,
      receivedOn: '2025-12-15',
      lines: [{ variantId: ecg, qty: 1.5, rate: 120_000 }],
    }).expect(201);
    const half = await scm('post', `stock-receives/${fraction.body.id}/post`, { version: 1 }).expect(422);
    expect(half.body.code).toBe('whole_pieces');
    await scm('patch', `stock-receives/${fraction.body.id}`, {
      version: 1,
      lines: [{ variantId: ecg, qty: 2, rate: 120_000 }],
    }).expect(204);
    await scm('post', `stock-receives/${fraction.body.id}/post`, { version: 2 }).expect(200);
    expect((await assets()).map((asset) => [asset.assetNo, asset.placeName, asset.bookValue])).toEqual([
      ['FA-000001', 'Central store', 120_000],
      ['FA-000002', 'Central store', 120_000],
    ]);

    await scm('post', 'stock-transfers', {
      from: { mainStoreId: main },
      to: { subStoreId: ward },
      transferDate: '2025-12-20',
      lines: [{ variantId: ecg, qty: 1 }],
    }).expect(201);
    await scm('post', 'store-issues', {
      subStoreId: ward,
      departmentId: icu,
      issueDate: '2025-12-21',
      lines: [{ variantId: ecg, qty: 1 }],
    }).expect(201);
    expect((await assets()).map((asset) => asset.placeName)).toEqual(['ICU', 'Central store']);
    const consumed = await scm('post', 'department-consumptions', {
      departmentId: icu,
      consumedOn: '2025-12-22',
      lines: [{ variantId: ecg, qty: 1 }],
    }).expect(422);
    expect(consumed.body.code).toBe('asset_item');

    const [first, second] = await assets();
    await scm('post', 'fixed-assets/depreciation', {
      assetIds: [first!.id, second!.id],
      frequency: 'monthly',
      lifeMonths: 60,
      residualPercent: 10,
    }).expect(200);
    const notMonthEnd = await scm('get', 'depreciation-runs/preview?asOf=2026-03-15').expect(422);
    expect(notMonthEnd.body.code).toBe('invalid_as_of');
    const preview = await scm('get', 'depreciation-runs/preview?asOf=2026-03-31').expect(200);
    expect(preview.body).toMatchObject({
      assetCount: 2,
      total: 10_800,
      lines: [{ periods: 3, amount: 5_400 }, { periods: 3 }],
    });

    const run = await scm('post', 'depreciation-runs', { asOf: '2026-03-31' }).expect(201);
    expect(run.body).toMatchObject({ number: 'DP-2026-00001', total: 10_800, voucherNumber: 'JV-2025-2026-00002' });
    expect((await assets()).map((asset) => [asset.accumulated, asset.bookValue])).toEqual([
      [5_400, 114_600],
      [5_400, 114_600],
    ]);
    const again = await scm('post', 'depreciation-runs', { asOf: '2026-03-31' }).expect(422);
    expect(again.body.code).toBe('nothing_due');
    const reconfigure = await scm('post', 'fixed-assets/depreciation', {
      assetIds: [first!.id],
      lifeMonths: 36,
    }).expect(422);
    expect(reconfigure.body.code).toBe('depreciation_started');

    const april = await scm('post', 'depreciation-runs', { asOf: '2026-04-30' }).expect(201);
    expect(april.body.total).toBe(3_600);
    const notLatest = await scm('post', `depreciation-runs/${run.body.id}/reverse`, {
      reason: 'Wrong life',
      on: '2026-05-02',
    }).expect(422);
    expect(notLatest.body.code).toBe('not_latest_run');
    const reversed = await scm('post', `depreciation-runs/${april.body.id}/reverse`, {
      reason: 'Posted twice by mistake',
      on: '2026-05-02',
    }).expect(200);
    expect(reversed.body.voucherNumber).toBe('JV-2025-2026-00004');
    const redo = await scm('post', 'depreciation-runs', { asOf: '2026-04-30' }).expect(201);
    expect(redo.body).toMatchObject({ number: 'DP-2026-00003', total: 3_600 });

    const piece = await scm('get', `fixed-assets/${first!.id}`).expect(200);
    expect(piece.body).toMatchObject({
      assetNo: 'FA-000001',
      supplierName: 'Medical Systems Ltd',
      accumulated: 7_200,
      depreciation: { frequency: 'monthly', residual: 12_000, startDate: '2026-01-01', periodsDone: 4 },
    });
    expect(piece.body.charges.map((charge: { runNumber: string }) => charge.runNumber)).toEqual([
      'DP-2026-00001',
      'DP-2026-00001',
      'DP-2026-00001',
      'DP-2026-00003',
    ]);
    const ledger = await request(http)
      .get(`/api/v1/accounts/books/ledger?glAccountId=${accumulatedGl}&from=2026-01-01&to=2026-06-30`)
      .set(bearer(admin))
      .expect(200);
    expect(ledger.body.closing).toBe(-14_400);

    await scm('patch', `fixed-assets/${first!.id}`, { serialNo: 'ECG-77/2025' }).expect(204);
    const runs = await scm('get', 'depreciation-runs').expect(200);
    expect(runs.body.items.map((row: { status: string }) => row.status)).toEqual(['posted', 'reversed', 'posted']);
  });
});
