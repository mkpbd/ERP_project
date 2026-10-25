import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let nurse: string;
let keeper: string;
let auditor: string;
let receiver: string;
let main: string;
let ward: string;
let icu: string;
let lab: string;
let gloves: string;
let aci: string;
let aciLedger: string;

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

const scm = (method: 'get' | 'post' | 'patch', path: string, token: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/scm/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const stockAt = async (place: Record<string, string>) => {
  const response = await scm(
    'get',
    `stock?${new URLSearchParams({ ...place, variantId: gloves }).toString()}`,
    admin,
  ).expect(200);
  return response.body.items[0] as { qty: number; lots: { lotId: string; batchNo: string; qty: number }[] } | undefined;
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
  const nurseUser = await user('nurse', ['scm:read', 'scm:department']);
  const keeperUser = await user('keeper', ['scm:read', 'scm:issue']);
  nurse = nurseUser.token;
  keeper = keeperUser.token;
  auditor = (await user('auditor', ['scm:read', 'scm:adjust'])).token;
  receiver = (await user('receiver', ['scm:read', 'scm:receive'])).token;

  await create('accounts/fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  const inventory = await glAccount('1', 'debit', '1300', 'Store inventory');
  const payable = await glAccount('2', 'credit', '2101', 'Payable to suppliers', { isControlAccount: true });
  await create('accounts/gl-roles', { role: 'store_inventory', glAccountId: inventory });
  await create('accounts/gl-roles', { role: 'supplier_payable', glAccountId: payable });
  const partyType = await create('accounts/sub-ledger-types', { name: 'Suppliers' });
  aciLedger = await create('accounts/sub-ledgers', { typeId: partyType, name: 'ACI Limited' });

  main = await create('scm/main-stores', { name: 'Central store' });
  ward = await create('scm/sub-stores', { mainStoreId: main, name: 'Ward store' });
  icu = await create('scm/departments', { name: 'ICU' });
  lab = await create('scm/departments', { name: 'Laboratory' });
  await create('scm/department-users', { departmentId: icu, userId: nurseUser.id });
  await create('scm/issue-store-users', { subStoreId: ward, userId: keeperUser.id });
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
  gloves = await create('scm/item-variants', { itemId: item, name: 'Sterile 7.5', expiryRequired: true });
  const local = await create('scm/supplier-types', { name: 'Local' });
  aci = await create('scm/suppliers', { typeId: local, name: 'ACI Limited', subLedgerId: aciLedger });

  await create('scm/opening-stock', {
    mainStoreId: main,
    openedOn: '2026-03-01',
    lines: [
      { variantId: gloves, qty: 20, unitCost: 100, batchNo: 'A', expiryDate: '2027-01-31' },
      { variantId: gloves, qty: 9, unitCost: 80, batchNo: 'OLD', expiryDate: '2026-03-31' },
    ],
  });
  await create(
    'scm/stock-transfers',
    {
      from: { mainStoreId: main },
      to: { subStoreId: ward },
      transferDate: '2026-04-01',
      lines: [{ variantId: gloves, qty: 6 }],
    },
    keeper,
  );
  await create(
    'scm/store-issues',
    { subStoreId: ward, departmentId: icu, issueDate: '2026-04-02', lines: [{ variantId: gloves, qty: 6 }] },
    keeper,
  );
});

describe('department stock', () => {
  it('is issued in, consumed, returned and counted', async () => {
    expect((await stockAt({ departmentId: icu }))?.qty).toBe(6);

    const consumed = await scm('post', 'department-consumptions', nurse, {
      departmentId: icu,
      consumedOn: '2026-04-03',
      lines: [{ variantId: gloves, qty: 2 }],
    }).expect(201);
    expect(consumed.body.number).toBe('DC-2026-00001');
    expect((await stockAt({ departmentId: icu }))?.qty).toBe(4);
    await scm('post', `department-consumptions/${consumed.body.id}/cancel`, nurse, {
      version: 1,
      reason: 'Entered twice',
      on: '2026-04-03',
    }).expect(204);
    expect((await stockAt({ departmentId: icu }))?.qty).toBe(6);
    await scm('post', 'department-consumptions', nurse, {
      departmentId: icu,
      consumedOn: '2026-04-04',
      lines: [{ variantId: gloves, qty: 3 }],
    }).expect(201);
    await scm('post', 'department-consumptions', nurse, {
      departmentId: lab,
      consumedOn: '2026-04-04',
      lines: [{ variantId: gloves, qty: 1 }],
    }).expect(403);
    const tooMuch = await scm('post', 'department-consumptions', nurse, {
      departmentId: icu,
      consumedOn: '2026-04-04',
      lines: [{ variantId: gloves, qty: 4 }],
    }).expect(422);
    expect(tooMuch.body.code).toBe('insufficient_stock');

    const returned = await scm('post', 'department-returns', nurse, {
      departmentId: icu,
      subStoreId: ward,
      returnDate: '2026-04-05',
      reason: 'Not needed',
      lines: [{ variantId: gloves, qty: 1 }],
    }).expect(201);
    expect((await stockAt({ departmentId: icu }))?.qty).toBe(3);
    await scm('post', `department-returns/${returned.body.id}/decision`, nurse, {
      version: 1,
      decision: 'receive',
      on: '2026-04-05',
    }).expect(403);
    await scm('post', `department-returns/${returned.body.id}/decision`, keeper, {
      version: 1,
      decision: 'receive',
      on: '2026-04-06',
    }).expect(204);
    expect((await stockAt({ departmentId: icu }))?.qty).toBe(2);
    expect((await stockAt({ subStoreId: ward }))?.qty).toBe(1);

    const held = await stockAt({ departmentId: icu });
    const count = await scm('post', 'department-counts', nurse, {
      departmentId: icu,
      countedOn: '2026-04-07',
      reason: 'Month end',
      lines: [{ variantId: gloves, lotId: held!.lots[0]!.lotId, physicalQty: 1 }],
    }).expect(201);
    await scm('post', `department-counts/${count.body.id}/decision`, nurse, { version: 1, decision: 'approve' }).expect(
      403,
    );
    await scm('post', `department-counts/${count.body.id}/decision`, auditor, {
      version: 1,
      decision: 'approve',
    }).expect(204);
    expect((await stockAt({ departmentId: icu }))?.qty).toBe(1);
    const view = await scm('get', `department-counts/${count.body.id}`, nurse).expect(200);
    expect(view.body).toMatchObject({
      status: 'approved',
      partyName: 'ICU',
      lines: [{ systemQty: 2, physicalQty: 1, adjustQty: -1 }],
    });

    const card = await scm(
      'get',
      `stock/card?departmentId=${icu}&variantId=${gloves}&from=2026-04-01&to=2026-04-30`,
      nurse,
    ).expect(200);
    expect(card.body.rows.map((row: { kind: string }) => row.kind)).toEqual([
      'issue',
      'consumption',
      'consumption',
      'consumption',
      'department_return',
      'adjustment',
    ]);
    const listed = await scm('get', `department-consumptions?departmentId=${icu}&status=posted`, nurse).expect(200);
    expect(listed.body.total).toBe(1);
  });
});

describe('supplier returns', () => {
  it('send goods back with a gate pass and debit note, and take in what comes back', async () => {
    const draft = await scm('post', 'supplier-returns', receiver, {
      mainStoreId: main,
      supplierId: aci,
      returnDate: '2026-04-10',
      reason: 'Expired and torn boxes',
      lines: [{ variantId: gloves, qty: 3 }],
    }).expect(201);
    expect(draft.body.number).toBe('RT-2026-00001');
    const sent = await scm('post', `supplier-returns/${draft.body.id}/send`, receiver, { version: 1 }).expect(200);
    expect(sent.body).toEqual({ gatePassNumber: 'GP-2026-00001', voucherNumber: 'JV-2025-2026-00001' });
    // Returns take expired lots first.
    const left = await stockAt({ mainStoreId: main });
    expect(left?.lots.map((lot) => [lot.batchNo, lot.qty])).toEqual([
      ['OLD', 6],
      ['A', 14],
    ]);

    const settled = await scm('post', `supplier-returns/${draft.body.id}/settle`, receiver, {
      version: 2,
      on: '2026-04-15',
      lines: [{ receivedQty: 2, batchNo: 'NEW', expiryDate: '2027-06-30' }],
    }).expect(200);
    expect(settled.body.voucherNumber).toBe('JV-2025-2026-00002');
    const after = await stockAt({ mainStoreId: main });
    expect(after?.lots.find((lot) => lot.batchNo === 'NEW')?.qty).toBe(2);

    const owed = await request(http)
      .get(`/api/v1/accounts/books/ledger?subLedgerId=${aciLedger}&from=2026-04-01&to=2026-04-30`)
      .set(bearer(admin))
      .expect(200);
    expect(owed.body).toMatchObject({ totalDebit: 240, totalCredit: 160, closing: 80 });

    const view = await scm('get', `supplier-returns/${draft.body.id}`, receiver).expect(200);
    expect(view.body).toMatchObject({
      status: 'settled',
      partyName: 'ACI Limited',
      value: 240,
      fields: { gatePassNumber: 'GP-2026-00001', settledVoucherNumber: 'JV-2025-2026-00002' },
      lines: [{ qty: 3, unitCost: 80, receivedQty: 2 }],
    });
    await request(http)
      .delete(`/api/v1/scm/supplier-returns/${draft.body.id}?version=3`)
      .set(bearer(receiver))
      .expect(422);

    await create(
      'scm/gate-passes',
      { passDate: '2026-04-16', kind: 'maintenance', partyName: 'Biomed Services', reference: 'ECG machine' },
      keeper,
    );
    const passes = await scm('get', 'gate-passes', keeper).expect(200);
    expect(passes.body.items.map((pass: { number: string; status: string }) => [pass.number, pass.status])).toEqual([
      ['GP-2026-00002', 'maintenance'],
      ['GP-2026-00001', 'supplier_return'],
    ]);

    for (const [key, id] of [
      ['scm.supplier-return', draft.body.id as string],
      ['scm.gate-pass', passes.body.items[1].id as string],
    ] as const) {
      const response = await request(http)
        .post(`/api/v1/reports/${key}/render`)
        .set(bearer(admin))
        .send({ format: 'pdf', params: { id } });
      expect(response.status, `${key}: ${JSON.stringify(response.body).slice(0, 200)}`).toBe(200);
    }
  });
});
