import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let keeper: string;
let biomed: string;
let director: string;
let accountant: string;
let main: string;
let supplier: string;
let pieces: string[];
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

async function user(name: string, roleId: string): Promise<string> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  await request(http).post(`/api/v1/users/${created.body.id}/roles`).set(bearer(admin)).send({ roleId }).expect(204);
  return login(`${name}@example.com`, PASSWORD);
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

const scm = (method: 'get' | 'post', path: string, token: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/scm/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const closing = async (account: string) =>
  (
    await request(http)
      .get(`/api/v1/accounts/books/ledger?glAccountId=${gl[account]}&from=2025-12-01&to=2026-06-30`)
      .set(bearer(admin))
      .expect(200)
  ).body.closing as number;
const stockQty = async () =>
  ((await scm('get', `stock?mainStoreId=${main}`, admin).expect(200)).body.items[0]?.qty as number | undefined) ?? 0;
const statusOf = async () =>
  ((await scm('get', 'fixed-assets', admin).expect(200)).body.items as { assetNo: string; status: string }[]).map(
    (asset) => `${asset.assetNo}:${asset.status}`,
  );

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  keeper = await user(
    'keeper',
    await create('roles', { name: 'asset-keepers', permissions: ['scm:read', 'scm:assets'] }),
  );
  const biomeds = await create('roles', { name: 'biomedical', permissions: ['scm:read'] });
  const directors = await create('roles', { name: 'directors', permissions: ['scm:read'] });
  const accounts = await create('roles', { name: 'accounts', permissions: ['scm:read'] });
  biomed = await user('biomed', biomeds);
  director = await user('director', directors);
  accountant = await user('accountant', accounts);
  await create('scm/asset-approval-levels', {
    flow: 'service',
    levelOrder: 1,
    name: 'Biomedical engineer',
    roleId: biomeds,
  });
  await create('scm/asset-approval-levels', { flow: 'discard', levelOrder: 1, name: 'Director', roleId: directors });
  await create('scm/asset-approval-levels', { flow: 'scrap_sale', levelOrder: 1, name: 'Director', roleId: directors });
  await create('scm/asset-approval-levels', {
    flow: 'discard_sale',
    levelOrder: 1,
    name: 'Accounts',
    roleId: accounts,
  });

  await create('accounts/fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  gl.equipment = await glAccount('1', 'debit', '1500', 'Medical equipment');
  gl.accumulated = await glAccount('1', 'debit', '1590', 'Accumulated depreciation');
  gl.cash = await glAccount('1', 'debit', '1001', 'Cash in hand');
  gl.payable = await glAccount('2', 'credit', '2101', 'Payable to suppliers', { isControlAccount: true });
  gl.gain = await glAccount('4', 'credit', '4900', 'Gain on disposal');
  gl.scrap = await glAccount('4', 'credit', '4910', 'Scrap sales');
  gl.expense = await glAccount('5', 'debit', '5900', 'Depreciation expense');
  gl.loss = await glAccount('5', 'debit', '5910', 'Loss on disposal');
  gl.maintenance = await glAccount('5', 'debit', '5920', 'Repairs and maintenance');
  gl.repairsDue = await glAccount('2', 'credit', '2102', 'Repairs payable');
  for (const [role, account] of [
    ['store_inventory', 'equipment'],
    ['supplier_payable', 'payable'],
    ['depreciation_expense', 'expense'],
    ['accumulated_depreciation', 'accumulated'],
    ['asset_disposal_loss', 'loss'],
    ['asset_disposal_gain', 'gain'],
    ['cash_in_hand', 'cash'],
    ['scrap_sale_income', 'scrap'],
    ['asset_maintenance_expense', 'maintenance'],
    ['maintenance_payable', 'repairsDue'],
  ] as const) {
    await create('accounts/gl-roles', { role, glAccountId: gl[account] });
  }
  const partyType = await create('accounts/sub-ledger-types', { name: 'Suppliers' });
  const party = await create('accounts/sub-ledgers', { typeId: partyType, name: 'Medical Systems Ltd' });

  main = await create('scm/main-stores', { name: 'Central store' });
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
  const ecg = await create('scm/item-variants', { itemId: item, name: '12 channel' });
  const local = await create('scm/supplier-types', { name: 'Local' });
  supplier = await create('scm/suppliers', { typeId: local, name: 'Medical Systems Ltd', subLedgerId: party });
  const receive = await create('scm/stock-receives', {
    mainStoreId: main,
    supplierId: supplier,
    receivedOn: '2025-12-15',
    lines: [{ variantId: ecg, qty: 3, rate: 120_000 }],
  });
  await scm('post', `stock-receives/${receive}/post`, admin, { version: 1 }).expect(200);
  pieces = ((await scm('get', 'fixed-assets', admin).expect(200)).body.items as { id: string }[]).map(
    (asset) => asset.id,
  );
  await scm('post', 'fixed-assets/depreciation', admin, {
    assetIds: pieces,
    lifeMonths: 60,
    residualPercent: 10,
  }).expect(200);
  await scm('post', 'depreciation-runs', admin, { asOf: '2026-02-28' }).expect(201);
});

describe('asset service, discard and scrap sale', () => {
  it('sends pieces out of stock for service with a gate pass and books the maintenance on return', async () => {
    const service = await scm('post', 'asset-service-requests', keeper, {
      requestDate: '2026-03-01',
      sentTo: 'Medical Systems service centre',
      supplierId: supplier,
      lines: [
        { assetId: pieces[0], serviceType: 'warranty', problem: 'No display' },
        { assetId: pieces[1], serviceType: 'maintenance', cost: 2_500 },
        { assetId: pieces[2], serviceType: 'maintenance', cost: 100 },
      ],
    }).expect(201);
    expect(service.body.number).toBe('AS-2026-00001');
    const busy = await scm('post', 'asset-discard-requests', keeper, {
      requestDate: '2026-03-01',
      reason: 'Old',
      lines: [{ assetId: pieces[1] }],
    }).expect(409);
    expect(busy.body.code).toBe('asset_busy');
    expect((await scm('get', 'asset-service-requests/inbox', biomed).expect(200)).body.items).toHaveLength(1);
    await scm('post', `asset-service-requests/${service.body.id}/decision`, director, {
      version: 1,
      decision: 'approve',
      on: '2026-03-02',
    }).expect(403);
    const approved = await scm('post', `asset-service-requests/${service.body.id}/decision`, biomed, {
      version: 1,
      decision: 'approve',
      rejectAssets: [pieces[2]],
      on: '2026-03-02',
    }).expect(200);
    expect(approved.body).toEqual({ status: 'approved', reference: 'GP-2026-00001' });
    expect(await statusOf()).toEqual(['FA-000001:out_for_service', 'FA-000002:out_for_service', 'FA-000003:in_stock']);
    // Out of the store while away; the books keep the asset.
    expect(await stockQty()).toBe(1);
    expect(await closing('equipment')).toBe(360_000);

    const warranty = await scm('post', `asset-service-requests/${service.body.id}/receive`, keeper, {
      version: 2,
      assetIds: [pieces[0]],
      costs: [{ assetId: pieces[0], cost: 50 }],
      on: '2026-03-20',
    }).expect(422);
    expect(warranty.body.code).toBe('warranty_cost');
    await scm('post', `asset-service-requests/${service.body.id}/receive`, keeper, {
      version: 2,
      assetIds: [pieces[0]],
      on: '2026-03-20',
    }).expect(204);
    expect(await stockQty()).toBe(2);
    expect(await closing('maintenance')).toBe(0);
    await scm('post', `asset-service-requests/${service.body.id}/receive`, keeper, {
      version: 3,
      assetIds: [pieces[1]],
      costs: [{ assetId: pieces[1], cost: 2_750 }],
      on: '2026-03-25',
    }).expect(204);
    expect(await stockQty()).toBe(3);
    expect(await closing('maintenance')).toBe(2_750);
    // On the vendor's supplier ledger, not the generic repairs payable.
    expect(await closing('payable')).toBe(-362_750);
    expect(await closing('repairsDue')).toBe(0);
    const done = await scm('get', `asset-service-requests/${service.body.id}`, keeper).expect(200);
    expect(done.body).toMatchObject({
      status: 'closed',
      fields: { supplierId: supplier },
      lines: [
        { returnedOn: '2026-03-20', actualCost: 0, receiptVoucherNumber: null },
        { returnedOn: '2026-03-25', actualCost: 2_750, receiptVoucherNumber: expect.stringMatching(/^JV-/) },
        { rejected: true },
      ],
    });
    expect(await statusOf()).toEqual(['FA-000001:in_stock', 'FA-000002:in_stock', 'FA-000003:in_stock']);
  });

  it('writes pieces off with depreciation to the day and the disposal journal, then sells them', async () => {
    const discard = await scm('post', 'asset-discard-requests', keeper, {
      requestDate: '2026-03-10',
      reason: 'Beyond repair',
      lines: [{ assetId: pieces[1] }, { assetId: pieces[2], reason: 'Burnt board' }],
    }).expect(201);
    const decided = await scm('post', `asset-discard-requests/${discard.body.id}/decision`, director, {
      version: 1,
      decision: 'approve',
      on: '2026-03-16',
    }).expect(200);
    expect(decided.body.status).toBe('discarded');
    expect(await statusOf()).toEqual(['FA-000001:in_stock', 'FA-000002:discarded', 'FA-000003:discarded']);
    const view = await scm('get', `asset-discard-requests/${discard.body.id}`, keeper).expect(200);
    // 1,800 a month to February, then 16/31 of March: 4,529.03 depreciated, the rest written off.
    expect(view.body.lines.map((line: { bookValue: number }) => line.bookValue)).toEqual([115_470.97, 115_470.97]);
    expect(await closing('accumulated')).toBe(-3_600);
    expect(await closing('loss')).toBe(230_941.94);
    expect(await closing('equipment')).toBe(120_000);
    const stock = await scm('get', `stock?mainStoreId=${main}`, keeper).expect(200);
    expect(stock.body.items[0].qty).toBe(1);

    const sell = (version: number) =>
      scm('post', `asset-discard-requests/${discard.body.id}/sell`, keeper, {
        version,
        soldTo: 'Medical Systems Ltd',
        buyerSupplierId: supplier,
        on: '2026-03-20',
        amounts: [{ assetId: pieces[1], amount: 5_000 }],
      });
    expect((await sell(2).expect(200)).body).toEqual({ status: 'sale_pending' });
    const inbox = await scm('get', 'asset-discard-requests/inbox', accountant).expect(200);
    expect(inbox.body.items).toMatchObject([{ status: 'sale_pending', currentLevelName: 'Accounts' }]);
    await scm('post', `asset-discard-requests/${discard.body.id}/decision`, director, {
      version: 3,
      decision: 'approve',
      on: '2026-03-20',
    }).expect(403);
    // A rejected sale leaves the pieces written off, ready for another offer.
    const refused = await scm('post', `asset-discard-requests/${discard.body.id}/decision`, accountant, {
      version: 3,
      decision: 'reject',
      remarks: 'Get a better offer',
      on: '2026-03-20',
    }).expect(200);
    expect(refused.body).toEqual({ status: 'discarded', reference: null });
    await sell(4).expect(200);
    const sold = await scm('post', `asset-discard-requests/${discard.body.id}/decision`, accountant, {
      version: 5,
      decision: 'approve',
      on: '2026-03-20',
    }).expect(200);
    expect(sold.body).toEqual({ status: 'sold', reference: 'DIS-2026-00001' });
    // To the buyer's party ledger (a supplier), not cash.
    expect(await closing('cash')).toBe(0);
    expect(await closing('payable')).toBe(-355_000);
    expect(await closing('gain')).toBe(-5_000);
    expect(await statusOf()).toEqual(['FA-000001:in_stock', 'FA-000002:sold', 'FA-000003:discarded']);
    const history = await scm('get', `asset-discard-requests/${discard.body.id}`, keeper).expect(200);
    expect(
      history.body.decisions.map((entry: { stage: string; decision: string }) => `${entry.stage}:${entry.decision}`),
    ).toEqual(['request:approved', 'sale:rejected', 'sale:approved']);
    await sell(6).expect(422);

    const scrap = await scm('post', 'scrap-sales', keeper, {
      saleDate: '2026-03-25',
      buyer: 'Scrap Traders',
      lines: [{ description: 'Cartons', unit: 'kg', qty: 12.5, unitPrice: 8 }],
    }).expect(201);
    const scrapSold = await scm('post', `scrap-sales/${scrap.body.id}/decision`, director, {
      version: 1,
      decision: 'approve',
      on: '2026-03-25',
    }).expect(200);
    expect(scrapSold.body).toEqual({ status: 'sold', reference: 'DIS-2026-00002' });
    expect(await closing('scrap')).toBe(-100);
    expect(await closing('cash')).toBe(100);

    for (const params of [
      { kind: 'discard', id: discard.body.id },
      { kind: 'scrap_sale', id: scrap.body.id },
    ]) {
      const response = await request(http)
        .post('/api/v1/reports/scm.disposal-invoice/render')
        .set(bearer(admin))
        .send({ format: 'pdf', params });
      expect(response.status, JSON.stringify(response.body).slice(0, 200)).toBe(200);
    }
  });
});
