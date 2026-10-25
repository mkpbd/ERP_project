import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let keeper: { userId: string; token: string };
let viewer: string;
let plain: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const MISSING = '00000000-0000-4000-8000-000000000000';

async function login(identifier: string, password: string): Promise<string> {
  const response = await request(http)
    .post('/api/v1/auth/login')
    .set('X-Refresh-Token-Delivery', 'body')
    .send({ identifier, password })
    .expect(200);
  return response.body.accessToken as string;
}

async function create(path: string, body: Record<string, unknown>, token = keeper.token): Promise<string> {
  const response = await request(http).post(`/api/v1/${path}`).set(bearer(token)).send(body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
  return response.body.id as string;
}

async function user(name: string, permissions: string[]): Promise<{ userId: string; token: string }> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  if (permissions.length > 0) {
    const role = await create('roles', { name: `role-${name}`, permissions }, admin);
    await request(http)
      .post(`/api/v1/users/${created.body.id}/roles`)
      .set(bearer(admin))
      .send({ roleId: role })
      .expect(204);
  }
  return { userId: created.body.id as string, token: await login(`${name}@example.com`, PASSWORD) };
}

const refused = async (path: string, body: Record<string, unknown>, status: number, code?: string) => {
  const response = await request(http).post(`/api/v1/${path}`).set(bearer(keeper.token)).send(body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(status);
  if (code) expect(response.body.code).toBe(code);
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
  keeper = await user('keeper', ['scm:read', 'scm:manage']);
  viewer = (await user('viewer', ['scm:read'])).token;
  plain = (await user('plain', [])).token;
});

describe('stores and store access', () => {
  it('keeps main stores, sub-stores, departments and who may indent or issue', async () => {
    const central = await create('scm/main-stores', { name: 'Central store' });
    await refused('scm/main-stores', { name: 'CENTRAL STORE' }, 409, 'main_store_name_taken');
    const ward = await create('scm/sub-stores', { mainStoreId: central, name: 'Ward store', description: '3rd floor' });
    await create('scm/sub-stores', { mainStoreId: central, name: 'OT store' });
    await refused('scm/sub-stores', { mainStoreId: MISSING, name: 'Lost' }, 404, 'main_store_not_found');
    const subStores = await request(http)
      .get(`/api/v1/scm/sub-stores?mainStoreId=${central}`)
      .set(bearer(viewer))
      .expect(200);
    expect(subStores.body.map((store: { name: string }) => store.name)).toEqual(['OT store', 'Ward store']);
    const inUse = await request(http).delete(`/api/v1/scm/main-stores/${central}`).set(bearer(keeper.token));
    expect(inUse.status).toBe(409);
    expect(inUse.body.code).toBe('main_store_in_use');

    const icu = await create('scm/departments', { name: 'ICU' });
    await create('scm/department-users', { departmentId: icu, userId: keeper.userId });
    await refused(
      'scm/department-users',
      { departmentId: icu, userId: keeper.userId },
      409,
      'store_department_user_exists',
    );
    await refused('scm/department-users', { departmentId: icu, userId: MISSING }, 404, 'user_not_found');
    await create('scm/department-store-access', { departmentId: icu, subStoreId: ward, userId: keeper.userId });
    await create('scm/issue-store-users', { subStoreId: ward, userId: keeper.userId });
    const mine = await request(http)
      .get(`/api/v1/scm/department-store-access?userId=${keeper.userId}`)
      .set(bearer(viewer))
      .expect(200);
    expect(mine.body).toMatchObject([{ departmentId: icu, subStoreId: ward }]);

    await request(http).get('/api/v1/scm/main-stores').set(bearer(plain)).expect(403);
    await request(http).post('/api/v1/scm/main-stores').set(bearer(viewer)).send({ name: 'X' }).expect(403);
  });
});

describe('item catalogue and suppliers', () => {
  it('builds items and variants under categories and groups, and keeps suppliers', async () => {
    const category = await create('scm/item-categories', { name: 'Consumables' });
    const subCategory = await create('scm/item-sub-categories', { categoryId: category, name: 'Stationery' });
    const group = await create('scm/item-groups', { name: 'Office supplies' });
    const subGroup = await create('scm/item-sub-groups', { groupId: group, name: 'Paper' });
    await refused('scm/item-sub-groups', { groupId: group, name: 'paper' }, 409, 'item_sub_group_name_taken');

    const paper = await create('scm/items', {
      name: 'A4 paper',
      subGroupId: subGroup,
      subCategoryId: subCategory,
      unit: 'Ream',
    });
    await refused(
      'scm/items',
      { name: 'Pen', subGroupId: MISSING, subCategoryId: subCategory, unit: 'Pcs' },
      404,
      'item_sub_group_not_found',
    );
    await refused(
      'scm/items',
      { name: 'Pen', subGroupId: subGroup, subCategoryId: subCategory, unit: 'Pcs', typeGlAccountId: MISSING },
      404,
      'gl_account_not_found',
    );
    await create('scm/item-variants', {
      itemId: paper,
      name: 'Double A 80gsm',
      code: 'pp-001',
      purchasePrice: 520,
      salePrice: 560.5,
      reorderLevel: 20,
    });
    await create('scm/item-variants', { itemId: paper, name: 'Bashundhara 70gsm', alternateName: 'Local A4' });
    await refused(
      'scm/item-variants',
      { itemId: paper, name: 'Other', code: 'PP-001' },
      409,
      'item_variant_code_taken',
    );
    await refused('scm/item-variants', { itemId: paper, name: 'Bad price', purchasePrice: -1 }, 400);
    const found = await request(http).get('/api/v1/scm/item-variants?q=local').set(bearer(viewer)).expect(200);
    expect(found.body).toMatchObject([{ name: 'Bashundhara 70gsm', purchasePrice: 0, expiryRequired: false }]);
    const byCode = await request(http).get('/api/v1/scm/item-variants?q=pp-0').set(bearer(viewer)).expect(200);
    expect(byCode.body).toMatchObject([{ name: 'Double A 80gsm', salePrice: 560.5, reorderLevel: 20 }]);
    const literal = await request(http).get('/api/v1/scm/item-variants?q=%25').set(bearer(viewer)).expect(200);
    expect(literal.body).toEqual([]);
    const inUse = await request(http).delete(`/api/v1/scm/item-groups/${group}`).set(bearer(keeper.token));
    expect(inUse.body.code).toBe('item_group_in_use');

    const role = await create('roles', { name: 'nurses', permissions: ['scm:read'] }, admin);
    await create('scm/role-group-restrictions', { roleId: role, groupId: group });
    await refused(
      'scm/role-group-restrictions',
      { roleId: role, groupId: group },
      409,
      'role_group_restriction_exists',
    );

    const local = await create('scm/supplier-types', { name: 'Local' });
    const partyType = await create('accounts/sub-ledger-types', { name: 'Suppliers' }, admin);
    const party = await create('accounts/sub-ledgers', { typeId: partyType, name: 'ACI Limited' }, admin);
    await create('scm/suppliers', {
      typeId: local,
      name: 'ACI Limited',
      contactNo: '01700000000',
      isEnlisted: true,
      enlistedOn: '2025-01-01',
      enlistmentExpiresOn: '2026-12-31',
      vatPercent: 7.5,
      taxPercent: 5,
      subLedgerId: party,
    });
    await create('scm/suppliers', { typeId: local, name: 'Rahim Traders' });
    await refused(
      'scm/suppliers',
      { typeId: local, name: 'Other', subLedgerId: party },
      409,
      'supplier_sub_ledger_taken',
    );
    await refused(
      'scm/suppliers',
      { typeId: local, name: 'Late', enlistedOn: '2025-01-01', enlistmentExpiresOn: '2024-01-01' },
      400,
    );
    await refused('scm/suppliers', { typeId: local, name: 'Greedy', vatPercent: 101 }, 400);
    const enlisted = await request(http).get('/api/v1/scm/suppliers?isEnlisted=true').set(bearer(viewer)).expect(200);
    expect(enlisted.body).toMatchObject([
      { name: 'ACI Limited', vatPercent: 7.5, enlistmentExpiresOn: '2026-12-31', subLedgerId: party },
    ]);
    const typed = await request(http).get('/api/v1/scm/suppliers?q=rahim').set(bearer(viewer)).expect(200);
    expect(typed.body).toMatchObject([{ name: 'Rahim Traders', isEnlisted: false, isActive: true }]);

    for (const [key, params] of [
      ['scm.item-catalogue', { groupId: group }],
      ['scm.suppliers', { enlistedOnly: true }],
    ] as const) {
      for (const format of ['pdf', 'xlsx']) {
        const response = await request(http)
          .post(`/api/v1/reports/${key}/render`)
          .set(bearer(admin))
          .send({ format, params });
        expect(response.status, `${key} ${format}: ${JSON.stringify(response.body).slice(0, 200)}`).toBe(200);
      }
    }
  });
});
