import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let keeper: string;
let viewer: string;
let store: string;
let ward: string;
let gloves: string;
let paper: string;
let aci: string;
let aciLedger: string;
let consumables: string;

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

async function user(name: string, permissions: string[]): Promise<string> {
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
  return login(`${name}@example.com`, PASSWORD);
}

/** Nature → … → one GL account. */
async function glAccount(nature: string, normalBalance: string, code: string, name: string, extra = {}) {
  const existing = await request(http).get('/api/v1/accounts/natures').set(bearer(admin));
  const natureId =
    (existing.body as { id: string; code: string }[]).find((entry) => entry.code === nature)?.id ??
    (await create('accounts/natures', {
      code: nature,
      name: `Nature ${nature}`,
      statement: 'balance_sheet',
      normalBalance,
    }));
  const category = await create('accounts/categories', { natureId, code: `${code}C`, name: `${name} group` });
  const sub = await create('accounts/sub-categories', { categoryId: category, name: 'General' });
  const head4 = await create('accounts/level4-heads', { subCategoryId: sub, name: 'General' });
  const head5 = await create('accounts/level5-heads', { level4HeadId: head4, name: 'General' });
  return create('accounts/gl-accounts', { level5HeadId: head5, code, name, ...extra });
}

const scm = (method: 'get' | 'post' | 'patch', path: string, body?: Record<string, unknown>, token = keeper) => {
  const call = request(http)[method](`/api/v1/scm/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  keeper = await user('keeper', ['scm:read', 'scm:purchase', 'scm:receive']);
  viewer = await user('viewer', ['scm:read']);

  await create('accounts/fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  consumables = await glAccount('1', 'debit', '1301', 'Consumables in store');
  const inventory = await glAccount('1', 'debit', '1300', 'Store inventory');
  const payable = await glAccount('2', 'credit', '2101', 'Payable to suppliers', { isControlAccount: true });
  await create('accounts/gl-roles', { role: 'store_inventory', glAccountId: inventory });
  await create('accounts/gl-roles', { role: 'supplier_payable', glAccountId: payable });
  const partyType = await create('accounts/sub-ledger-types', { name: 'Suppliers' });
  aciLedger = await create('accounts/sub-ledgers', { typeId: partyType, name: 'ACI Limited' });

  store = await create('scm/main-stores', { name: 'Central store' });
  ward = await create('scm/sub-stores', { mainStoreId: store, name: 'Ward store' });
  const group = await create('scm/item-groups', { name: 'Surgical' });
  const subGroup = await create('scm/item-sub-groups', { groupId: group, name: 'Disposables' });
  const category = await create('scm/item-categories', { name: 'Consumables' });
  const subCategory = await create('scm/item-sub-categories', { categoryId: category, name: 'Medical' });
  const glovesItem = await create('scm/items', {
    name: 'Gloves',
    subGroupId: subGroup,
    subCategoryId: subCategory,
    unit: 'Box',
    typeGlAccountId: consumables,
  });
  const paperItem = await create('scm/items', {
    name: 'Paper',
    subGroupId: subGroup,
    subCategoryId: subCategory,
    unit: 'Ream',
  });
  gloves = await create('scm/item-variants', { itemId: glovesItem, name: 'Sterile 7.5', expiryRequired: true });
  paper = await create('scm/item-variants', { itemId: paperItem, name: 'A4 80gsm', reorderLevel: 50 });
  const local = await create('scm/supplier-types', { name: 'Local' });
  aci = await create('scm/suppliers', { typeId: local, name: 'ACI Limited', subLedgerId: aciLedger });
});

async function order(lines: Record<string, unknown>[]): Promise<{ id: string; number: string }> {
  const created = await scm('post', 'purchase-orders', {
    supplierId: aci,
    mainStoreId: store,
    orderDate: '2026-03-01',
    lines,
  }).expect(201);
  return created.body as { id: string; number: string };
}

describe('stock receives', () => {
  it('take goods into stock by lot against an order and post the purchase to accounts', async () => {
    const po = await order([
      { variantId: gloves, qty: 10, rate: 1180, vatPercent: 7.5 },
      { variantId: paper, qty: 20, rate: 500 },
    ]);
    const other = await create('scm/suppliers', {
      typeId: (await scm('get', 'supplier-types').expect(200)).body[0].id,
      name: 'Rahim',
    });
    const wrong = await scm('post', 'stock-receives', {
      mainStoreId: store,
      supplierId: other,
      purchaseOrderId: po.id,
      receivedOn: '2026-03-10',
      lines: [{ variantId: paper, qty: 1, rate: 500 }],
    }).expect(422);
    expect(wrong.body.code).toBe('wrong_supplier');

    const draft = await scm('post', 'stock-receives', {
      mainStoreId: store,
      supplierId: aci,
      purchaseOrderId: po.id,
      receivedOn: '2026-03-10',
      supplierInvoiceNo: 'INV-77',
      lines: [
        { variantId: gloves, qty: 6, rate: 1180, vatPercent: 7.5, batchNo: 'B1' },
        { variantId: paper, qty: 20, rate: 480, discountPercent: 5 },
      ],
    }).expect(201);
    expect(draft.body.number).toBe('SR-2026-00001');
    const id = draft.body.id as string;
    const noExpiry = await scm('post', `stock-receives/${id}/post`, { version: 1 }).expect(422);
    expect(noExpiry.body.code).toBe('expiry_required');
    await scm('patch', `stock-receives/${id}`, {
      version: 1,
      lines: [
        { variantId: gloves, qty: 6, rate: 1180, vatPercent: 7.5, batchNo: 'B1', expiryDate: '2027-06-30' },
        { variantId: paper, qty: 20, rate: 480, discountPercent: 5 },
      ],
    }).expect(204);
    const posted = await scm('post', `stock-receives/${id}/post`, { version: 2 }).expect(200);
    expect(posted.body).toEqual({ voucherNumber: 'JV-2025-2026-00001' });

    const view = await scm('get', `stock-receives/${id}`).expect(200);
    expect(view.body).toMatchObject({
      status: 'posted',
      purchaseOrderNumber: po.number,
      amount: 16680,
      discount: 480,
      vat: 531,
      total: 16731,
      voucherNumber: 'JV-2025-2026-00001',
    });
    const orderView = await scm('get', `purchase-orders/${po.id}`).expect(200);
    expect(orderView.body.status).toBe('partially_received');
    expect(orderView.body.lines.map((line: { receivedQty: number }) => line.receivedQty)).toEqual([6, 20]);
    const variant = await scm('get', `item-variants/${paper}`).expect(200);
    expect(variant.body.purchasePrice).toBe(480);

    const stock = await scm('get', `stock?mainStoreId=${store}`, undefined, viewer).expect(200);
    expect(stock.body.items).toMatchObject([
      { variantName: 'Sterile 7.5', qty: 6, value: 7611, lots: [{ batchNo: 'B1', expiryDate: '2027-06-30', qty: 6 }] },
      { variantName: 'A4 80gsm', qty: 20, value: 9120, belowReorder: true },
    ]);

    // The supplier's sub-ledger owes the total; inventory is split by item type.
    const owed = await request(http)
      .get(`/api/v1/accounts/books/ledger?subLedgerId=${aciLedger}&from=2026-03-01&to=2026-03-31`)
      .set(bearer(admin))
      .expect(200);
    expect(owed.body.closing).toBe(-16731);
    const consumed = await request(http)
      .get(`/api/v1/accounts/books/ledger?glAccountId=${consumables}&from=2026-03-01&to=2026-03-31`)
      .set(bearer(admin))
      .expect(200);
    expect(consumed.body.closing).toBe(7611);

    const tooMuch = await scm('post', 'stock-receives', {
      mainStoreId: store,
      supplierId: aci,
      purchaseOrderId: po.id,
      receivedOn: '2026-03-12',
      lines: [{ variantId: gloves, qty: 5, rate: 1180, expiryDate: '2027-06-30', batchNo: 'B2' }],
    }).expect(201);
    const exceeds = await scm('post', `stock-receives/${tooMuch.body.id}/post`, { version: 1 }).expect(422);
    expect(exceeds.body.code).toBe('receive_exceeds_order');
    await scm('patch', `stock-receives/${tooMuch.body.id}`, {
      version: 1,
      supplierInvoiceNo: 'inv-77',
      lines: [{ variantId: gloves, qty: 4, rate: 1180, expiryDate: '2027-06-30', batchNo: 'b1' }],
    }).expect(409);
    await scm('patch', `stock-receives/${tooMuch.body.id}`, {
      version: 1,
      lines: [{ variantId: gloves, qty: 4, rate: 1180, expiryDate: '2027-06-30', batchNo: 'b1' }],
    }).expect(204);
    await scm('post', `stock-receives/${tooMuch.body.id}/post`, { version: 2 }).expect(200);
    expect((await scm('get', `purchase-orders/${po.id}`).expect(200)).body.status).toBe('received');
    const sameLot = await scm('get', `stock?mainStoreId=${store}&variantId=${gloves}`).expect(200);
    expect(sameLot.body.items[0]).toMatchObject({ qty: 10, lots: [{ batchNo: 'B1', qty: 10 }] });

    await request(http).delete(`/api/v1/scm/stock-receives/${id}?version=3`).set(bearer(keeper)).expect(422);
    await scm(
      'post',
      'stock-receives',
      {
        mainStoreId: store,
        supplierId: aci,
        receivedOn: '2026-03-12',
        lines: [{ variantId: paper, qty: 1, rate: 500 }],
      },
      viewer,
    ).expect(403);

    for (const [key, params] of [
      ['scm.stock-receive', { id }],
      ['scm.stock', { mainStoreId: store, withLots: true }],
      ['scm.stock-card', { mainStoreId: store, variantId: gloves, from: '2026-03-01', to: '2026-03-31' }],
    ] as const) {
      const response = await request(http)
        .post(`/api/v1/reports/${key}/render`)
        .set(bearer(admin))
        .send({ format: 'pdf', params });
      expect(response.status, `${key}: ${JSON.stringify(response.body).slice(0, 200)}`).toBe(200);
    }
  });

  it('keep opening stock, stock cards, GRN faults and short-closed orders', async () => {
    const opening = await request(http)
      .post('/api/v1/scm/opening-stock')
      .set(bearer(admin))
      .send({
        subStoreId: ward,
        openedOn: '2026-01-01',
        lines: [
          { variantId: paper, qty: 7, unitCost: 450 },
          { variantId: gloves, qty: 2, unitCost: 1100, batchNo: 'OLD', expiryDate: '2026-12-31' },
        ],
      })
      .expect(201);
    expect(opening.body.number).toBe('OS-2026-00001');
    await request(http)
      .post('/api/v1/scm/opening-stock')
      .set(bearer(admin))
      .send({
        mainStoreId: store,
        subStoreId: ward,
        openedOn: '2026-01-01',
        lines: [{ variantId: paper, qty: 1, unitCost: 1 }],
      })
      .expect(400);
    const missingExpiry = await request(http)
      .post('/api/v1/scm/opening-stock')
      .set(bearer(admin))
      .send({ mainStoreId: store, openedOn: '2026-01-01', lines: [{ variantId: gloves, qty: 1, unitCost: 1 }] })
      .expect(422);
    expect(missingExpiry.body.code).toBe('expiry_required');
    await scm('post', 'opening-stock', { mainStoreId: store, openedOn: '2026-01-01', lines: [] }).expect(403);

    const wardStock = await scm('get', `stock?subStoreId=${ward}`).expect(200);
    expect(
      wardStock.body.items.map((row: { variantName: string; qty: number; value: number }) => [
        row.variantName,
        row.qty,
        row.value,
      ]),
    ).toEqual([
      ['Sterile 7.5', 2, 2200],
      ['A4 80gsm', 7, 3150],
    ]);
    const reorder = await scm('get', `stock?mainStoreId=${store}&belowReorderOnly=true`).expect(200);
    expect(reorder.body.items.map((row: { variantName: string; qty: number }) => [row.variantName, row.qty])).toEqual([
      ['A4 80gsm', 0],
    ]);

    const po = await order([{ variantId: paper, qty: 30, rate: 500 }]);
    await create(
      'scm/grn-faults',
      { purchaseOrderId: po.id, variantId: paper, qty: 2, description: 'Wet reams', notedOn: '2026-03-05' },
      keeper,
    );
    const notOnOrder = await scm('post', 'grn-faults', {
      purchaseOrderId: po.id,
      variantId: gloves,
      qty: 1,
      description: 'Torn',
      notedOn: '2026-03-05',
    }).expect(422);
    expect(notOnOrder.body.code).toBe('not_on_order');
    const receive = await scm('post', 'stock-receives', {
      mainStoreId: store,
      supplierId: aci,
      purchaseOrderId: po.id,
      receivedOn: '2026-03-06',
      lines: [{ variantId: paper, qty: 12, rate: 500 }],
    }).expect(201);
    await scm('post', `stock-receives/${receive.body.id}/post`, { version: 1 }).expect(200);
    await scm('post', `purchase-orders/${po.id}/close`, { version: 2, reason: 'Supplier stopped the line' }).expect(
      204,
    );
    expect((await scm('get', `purchase-orders/${po.id}`).expect(200)).body.status).toBe('closed');
    const late = await scm('post', 'stock-receives', {
      mainStoreId: store,
      supplierId: aci,
      purchaseOrderId: po.id,
      receivedOn: '2026-03-07',
      lines: [{ variantId: paper, qty: 1, rate: 500 }],
    }).expect(422);
    expect(late.body.code).toBe('purchase_order_state');

    const card = await scm(
      'get',
      `stock/card?mainStoreId=${store}&variantId=${paper}&from=2026-03-06&to=2026-03-31`,
    ).expect(200);
    expect(card.body).toMatchObject({
      opening: 0,
      totalIn: 12,
      closing: 12,
      rows: [{ kind: 'receive', in: 12, balance: 12 }],
    });
    await scm('get', `stock/card?mainStoreId=${store}&variantId=${paper}&from=2026-03-31&to=2026-03-01`).expect(422);
    await scm('get', `stock?mainStoreId=00000000-0000-4000-8000-000000000000`).expect(404);
  });
});
