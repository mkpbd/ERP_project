import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let accountant: string;
let reader: string;
let plain: string;

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

async function create(path: string, body: Record<string, unknown>, token = accountant): Promise<string> {
  const response = await request(http).post(`/api/v1/accounts/${path}`).set(bearer(token)).send(body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
  return response.body.id as string;
}

async function user(name: string, permissions: string[]): Promise<string> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  if (permissions.length > 0) {
    const role = await request(http)
      .post('/api/v1/roles')
      .set(bearer(admin))
      .send({ name: `role-${name}`, permissions })
      .expect(201);
    await request(http)
      .post(`/api/v1/users/${created.body.id}/roles`)
      .set(bearer(admin))
      .send({ roleId: role.body.id })
      .expect(204);
  }
  return login(`${name}@example.com`, PASSWORD);
}

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  accountant = await user('accountant', ['accounts:read', 'accounts:manage']);
  reader = await user('reader', ['accounts:read']);
  plain = await user('plain', []);
});

describe('chart of accounts', () => {
  it('builds the hierarchy down to postable accounts with unique codes', async () => {
    const assets = await create('natures', {
      code: '1',
      name: 'Assets',
      statement: 'balance_sheet',
      normalBalance: 'debit',
    });
    await create('natures', { code: '4', name: 'Income', statement: 'profit_and_loss', normalBalance: 'credit' });
    const taken = await request(http)
      .post('/api/v1/accounts/natures')
      .set(bearer(accountant))
      .send({ code: '1', name: 'Again', statement: 'balance_sheet', normalBalance: 'debit' })
      .expect(409);
    expect(taken.body.code).toBe('account_nature_code_taken');

    const current = await create('categories', { natureId: assets, code: '11', name: 'Current assets' });
    const missing = await request(http)
      .post('/api/v1/accounts/categories')
      .set(bearer(accountant))
      .send({ natureId: '00000000-0000-4000-8000-000000000000', code: '12', name: 'Orphan' })
      .expect(404);
    expect(missing.body.code).toBe('account_nature_not_found');
    const cash = await create('sub-categories', { categoryId: current, name: 'Cash and bank' });
    const inHand = await create('level4-heads', { subCategoryId: cash, code: '1101', name: 'Cash' });
    const office = await create('level5-heads', { level4HeadId: inHand, code: '110101', name: 'Office cash' });
    const pettyCash = await create('gl-accounts', {
      level5HeadId: office,
      code: '11010101',
      name: 'Petty cash',
      kind: 'cash',
    });
    const bankGl = await create('gl-accounts', {
      level5HeadId: office,
      code: '11010102',
      name: 'Sonali Bank',
      kind: 'bank',
    });
    const dupe = await request(http)
      .post('/api/v1/accounts/gl-accounts')
      .set(bearer(accountant))
      .send({ level5HeadId: office, code: '11010101', name: 'Twin' })
      .expect(409);
    expect(dupe.body.code).toBe('gl_account_code_taken');

    const inUse = await request(http).delete(`/api/v1/accounts/natures/${assets}`).set(bearer(accountant)).expect(409);
    expect(inUse.body.code).toBe('account_nature_in_use');

    const bank = await create('bank-accounts', {
      bankName: 'Sonali Bank',
      branch: "Cox's Bazar",
      accountNo: '0001234',
      glAccountId: bankGl,
    });
    await create('pos-terminals', { name: 'Front desk POS', bankAccountId: bank });
    const broad = await create('statement-broad-heads', { name: 'Current assets' });
    const sub = await create('statement-sub-heads', { broadHeadId: broad, name: 'Cash and cash equivalents' });
    await create('gl-statement-mappings', { glAccountId: pettyCash, subHeadId: sub });
    await request(http)
      .post('/api/v1/accounts/gl-statement-mappings')
      .set(bearer(accountant))
      .send({ glAccountId: pettyCash, subHeadId: sub })
      .expect(409);
    const group = await create('account-groups', { name: 'Cash accounts' });
    await create('account-group-members', { groupId: group, glAccountId: pettyCash });
    const vendors = await create('sub-ledger-types', { name: 'Suppliers' });
    await create('sub-ledgers', { typeId: vendors, name: 'ACI Limited', mobileNo: '01700000000' });
    await create('journal-types', { shortName: 'JV', name: 'Journal voucher' });
    await create('voucher-types', { code: 'CPV', title: 'Cash payment voucher' });
    await create('cost-centers', { name: 'Pharmacy' });

    await create('fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
    const overlap = await request(http)
      .post('/api/v1/accounts/fiscal-years')
      .set(bearer(accountant))
      .send({ label: 'X', startsOn: '2026-01-01', endsOn: '2026-12-31' })
      .expect(409);
    expect(overlap.body.code).toBe('fiscal_year_overlaps');

    const chart = await request(http).get('/api/v1/accounts/chart').set(bearer(reader)).expect(200);
    expect(chart.body.natures.map((nature: { code: string }) => nature.code)).toEqual(['1', '4']);
    const leaf = chart.body.natures[0].children[0].children[0].children[0].children[0];
    expect(leaf).toMatchObject({ code: '110101', name: 'Office cash' });
    expect(leaf.children.map((account: { code: string }) => account.code)).toEqual(['11010101', '11010102']);

    const active = await request(http).get('/api/v1/accounts/gl-accounts?kind=bank').set(bearer(reader)).expect(200);
    expect(active.body).toHaveLength(1);
    await request(http)
      .post('/api/v1/accounts/cost-centers')
      .set(bearer(reader))
      .send({ name: 'Not allowed' })
      .expect(403);
    await request(http).get('/api/v1/accounts/chart').set(bearer(plain)).expect(403);

    for (const format of ['pdf', 'xlsx']) {
      const response = await request(http)
        .post('/api/v1/reports/accounts.chart-of-accounts/render')
        .set(bearer(admin))
        .send({ format, params: {} });
      expect(response.status, format).toBe(200);
    }
  });
});
