import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let manager: string;
let tech: string;
let pathologist: string;
let pathology: string;
let cbc: string;
let rahima: string;
let labStore: string;
let kit: string;
let tube: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const year = Number(today.slice(0, 4));
const fiscal = Number(today.slice(5, 7)) >= 7 ? year : year - 1;

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

async function glAccount(nature: string, normalBalance: string, code: string, name: string) {
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
  return create('accounts/gl-accounts', { level5HeadId: head5, code, name });
}

const lab = (method: 'get' | 'post' | 'put', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/lab/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const held = async (variantId: string) =>
  ((
    await request(http)
      .get(`/api/v1/scm/stock?departmentId=${labStore}&variantId=${variantId}`)
      .set(bearer(admin))
      .expect(200)
  ).body.items[0]?.qty as number | undefined) ?? 0;

/** A CBC billed, collected, taken in, entered and verified; returns its result. */
async function verifiedCbc(): Promise<{ id: string; version: number }> {
  const bill = (
    await request(http)
      .post('/api/v1/hospital/diagnostic-bills')
      .set(bearer(manager))
      .send({ patientId: rahima, testIds: [cbc], payment: { amount: 400 } })
      .expect(201)
  ).body as { id: string };
  const sample = await lab('post', 'samples', tech, { billId: bill.id, departmentId: pathology }).expect(201);
  await lab('post', `samples/${sample.body.id}/receive`, tech, { version: 1 }).expect(200);
  const [result] = (await lab('get', `samples/${sample.body.id}`, tech).expect(200)).body.results as { id: string }[];
  const form = await lab('get', `results/${result!.id}`, tech).expect(200);
  await lab('put', `results/${result!.id}`, tech, {
    version: 1,
    values: [{ parameterId: form.body.template[0].parameterId, value: '13.1' }],
  }).expect(204);
  await lab('post', `results/${result!.id}/verify`, pathologist, { version: 2 }).expect(204);
  return { id: result!.id, version: 3 };
}

async function sheet(key: string, params: Record<string, unknown>): Promise<unknown[][]> {
  const result = await request(http)
    .post(`/api/v1/reports/${key}/render`)
    .set(bearer(admin))
    .send({ format: 'xlsx', params })
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(result.body as Buffer).buffer);
  const rows = (workbook.worksheets[0]!.getSheetValues() as unknown[][]).filter(Boolean).map((row) =>
    Array.from(row)
      .slice(1)
      .map((value) => value ?? null),
  );
  return rows.slice(rows.findIndex((row) => row[0] === 'Item') + 1);
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
  manager = (await user('manager', ['diag:read', 'diag:manage', 'diag:bill', 'lab:read', 'lab:manage'])).token;
  tech = (await user('tech', ['lab:read', 'lab:collect', 'lab:result'])).token;
  pathologist = (await user('pathologist', ['lab:read', 'lab:verify'])).token;
  const keeper = await user('keeper', ['scm:read', 'scm:issue']);

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [nature, balance, code, name, role] of [
    ['1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['1', 'debit', '1250', 'Diagnostic receivable', 'diagnostic_receivable'],
    ['1', 'debit', '1300', 'Store inventory', 'store_inventory'],
    ['4', 'credit', '4401', 'Diagnostic income', 'diagnostic_income'],
  ] as const) {
    await create('accounts/gl-roles', { role, glAccountId: await glAccount(nature, balance, code, name) });
  }

  // The lab's store: two kits and ten tubes issued to it.
  const main = await create('scm/main-stores', { name: 'Central store' });
  const sub = await create('scm/sub-stores', { mainStoreId: main, name: 'Lab store' });
  labStore = await create('scm/departments', { name: 'Laboratory' });
  await create('scm/issue-store-users', { subStoreId: sub, userId: keeper.id });
  const group = await create('scm/item-groups', { name: 'Laboratory' });
  const subGroup = await create('scm/item-sub-groups', { groupId: group, name: 'Reagents' });
  const category = await create('scm/item-categories', { name: 'Consumables' });
  const subCategory = await create('scm/item-sub-categories', { categoryId: category, name: 'Medical' });
  const item = (name: string, unit: string) =>
    create('scm/items', { name, subGroupId: subGroup, subCategoryId: subCategory, unit });
  kit = await create('scm/item-variants', { itemId: await item('Haematology reagent', 'Kit'), name: 'CBC kit' });
  tube = await create('scm/item-variants', { itemId: await item('Vacutainer', 'Piece'), name: 'EDTA 3 ml' });
  await create('scm/opening-stock', {
    subStoreId: sub,
    openedOn: today,
    lines: [
      { variantId: kit, qty: 2, unitCost: 500 },
      { variantId: tube, qty: 10, unitCost: 8 },
    ],
  });
  await create(
    'scm/store-issues',
    {
      subStoreId: sub,
      departmentId: labStore,
      issueDate: today,
      lines: [
        { variantId: kit, qty: 2 },
        { variantId: tube, qty: 10 },
      ],
    },
    keeper.token,
  );

  pathology = await create('hospital/diagnostic-departments', { name: 'Pathology' }, manager);
  cbc = await create(
    'hospital/diagnostic-tests',
    { name: 'Complete blood count', departmentId: pathology, rate: 400 },
    manager,
  );
  await lab('put', `tests/${cbc}/parameters`, manager, {
    parameters: [{ name: 'Haemoglobin', unit: 'g/dL', decimals: 1, ranges: [{ low: 12, high: 17 }] }],
  }).expect(204);
  rahima = (
    await request(http)
      .post('/api/v1/hospital/patients')
      .set(bearer(admin))
      .send({ fullName: 'Rahima Begum', sex: 'female', dateOfBirth: '1990-01-01', mobileNo: '01811000000' })
      .expect(201)
  ).body.id as string;
});

describe('lab reagents', () => {
  it("uses up each test's reagents from the lab store once when verified, and marks a shortfall without holding the report", async () => {
    const missing = await lab('put', `tests/${cbc}/reagents`, manager, {
      reagents: [{ variantId: pathology, qty: 1 }],
    });
    expect(missing.status).toBe(404);
    await lab('put', `tests/${cbc}/reagents`, manager, {
      reagents: [
        { variantId: kit, qty: 1 },
        { variantId: tube, qty: 1 },
      ],
    }).expect(204);
    const recipe = (await lab('get', `tests/${cbc}/reagents`, tech).expect(200)).body.items as {
      name: string;
      unit: string;
      qty: number;
    }[];
    expect(recipe.map((line) => [line.name, line.unit, line.qty]).sort()).toEqual([
      ['Haematology reagent — CBC kit', 'Kit', 1],
      ['Vacutainer — EDTA 3 ml', 'Piece', 1],
    ]);

    // Without a store for pathology, nothing is used up.
    const unset = await verifiedCbc();
    expect((await lab('get', `results/${unset.id}`, tech).expect(200)).body.reagents).toBeNull();
    await lab('put', 'stock-departments', manager, {
      departments: [{ diagnosticDepartmentId: pathology, storeDepartmentId: labStore }],
    }).expect(204);
    expect((await lab('get', 'stock-departments', tech).expect(200)).body.items).toEqual([
      expect.objectContaining({ diagnosticDepartmentName: 'Pathology', storeDepartmentName: 'Laboratory' }),
    ]);

    const first = await verifiedCbc();
    expect((await lab('get', `results/${first.id}`, tech).expect(200)).body.reagents).toBe('used');
    expect([await held(kit), await held(tube)]).toEqual([1, 9]);
    // A correction verified again uses nothing more.
    await lab('post', `results/${first.id}/unverify`, pathologist, { version: first.version }).expect(204);
    await lab('post', `results/${first.id}/verify`, pathologist, { version: first.version + 1 }).expect(204);
    expect([await held(kit), await held(tube)]).toEqual([1, 9]);

    await verifiedCbc();
    expect([await held(kit), await held(tube)]).toEqual([0, 8]);
    // The store is out of kits: the report is not held, the use is kept as short.
    const short = await verifiedCbc();
    expect((await lab('get', `results/${short.id}`, tech).expect(200)).body).toMatchObject({
      status: 'verified',
      reagents: 'short',
    });
    expect([await held(kit), await held(tube)]).toEqual([0, 8]);

    const usage = await sheet('laboratory.reagent-usage', { from: today, to: today });
    expect(usage.map((row) => [row[0], row[2], row[3], row[4]])).toEqual([
      ['Haematology reagent — CBC kit', 3, 2, 1],
      ['Vacutainer — EDTA 3 ml', 3, 2, 1],
    ]);
    const consumptions = await request(http)
      .get(`/api/v1/scm/department-consumptions?departmentId=${labStore}`)
      .set(bearer(admin))
      .expect(200);
    expect(consumptions.body.total).toBe(2);
  });
});
