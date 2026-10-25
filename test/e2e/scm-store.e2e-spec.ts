import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let nurse: { id: string; token: string };
let inCharge: string;
let keeper: { id: string; token: string };
let mainKeeper: string;
let main: string;
let ward: string;
let ot: string;
let icu: string;
let lab: string;
let gloves: string;
let paper: string;

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

async function user(name: string, roleId: string): Promise<{ id: string; token: string }> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  await request(http).post(`/api/v1/users/${created.body.id}/roles`).set(bearer(admin)).send({ roleId }).expect(204);
  return { id: created.body.id as string, token: await login(`${name}@example.com`, PASSWORD) };
}

const scm = (method: 'get' | 'post' | 'patch', path: string, token: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/scm/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const stockOf = async (store: Record<string, string>, variantId: string) => {
  const query = new URLSearchParams({ ...store, variantId }).toString();
  const response = await scm('get', `stock?${query}`, admin).expect(200);
  return (response.body.items[0]?.qty as number | undefined) ?? 0;
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
  const nurses = await create('roles', { name: 'nurses', permissions: ['scm:read', 'scm:indent'] });
  const inCharges = await create('roles', { name: 'ward-in-charge', permissions: ['scm:read'] });
  const keepers = await create('roles', {
    name: 'store-keepers',
    permissions: ['scm:read', 'scm:indent', 'scm:issue'],
  });
  const mainKeepers = await create('roles', {
    name: 'main-store',
    permissions: ['scm:read', 'scm:issue', 'scm:purchase'],
  });
  nurse = await user('nurse', nurses);
  inCharge = (await user('incharge', inCharges)).token;
  keeper = await user('keeper', keepers);
  mainKeeper = (await user('mainkeeper', mainKeepers)).token;

  main = await create('scm/main-stores', { name: 'Central store' });
  ward = await create('scm/sub-stores', { mainStoreId: main, name: 'Ward store' });
  ot = await create('scm/sub-stores', { mainStoreId: main, name: 'OT store' });
  icu = await create('scm/departments', { name: 'ICU' });
  lab = await create('scm/departments', { name: 'Laboratory' });
  await create('scm/department-users', { departmentId: icu, userId: nurse.id });
  await create('scm/issue-store-users', { subStoreId: ward, userId: keeper.id });
  await create('scm/issue-store-users', { subStoreId: ot, userId: keeper.id });
  await create('scm/indent-approval-levels', {
    subStoreId: ward,
    levelOrder: 1,
    name: 'Ward in-charge',
    roleId: inCharges,
  });

  const group = await create('scm/item-groups', { name: 'Surgical' });
  const subGroup = await create('scm/item-sub-groups', { groupId: group, name: 'Disposables' });
  const category = await create('scm/item-categories', { name: 'Consumables' });
  const subCategory = await create('scm/item-sub-categories', { categoryId: category, name: 'Medical' });
  const item = (name: string) =>
    create('scm/items', { name, subGroupId: subGroup, subCategoryId: subCategory, unit: 'Box' });
  gloves = await create('scm/item-variants', {
    itemId: await item('Gloves'),
    name: 'Sterile 7.5',
    expiryRequired: true,
  });
  paper = await create('scm/item-variants', { itemId: await item('Paper'), name: 'A4' });
  await create('scm/opening-stock', {
    mainStoreId: main,
    openedOn: '2026-03-01',
    lines: [
      { variantId: gloves, qty: 20, unitCost: 100, batchNo: 'A', expiryDate: '2027-01-31' },
      { variantId: gloves, qty: 5, unitCost: 90, batchNo: 'B', expiryDate: '2026-06-30' },
      { variantId: gloves, qty: 9, unitCost: 80, batchNo: 'OLD', expiryDate: '2026-03-31' },
      { variantId: paper, qty: 10, unitCost: 450 },
    ],
  });
});

describe('store indents, requests, transfers and issues', () => {
  it('serve an approved indent from the main store through the sub-store to the department', async () => {
    await scm('post', 'store-indents', nurse.token, {
      subStoreId: ward,
      departmentId: lab,
      indentDate: '2026-04-01',
      lines: [{ variantId: gloves, qty: 1 }],
    }).expect(403);
    const created = await scm('post', 'store-indents', nurse.token, {
      subStoreId: ward,
      departmentId: icu,
      indentDate: '2026-04-01',
      priority: 'emergency',
      lines: [
        { variantId: gloves, qty: 8 },
        { variantId: paper, qty: 3 },
      ],
    }).expect(201);
    expect(created.body.number).toBe('SI-2026-00001');
    const indent = created.body.id as string;
    await scm('post', `store-indents/${indent}/submit`, nurse.token, { version: 1 }).expect(204);
    expect((await scm('get', 'store-indents/inbox', inCharge).expect(200)).body.items).toMatchObject([
      { number: 'SI-2026-00001', currentLevelName: 'Ward in-charge', departmentName: 'ICU' },
    ]);
    await scm('post', `store-indents/${indent}/decision`, nurse.token, { version: 2, decision: 'approve' }).expect(403);
    await scm('post', `store-indents/${indent}/decision`, inCharge, {
      version: 2,
      decision: 'approve',
      quantities: [{ variantId: paper, approvedQty: 2 }],
    }).expect(200);

    const shortfall = await scm('get', `store-indents/${indent}/shortfall?on=2026-04-01`, keeper.token).expect(200);
    expect(
      shortfall.body.items.map((line: { open: number; inStock: number; shortfall: number }) => [
        line.open,
        line.inStock,
        line.shortfall,
      ]),
    ).toEqual([
      [8, 0, 8],
      [2, 0, 2],
    ]);

    // The ward asks the main store; the main store transfers, first expiring first (the expired lot is left).
    const asked = await scm('post', 'store-requests', keeper.token, {
      subStoreId: ward,
      requestDate: '2026-04-01',
      lines: [
        { variantId: gloves, qty: 8 },
        { variantId: paper, qty: 2 },
      ],
    }).expect(201);
    const sent = await scm('post', 'stock-transfers', mainKeeper, {
      from: { mainStoreId: main },
      to: { subStoreId: ward },
      requestId: asked.body.id,
      transferDate: '2026-04-02',
      lines: [
        { variantId: gloves, qty: 8 },
        { variantId: paper, qty: 2 },
      ],
    }).expect(201);
    expect(sent.body).toMatchObject({ number: 'TR-2026-00001', status: 'completed' });
    const transfer = await scm('get', `stock-transfers/${sent.body.id}`, keeper.token).expect(200);
    expect(
      transfer.body.parts.map((part: { batchNo: string | null; qty: number; unitCost: number }) => [
        part.batchNo,
        part.qty,
        part.unitCost,
      ]),
    ).toEqual([
      ['B', 5, 90],
      ['A', 3, 100],
      [null, 2, 450],
    ]);
    expect(transfer.body).toMatchObject({ fromName: 'Central store', toName: 'Ward store', value: 1650 });
    expect((await scm('get', `store-requests/${asked.body.id}`, keeper.token).expect(200)).body.status).toBe('served');
    expect(await stockOf({ mainStoreId: main }, gloves)).toBe(26);
    expect(await stockOf({ subStoreId: ward }, gloves)).toBe(8);

    const issue = (body: Record<string, unknown>, token = keeper.token) =>
      scm('post', 'store-issues', token, {
        subStoreId: ward,
        departmentId: icu,
        indentId: indent,
        issueDate: '2026-04-03',
        ...body,
      });
    await issue({ lines: [{ variantId: gloves, qty: 1 }] }, nurse.token).expect(403);
    const first = await issue({
      lines: [
        { variantId: gloves, qty: 6 },
        { variantId: paper, qty: 2 },
      ],
    }).expect(201);
    expect(first.body.number).toBe('IS-2026-00001');
    const issued = await scm('get', `store-issues/${first.body.id}`, keeper.token).expect(200);
    expect(issued.body).toMatchObject({ departmentName: 'ICU', indentNumber: 'SI-2026-00001', value: 1450 });
    const over = await issue({ lines: [{ variantId: gloves, qty: 3 }] }).expect(422);
    expect(over.body.code).toBe('serve_exceeds_request');
    await issue({ lines: [{ variantId: gloves, qty: 2 }] }).expect(201);
    const served = await scm('get', `store-indents/${indent}`, nurse.token).expect(200);
    expect(served.body.status).toBe('served');
    expect(served.body.lines.map((line: { servedQty: number }) => line.servedQty)).toEqual([8, 2]);
    await scm('post', `store-indents/${indent}/acknowledge`, keeper.token, { version: 5 }).expect(403);
    await scm('post', `store-indents/${indent}/acknowledge`, nurse.token, { version: 5 }).expect(204);

    const empty = await scm('post', 'store-issues', keeper.token, {
      subStoreId: ward,
      departmentId: lab,
      issueDate: '2026-04-03',
      lines: [{ variantId: gloves, qty: 1 }],
    }).expect(422);
    expect(empty.body.code).toBe('insufficient_stock');

    const card = await scm(
      'get',
      `stock/card?subStoreId=${ward}&variantId=${gloves}&from=2026-04-01&to=2026-04-30`,
      keeper.token,
    ).expect(200);
    expect(card.body).toMatchObject({ opening: 0, totalIn: 8, totalOut: 8, closing: 0 });

    for (const [key, id] of [
      ['scm.store-indent', indent],
      ['scm.store-issue', first.body.id as string],
      ['scm.stock-transfer', sent.body.id as string],
    ] as const) {
      const response = await request(http)
        .post(`/api/v1/reports/${key}/render`)
        .set(bearer(admin))
        .send({ format: 'pdf', params: { id } });
      expect(response.status, `${key}: ${JSON.stringify(response.body).slice(0, 200)}`).toBe(200);
    }
  });

  it('move goods between sub-stores on acceptance, back to the main store, and to purchase', async () => {
    await scm('post', 'stock-transfers', mainKeeper, {
      from: { mainStoreId: main },
      to: { subStoreId: ward },
      transferDate: '2026-04-02',
      lines: [{ variantId: gloves, qty: 6, lotId: null }],
    }).expect(201);
    const elsewhere = await create('scm/main-stores', { name: 'Pharmacy store' });
    const wrong = await scm('post', 'stock-transfers', mainKeeper, {
      from: { mainStoreId: elsewhere },
      to: { subStoreId: ward },
      transferDate: '2026-04-02',
      lines: [{ variantId: gloves, qty: 1 }],
    }).expect(422);
    expect(wrong.body.code).toBe('wrong_main_store');

    const pending = await scm('post', 'stock-transfers', keeper.token, {
      from: { subStoreId: ward },
      to: { subStoreId: ot },
      transferDate: '2026-04-03',
      lines: [{ variantId: gloves, qty: 4 }],
    }).expect(201);
    expect(pending.body.status).toBe('pending');
    expect(await stockOf({ subStoreId: ward }, gloves)).toBe(6);
    await scm('post', `stock-transfers/${pending.body.id}/decision`, keeper.token, {
      version: 1,
      decision: 'accept',
      on: '2026-04-02',
    }).expect(422);
    await scm('post', `stock-transfers/${pending.body.id}/decision`, keeper.token, {
      version: 1,
      decision: 'accept',
      on: '2026-04-04',
      accepted: [{ line: 1, qty: 3 }],
    }).expect(200);
    expect(await stockOf({ subStoreId: ward }, gloves)).toBe(3);
    expect(await stockOf({ subStoreId: ot }, gloves)).toBe(3);
    const again = await scm('post', `stock-transfers/${pending.body.id}/decision`, keeper.token, {
      version: 2,
      decision: 'reject',
      reason: 'late',
    }).expect(422);
    expect(again.body.code).toBe('stock_transfer_state');

    const back = await scm('post', 'stock-transfers', keeper.token, {
      from: { subStoreId: ot },
      to: { mainStoreId: main },
      transferDate: '2026-04-05',
      lines: [{ variantId: gloves, qty: 3 }],
    }).expect(201);
    expect(back.body.status).toBe('completed');
    expect(await stockOf({ subStoreId: ot }, gloves)).toBe(0);
    expect(await stockOf({ mainStoreId: main }, gloves)).toBe(31);
    const listed = await scm('get', `stock-transfers?subStoreId=${ot}`, keeper.token).expect(200);
    expect(listed.body.items.map((row: { kind: string }) => row.kind).sort()).toEqual(['sub_to_main', 'sub_to_sub']);

    const asked = await scm('post', 'store-requests', keeper.token, {
      subStoreId: ward,
      requestDate: '2026-04-05',
      lines: [{ variantId: paper, qty: 50 }],
    }).expect(201);
    const raised = await scm('post', `store-requests/${asked.body.id}/purchase-requisition`, mainKeeper, {
      version: 1,
      requisitionDate: '2026-04-05',
    }).expect(201);
    const requisition = await scm('get', `purchase-requisitions/${raised.body.id}`, mainKeeper).expect(200);
    expect(requisition.body).toMatchObject({ status: 'draft', mainStoreId: main, lines: [{ requestedQty: 50 }] });
    const twice = await scm('post', `store-requests/${asked.body.id}/purchase-requisition`, mainKeeper, {
      version: 2,
      requisitionDate: '2026-04-05',
    }).expect(422);
    expect(twice.body.code).toBe('already_requested');
  });
});
