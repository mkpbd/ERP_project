import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let buyer: string;
let manager: string;
let director: string;
let committee: string;
let md: string;
let plain: string;
let store: string;
let gloves: string;
let masks: string;
let aci: string;
let rahim: string;

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

async function user(name: string, roleId?: string): Promise<{ id: string; token: string }> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  if (roleId) {
    await request(http).post(`/api/v1/users/${created.body.id}/roles`).set(bearer(admin)).send({ roleId }).expect(204);
  }
  return { id: created.body.id as string, token: await login(`${name}@example.com`, PASSWORD) };
}

const send = (method: 'post' | 'patch', path: string, token: string, body: Record<string, unknown>) =>
  request(http)[method](`/api/v1/scm/${path}`).set(bearer(token)).send(body);
const get = (path: string, token = buyer) => request(http).get(`/api/v1/scm/${path}`).set(bearer(token)).expect(200);

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  const buyers = await create('roles', { name: 'buyers', permissions: ['scm:read', 'scm:purchase'] });
  const managers = await create('roles', { name: 'store-managers', permissions: ['scm:read', 'scm:purchase'] });
  const directors = await create('roles', { name: 'directors', permissions: ['scm:read'] });
  const readers = await create('roles', { name: 'readers', permissions: ['scm:read'] });
  buyer = (await user('buyer', buyers)).token;
  manager = (await user('manager', managers)).token;
  director = (await user('director', directors)).token;
  const committeeUser = await user('committee', readers);
  const mdUser = await user('md', readers);
  committee = committeeUser.token;
  md = mdUser.token;
  plain = (await user('plain')).token;

  const division = await create('hr/divisions', { name: 'Administration' });
  const department = await create('hr/departments', { divisionId: division, name: 'Management' });
  const subDepartment = await create('hr/sub-departments', { departmentId: department, name: 'Office' });
  const designation = await create('hr/designations', { name: 'Officer' });
  const staff = (employeeNo: string, userId: string) =>
    create('hr/staff', {
      employeeNo,
      fullName: employeeNo,
      joiningDate: '2020-01-01',
      departmentId: department,
      subDepartmentId: subDepartment,
      designationId: designation,
      serviceNature: 'Permanent',
      salaryStatus: 'Regular',
      userId,
    });
  const committeeStaff = await staff('A-001', committeeUser.id);
  const mdStaff = await staff('A-002', mdUser.id);

  store = await create('scm/main-stores', { name: 'Central store' });
  const group = await create('scm/item-groups', { name: 'Surgical' });
  const subGroup = await create('scm/item-sub-groups', { groupId: group, name: 'Disposables' });
  const category = await create('scm/item-categories', { name: 'Consumables' });
  const subCategory = await create('scm/item-sub-categories', { categoryId: category, name: 'Medical' });
  const item = (name: string) =>
    create('scm/items', { name, subGroupId: subGroup, subCategoryId: subCategory, unit: 'Box' });
  gloves = await create('scm/item-variants', {
    itemId: await item('Gloves'),
    name: 'Sterile 7.5',
    purchasePrice: 1200,
  });
  masks = await create('scm/item-variants', {
    itemId: await item('Masks'),
    name: 'Surgical 3 ply',
    purchasePrice: 300,
  });
  const local = await create('scm/supplier-types', { name: 'Local' });
  aci = await create('scm/suppliers', { typeId: local, name: 'ACI Limited' });
  rahim = await create('scm/suppliers', { typeId: local, name: 'Rahim Traders' });

  await create('scm/purchase-approval-levels', {
    mainStoreId: store,
    levelOrder: 1,
    name: 'Store manager',
    roleId: managers,
  });
  await create('scm/purchase-approval-levels', {
    mainStoreId: store,
    levelOrder: 2,
    name: 'Director',
    roleId: directors,
  });
  await create('scm/cs-approval-levels', {
    levelOrder: 1,
    name: 'Purchase committee',
    approverStaffId: committeeStaff,
  });
  await create('scm/cs-approval-levels', {
    levelOrder: 2,
    name: 'Managing director',
    approverStaffId: mdStaff,
    isFinal: true,
  });
});

async function approvedRequisition(): Promise<string> {
  const created = await send('post', 'purchase-requisitions', buyer, {
    mainStoreId: store,
    supplierId: aci,
    requisitionDate: '2026-03-01',
    paymentTerm: 'credit',
    lines: [
      { variantId: gloves, requestedQty: 10 },
      { variantId: masks, requestedQty: 50, description: 'For OT' },
    ],
  }).expect(201);
  const id = created.body.id as string;
  await send('post', `purchase-requisitions/${id}/submit`, buyer, { version: 1 }).expect(204);
  await send('post', `purchase-requisitions/${id}/decision`, manager, {
    version: 2,
    decision: 'approve',
    quantities: [{ variantId: gloves, approvedQty: 8 }],
  }).expect(200);
  await send('post', `purchase-requisitions/${id}/decision`, director, { version: 3, decision: 'approve' }).expect(200);
  return id;
}

describe('purchase requisitions', () => {
  it('go through the main store approval levels, which may lower quantities', async () => {
    const created = await send('post', 'purchase-requisitions', buyer, {
      mainStoreId: store,
      requisitionDate: '2026-03-01',
      lines: [{ variantId: gloves, requestedQty: 10 }],
    }).expect(201);
    expect(created.body.number).toBe('PR-2026-00001');
    const id = created.body.id as string;
    await send('patch', `purchase-requisitions/${id}`, buyer, {
      version: 1,
      note: 'Quarterly stock',
      lines: [
        { variantId: gloves, requestedQty: 10 },
        { variantId: masks, requestedQty: 50 },
      ],
    }).expect(204);
    const stale = await send('post', `purchase-requisitions/${id}/submit`, buyer, { version: 1 }).expect(409);
    expect(stale.body.code).toBe('stale_requisition');
    await send('post', `purchase-requisitions/${id}/submit`, buyer, { version: 2 }).expect(204);

    expect((await get('purchase-requisitions/inbox', manager)).body.items).toMatchObject([
      { number: 'PR-2026-00001', currentLevelName: 'Store manager' },
    ]);
    expect((await get('purchase-requisitions/inbox', director)).body.items).toEqual([]);
    const early = await send('post', `purchase-requisitions/${id}/decision`, director, {
      version: 3,
      decision: 'approve',
    }).expect(403);
    expect(early.body.code).toBe('not_approver');
    const tooMuch = await send('post', `purchase-requisitions/${id}/decision`, manager, {
      version: 3,
      decision: 'approve',
      quantities: [{ variantId: masks, approvedQty: 60 }],
    }).expect(422);
    expect(tooMuch.body.code).toBe('approval_exceeds_request');
    await send('post', `purchase-requisitions/${id}/decision`, manager, {
      version: 3,
      decision: 'approve',
      remarks: 'Masks halved',
      quantities: [{ variantId: masks, approvedQty: 25 }],
    }).expect(200);
    const final = await send('post', `purchase-requisitions/${id}/decision`, director, {
      version: 4,
      decision: 'approve',
    }).expect(200);
    expect(final.body).toEqual({ status: 'approved' });

    const view = await get(`purchase-requisitions/${id}`);
    expect(view.body).toMatchObject({ status: 'approved', note: 'Quarterly stock', mainStoreName: 'Central store' });
    expect(
      view.body.lines.map((line: { variantName: string; approvedQty: number }) => [line.variantName, line.approvedQty]),
    ).toEqual([
      ['Sterile 7.5', 10],
      ['Surgical 3 ply', 25],
    ]);
    expect(
      view.body.decisions.map((decision: { levelName: string; remarks: string | null }) => [
        decision.levelName,
        decision.remarks,
      ]),
    ).toEqual([
      ['Store manager', 'Masks halved'],
      ['Director', null],
    ]);
    const listed = await get('purchase-requisitions?status=approved&q=00001');
    expect(listed.body).toMatchObject({ total: 1, items: [{ lineCount: 2, currentLevel: null }] });
  });

  it('can be rejected with a reason, and nobody approves their own', async () => {
    const own = await send('post', 'purchase-requisitions', manager, {
      mainStoreId: store,
      requisitionDate: '2026-03-02',
      lines: [{ variantId: masks, requestedQty: 5 }],
    }).expect(201);
    await send('post', `purchase-requisitions/${own.body.id}/submit`, manager, { version: 1 }).expect(204);
    const self = await send('post', `purchase-requisitions/${own.body.id}/decision`, manager, {
      version: 2,
      decision: 'approve',
    }).expect(403);
    expect(self.body.code).toBe('self_approval');

    const other = await send('post', 'purchase-requisitions', buyer, {
      mainStoreId: store,
      requisitionDate: '2026-03-02',
      lines: [{ variantId: masks, requestedQty: 5 }],
    }).expect(201);
    await send('post', `purchase-requisitions/${other.body.id}/submit`, buyer, { version: 1 }).expect(204);
    await send('post', `purchase-requisitions/${other.body.id}/decision`, manager, {
      version: 2,
      decision: 'reject',
    }).expect(422);
    await send('post', `purchase-requisitions/${other.body.id}/decision`, manager, {
      version: 2,
      decision: 'reject',
      remarks: 'Not budgeted',
    }).expect(200);
    await request(http)
      .delete(`/api/v1/scm/purchase-requisitions/${other.body.id}?version=3`)
      .set(bearer(buyer))
      .expect(422);

    const noLevels = await create('scm/main-stores', { name: 'Pharmacy store' });
    const orphan = await send('post', 'purchase-requisitions', buyer, {
      mainStoreId: noLevels,
      requisitionDate: '2026-03-02',
      lines: [{ variantId: masks, requestedQty: 5 }],
    }).expect(201);
    const refused = await send('post', `purchase-requisitions/${orphan.body.id}/submit`, buyer, { version: 1 }).expect(
      422,
    );
    expect(refused.body.code).toBe('no_approval_levels');
    await request(http)
      .delete(`/api/v1/scm/purchase-requisitions/${orphan.body.id}?version=1`)
      .set(bearer(buyer))
      .expect(204);

    const missing = await send('post', 'purchase-requisitions', buyer, {
      mainStoreId: store,
      requisitionDate: '2026-03-02',
      lines: [{ variantId: '00000000-0000-4000-8000-000000000000', requestedQty: 5 }],
    }).expect(404);
    expect(missing.body.code).toBe('item_variant_not_found');
    await send('post', 'purchase-requisitions', director, {
      mainStoreId: store,
      requisitionDate: '2026-03-02',
      lines: [{ variantId: masks, requestedQty: 5 }],
    }).expect(403);
    await request(http).get('/api/v1/scm/purchase-requisitions').set(bearer(plain)).expect(403);
  });
});

describe('comparative studies and purchase orders', () => {
  it('pick the winning supplier and order within the approved quantities', async () => {
    const requisition = await approvedRequisition();
    const study = await send('post', 'comparative-studies', buyer, {
      studyDate: '2026-03-03',
      requisitionId: requisition,
      title: 'Gloves and masks',
      quotes: [
        { supplierId: aci, variantId: gloves, qty: 8, unitPrice: 1250, vatPercent: 7.5 },
        { supplierId: rahim, variantId: gloves, qty: 8, unitPrice: 1180, vatPercent: 7.5, aitPercent: 2 },
        { supplierId: rahim, manualName: 'Local masks', qty: 50, unitPrice: 280 },
      ],
    }).expect(201);
    expect(study.body.number).toBe('CS-2026-00001');
    const id = study.body.id as string;
    await send('post', `comparative-studies/${id}/submit`, buyer, { version: 1 }).expect(204);
    const shown = await get(`comparative-studies/${id}`);
    const quoteIds = shown.body.quotes.map((quote: { id: string }) => quote.id) as string[];
    expect(shown.body.quotes[1]).toMatchObject({ supplierName: 'Rahim Traders', vat: 708, ait: 188.8, total: 10336.8 });
    expect((await get('comparative-studies/inbox', committee)).body.items).toMatchObject([{ number: 'CS-2026-00001' }]);
    expect((await get('comparative-studies/inbox', md)).body.items).toEqual([]);

    await send('post', `comparative-studies/${id}/decision`, md, {
      version: 2,
      decision: 'approve',
      keep: quoteIds,
    }).expect(403);
    await send('post', `comparative-studies/${id}/decision`, committee, {
      version: 2,
      decision: 'approve',
      keep: quoteIds.slice(0, 2),
    }).expect(200);
    const final = await send('post', `comparative-studies/${id}/decision`, md, {
      version: 3,
      decision: 'approve',
      keep: [quoteIds[1]],
    }).expect(200);
    expect(final.body).toEqual({ status: 'approved' });
    const approved = await get(`comparative-studies/${id}`);
    expect(approved.body.quotes.map((quote: { selected: boolean }) => quote.selected)).toEqual([false, true, false]);

    const order = (body: Record<string, unknown>) =>
      send('post', 'purchase-orders', buyer, {
        mainStoreId: store,
        requisitionId: requisition,
        comparativeStudyId: id,
        orderDate: '2026-03-04',
        ...body,
      });
    const loser = await order({ supplierId: aci, lines: [{ variantId: gloves, qty: 8, rate: 1250 }] }).expect(422);
    expect(loser.body.code).toBe('supplier_not_chosen');
    const over = await order({ supplierId: rahim, lines: [{ variantId: gloves, qty: 9, rate: 1180 }] }).expect(422);
    expect(over.body.code).toBe('order_exceeds_requisition');
    const first = await order({
      supplierId: rahim,
      expectedOn: '2026-03-10',
      lines: [{ variantId: gloves, qty: 5, rate: 1180, vatPercent: 7.5 }],
    }).expect(201);
    expect(first.body.number).toBe('PO-2026-00001');
    const second = await send('post', 'purchase-orders', buyer, {
      supplierId: aci,
      mainStoreId: store,
      requisitionId: requisition,
      orderDate: '2026-03-04',
      lines: [
        { variantId: gloves, qty: 3, rate: 1250 },
        { variantId: masks, qty: 50, rate: 300 },
      ],
    }).expect(201);
    const third = await send('post', 'purchase-orders', buyer, {
      supplierId: aci,
      mainStoreId: store,
      requisitionId: requisition,
      orderDate: '2026-03-04',
      lines: [{ variantId: gloves, qty: 1, rate: 1250 }],
    }).expect(422);
    expect(third.body.code).toBe('order_exceeds_requisition');

    const view = await get(`purchase-orders/${first.body.id}`);
    expect(view.body).toMatchObject({
      supplierName: 'Rahim Traders',
      requisitionId: requisition,
      comparativeStudyNumber: 'CS-2026-00001',
      status: 'open',
      amount: 5900,
      vat: 442.5,
      total: 6342.5,
      lines: [{ variantName: 'Sterile 7.5', qty: 5, receivedQty: 0, total: 6342.5 }],
    });
    const lines = await get(`purchase-requisitions/${requisition}`);
    expect(lines.body.lines.map((line: { orderedQty: number }) => line.orderedQty)).toEqual([8, 50]);
    const cancelRequisition = await send('post', `purchase-requisitions/${requisition}/cancel`, buyer, {
      version: 4,
    }).expect(422);
    expect(cancelRequisition.body.code).toBe('requisition_ordered');

    await send('patch', `purchase-orders/${second.body.id}`, buyer, {
      version: 1,
      lines: [{ variantId: gloves, qty: 3, rate: 1240 }],
    }).expect(204);
    await send('post', `purchase-orders/${second.body.id}/cancel`, buyer, { version: 1, reason: 'Late' }).expect(409);
    await send('post', `purchase-orders/${second.body.id}/cancel`, buyer, { version: 2, reason: 'Late' }).expect(204);
    const open = await get(`purchase-orders?requisitionId=${requisition}&status=open`);
    expect(open.body).toMatchObject({ total: 1, items: [{ number: 'PO-2026-00001', total: 6342.5 }] });
    await send('post', 'purchase-orders', buyer, {
      supplierId: aci,
      mainStoreId: store,
      orderDate: '2026-03-04',
      expectedOn: '2026-03-01',
      lines: [{ variantId: masks, qty: 1, rate: 1 }],
    }).expect(400);

    for (const [key, documentId] of [
      ['scm.purchase-requisition', requisition],
      ['scm.comparative-study', id],
      ['scm.purchase-order', first.body.id as string],
    ] as const) {
      const response = await request(http)
        .post(`/api/v1/reports/${key}/render`)
        .set(bearer(admin))
        .send({ format: 'pdf', params: { id: documentId } });
      expect(response.status, `${key}: ${JSON.stringify(response.body).slice(0, 200)}`).toBe(200);
    }
  });
});

describe('shortened constraint names', () => {
  it('still report the missing record', async () => {
    const missing = await request(http)
      .post('/api/v1/accounts/level4-heads')
      .set(bearer(admin))
      .send({ subCategoryId: '00000000-0000-4000-8000-000000000000', name: 'General' })
      .expect(404);
    expect(missing.body.code).toBe('account_sub_category_not_found');
  });
});
