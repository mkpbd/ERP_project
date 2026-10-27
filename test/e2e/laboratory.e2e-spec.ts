import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let manager: string;
let collector: string;
let tech: string;
let pathologist: string;
let pathology: string;
let radiology: string;
let rahima: string;
const test: Record<string, string> = {};

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
const labDay = `${today.slice(2, 4)}${today.slice(5, 7)}${today.slice(8, 10)}`;

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

async function user(name: string, displayName: string, permissions: string[]): Promise<string> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName })
    .expect(201);
  const role = await create('roles', { name: `role-${name}`, permissions });
  await request(http)
    .post(`/api/v1/users/${created.body.id}/roles`)
    .set(bearer(admin))
    .send({ roleId: role })
    .expect(204);
  return login(`${name}@example.com`, PASSWORD);
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
const bill = async (testIds: string[], paid: number) =>
  (
    await request(http)
      .post('/api/v1/hospital/diagnostic-bills')
      .set(bearer(manager))
      .send({ patientId: rahima, testIds, payment: { amount: paid } })
      .expect(201)
  ).body as { id: string; number: string; due: number };
const sampleOf = async (id: string) => (await lab('get', `samples/${id}`, tech).expect(200)).body;

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  manager = await user('manager', 'Manager Mitu', ['diag:read', 'diag:manage', 'diag:bill', 'lab:read', 'lab:manage']);
  collector = await user('collector', 'Collector Joba', ['lab:read', 'lab:collect']);
  tech = await user('tech', 'Technologist Rana', ['lab:read', 'lab:result']);
  pathologist = await user('pathologist', 'Dr. Pathologist', ['lab:read', 'lab:result', 'lab:verify']);

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [nature, balance, code, name, role] of [
    ['1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['1', 'debit', '1250', 'Diagnostic receivable', 'diagnostic_receivable'],
    ['4', 'credit', '4401', 'Diagnostic income', 'diagnostic_income'],
  ] as const) {
    await create('accounts/gl-roles', { role, glAccountId: await glAccount(nature, balance, code, name) });
  }

  pathology = await create('hospital/diagnostic-departments', { name: 'Pathology' }, manager);
  radiology = await create('hospital/diagnostic-departments', { name: 'Radiology', kind: 'imaging' }, manager);
  const add = (name: string, departmentId: string, rate: number) =>
    create('hospital/diagnostic-tests', { name, departmentId, rate, reportHours: 4 }, manager);
  test.cbc = await add('Complete blood count', pathology, 400);
  test.lipid = await add('Lipid profile', pathology, 800);
  test.xray = await add('X-ray chest PA', radiology, 600);
  rahima = (
    await request(http)
      .post('/api/v1/hospital/patients')
      .set(bearer(admin))
      .send({ fullName: 'Rahima Begum', sex: 'female', dateOfBirth: '1990-01-01', mobileNo: '01811000000' })
      .expect(201)
  ).body.id as string;

  const adult = 18 * 365;
  const cbc = {
    parameters: [
      {
        name: 'Haemoglobin',
        unit: 'g/dL',
        decimals: 1,
        ranges: [
          { sex: 'male', minAgeDays: adult, low: 13, high: 17 },
          { sex: 'female', minAgeDays: adult, low: 12, high: 15 },
        ],
      },
      { name: 'WBC count', unit: '/cumm', ranges: [{ low: 4000, high: 11000 }] },
    ],
  };
  expect((await lab('put', `tests/${test.cbc}/parameters`, collector, cbc)).status).toBe(403);
  await lab('put', `tests/${test.cbc}/parameters`, manager, cbc).expect(204);
  const notLab = await lab('put', `tests/${test.xray}/parameters`, manager, cbc);
  expect(notLab.body.code).toBe('not_lab_test');
});

describe('the laboratory', () => {
  it('collects, takes in, enters, verifies, prints and hands over, holding the report while the patient owes', async () => {
    const billed = await bill([test.cbc!, test.lipid!, test.xray!], 1000);
    expect(billed.due).toBe(800);
    const collected = await lab('post', 'samples', collector, { billId: billed.id, departmentId: pathology }).expect(
      201,
    );
    expect(collected.body).toMatchObject({ labNumber: `LB-${labDay}-0001`, tests: 2 });
    const again = await lab('post', 'samples', collector, { billId: billed.id, departmentId: pathology });
    expect(again.body.code).toBe('nothing_to_collect');
    const imaging = await lab('post', 'samples', collector, { billId: billed.id, departmentId: radiology });
    expect(imaging.body.code).toBe('nothing_to_collect');

    const sample = await sampleOf(collected.body.id);
    expect(sample).toMatchObject({ billNumber: billed.number, patientName: 'Rahima Begum', status: 'collected' });
    const [cbc, lipid] = sample.results as { id: string; testName: string }[];
    expect([cbc!.testName, lipid!.testName]).toEqual(['Complete blood count', 'Lipid profile']);

    // Her ranges are a woman's; values only once the lab has the sample.
    const form = await lab('get', `results/${cbc!.id}`, tech).expect(200);
    expect(form.body.template.map((row: { name: string; low: number }) => [row.name, row.low])).toEqual([
      ['Haemoglobin', 12],
      ['WBC count', 4000],
    ]);
    const values = (hb: string, version: number) => ({
      version,
      values: form.body.template.map((row: { parameterId: string; name: string }) => ({
        parameterId: row.parameterId,
        value: row.name === 'Haemoglobin' ? hb : '7000',
      })),
    });
    expect((await lab('put', `results/${cbc!.id}`, tech, values('10.4', 1))).body.code).toBe('sample_state');
    await lab('post', `samples/${collected.body.id}/receive`, tech, { version: 1 }).expect(200);
    await lab('put', `results/${cbc!.id}`, tech, values('10.4', 1)).expect(204);
    const entered = await lab('get', `results/${cbc!.id}`, tech).expect(200);
    expect(
      entered.body.values.map((value: { value: string; flag: string | null }) => [value.value, value.flag]),
    ).toEqual([
      ['10.4', 'low'],
      ['7000', null],
    ]);
    expect((await lab('put', `results/${lipid!.id}`, tech, { version: 1, values: [] })).status).toBe(400);
    const noTemplate = await lab('put', `results/${lipid!.id}`, tech, {
      version: 1,
      values: [{ parameterId: cbc!.id, value: '1' }],
    });
    expect(noTemplate.body.code).toBe('no_template');

    // Verified by someone else, never by who entered it.
    expect((await lab('post', `results/${cbc!.id}/verify`, tech, { version: 2 })).status).toBe(403);
    await lab('put', `results/${cbc!.id}`, pathologist, values('10.6', 2)).expect(204);
    const self = await lab('post', `results/${cbc!.id}/verify`, pathologist, { version: 3 });
    expect([self.status, self.body.code]).toEqual([403, 'same_person']);
    await lab('put', `results/${cbc!.id}`, tech, values('10.6', 3)).expect(204);
    await lab('post', `results/${cbc!.id}/verify`, pathologist, { version: 4 }).expect(204);

    const pdf = await request(http)
      .post('/api/v1/reports/laboratory.lab-report/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { sampleId: collected.body.id } });
    expect(pdf.status).toBe(200);

    // She owes 800: the report waits until it is paid (or a manager lets it go).
    const held = await lab('post', `samples/${collected.body.id}/deliver`, tech, { version: 2, to: 'Patient' });
    expect([held.status, held.body.code]).toEqual([403, 'due_outstanding']);
    await request(http)
      .post(`/api/v1/hospital/diagnostic-bills/${billed.id}/collections`)
      .set(bearer(manager))
      .send({ version: 1, amount: 800 })
      .expect(201);
    const handed = await lab('post', `samples/${collected.body.id}/deliver`, tech, {
      version: 2,
      to: 'Patient',
    }).expect(200);
    expect(handed.body).toEqual({ results: 1 });
    const done = await lab('get', `results/${cbc!.id}`, tech).expect(200);
    expect(done.body).toMatchObject({ status: 'delivered', deliveredTo: 'Patient' });
    expect((await lab('post', `results/${cbc!.id}/unverify`, pathologist, { version: 6 })).body.code).toBe(
      'result_state',
    );
    const pending = await lab('get', 'results?status=pending', tech).expect(200);
    expect(pending.body.items.map((row: { testName: string }) => row.testName)).toEqual(['Lipid profile']);
  });

  it('collects a rejected sample again under a new lab number', async () => {
    const billed = await bill([test.cbc!], 400);
    const first = await lab('post', 'samples', collector, { billId: billed.id, departmentId: pathology }).expect(201);
    await lab('post', `samples/${first.body.id}/receive`, tech, { version: 1 }).expect(200);
    const rejected = await lab('post', `samples/${first.body.id}/reject`, tech, {
      version: 2,
      reason: 'Haemolysed',
    }).expect(200);
    expect(rejected.body).toEqual({ results: 1 });
    expect((await sampleOf(first.body.id)).status).toBe('rejected');
    const second = await lab('post', 'samples', collector, { billId: billed.id, departmentId: pathology }).expect(201);
    expect(second.body).toMatchObject({ labNumber: `LB-${labDay}-0002`, tests: 1 });
    const unready = await request(http)
      .post('/api/v1/reports/laboratory.lab-report/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { sampleId: second.body.id } });
    expect(unready.body.code).toBe('not_verified');
  });
});
