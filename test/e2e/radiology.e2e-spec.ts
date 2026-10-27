import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let manager: string;
let tech: string;
let radiologist: string;
let doctor: string;
let rahima: string;
const test: Record<string, string> = {};
const gl: Record<string, string> = {};

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

const closing = async (account: string) =>
  (
    await request(http)
      .get(`/api/v1/accounts/books/ledger?glAccountId=${gl[account]}&from=${today}&to=${today}`)
      .set(bearer(admin))
      .expect(200)
  ).body.closing as number;

const lab = (method: 'get' | 'post' | 'put', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/lab/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const owed = async () =>
  (
    await request(http)
      .get(`/api/v1/hospital/doctors/${doctor}/ledger?from=${today}&to=${today}`)
      .set(bearer(admin))
      .expect(200)
  ).body as { earned: number; reversed: number; closing: number };

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  manager = await user('manager', ['diag:read', 'diag:manage', 'diag:bill', 'lab:read', 'lab:manage', 'lab:result']);
  tech = await user('tech', ['lab:read', 'lab:result']);
  radiologist = await user('radiologist', ['lab:read', 'lab:result', 'lab:verify']);

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, role] of [
    ['receivable', '1', 'debit', '1250', 'Diagnostic receivable', 'diagnostic_receivable'],
    ['payable', '2', 'credit', '2201', 'Consultants payable', 'consultant_payable'],
    ['income', '4', 'credit', '4401', 'Diagnostic income', 'diagnostic_income'],
    ['fee', '5', 'debit', '5403', 'Reporting fees', 'reporting_fee_expense'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role, glAccountId: gl[key] });
  }

  const pathology = await create('hospital/diagnostic-departments', { name: 'Pathology' }, manager);
  const radiology = await create('hospital/diagnostic-departments', { name: 'Radiology', kind: 'imaging' }, manager);
  test.xray = await create(
    'hospital/diagnostic-tests',
    { name: 'X-ray chest PA', departmentId: radiology, rate: 600, reportHours: 2, reportingFeePercent: 25 },
    manager,
  );
  test.cbc = await create(
    'hospital/diagnostic-tests',
    { name: 'Complete blood count', departmentId: pathology, rate: 400 },
    manager,
  );
  doctor = await create('hospital/doctors', { name: 'Dr. Radiologist' });
  rahima = (
    await request(http)
      .post('/api/v1/hospital/patients')
      .set(bearer(admin))
      .send({ fullName: 'Rahima Begum', sex: 'female', dateOfBirth: '1990-01-01', mobileNo: '01811000000' })
      .expect(201)
  ).body.id as string;
});

describe('radiology', () => {
  it('marks a study done, writes and signs its report with the reporting fee, and hands it over once paid', async () => {
    const templates = {
      templates: [{ name: 'Normal chest', findings: 'Both lung fields are clear.', impression: 'Normal chest X-ray.' }],
    };
    expect((await lab('put', `tests/${test.cbc}/imaging-templates`, manager, templates)).body.code).toBe(
      'not_imaging_test',
    );
    await lab('put', `tests/${test.xray}/imaging-templates`, manager, templates).expect(204);
    const bill = (
      await request(http)
        .post('/api/v1/hospital/diagnostic-bills')
        .set(bearer(manager))
        .send({ patientId: rahima, testIds: [test.xray, test.cbc] })
        .expect(201)
    ).body as { id: string; number: string };

    const done = await lab('post', 'imaging-studies', tech, { billId: bill.id, line: 1 }).expect(201);
    expect(done.body.accessionNumber).toBe(`AC-${labDay}-0001`);
    expect((await lab('post', 'imaging-studies', tech, { billId: bill.id, line: 1 })).body.code).toBe('already_done');
    expect((await lab('post', 'imaging-studies', tech, { billId: bill.id, line: 2 })).body.code).toBe(
      'not_imaging_test',
    );
    const id = done.body.id as string;

    const opened = await lab('get', `imaging-studies/${id}`, tech).expect(200);
    expect(opened.body).toMatchObject({ billNumber: bill.number, testName: 'X-ray chest PA', status: 'done' });
    const [template] = opened.body.templates as { findings: string; impression: string }[];
    expect((await lab('post', `imaging-studies/${id}/sign`, radiologist, { version: 1 })).body.code).toBe(
      'report_incomplete',
    );
    await lab('put', `imaging-studies/${id}/report`, tech, {
      version: 1,
      findings: template!.findings,
      impression: template!.impression,
      radiologistId: doctor,
    }).expect(204);

    // Signed by the radiologist: 25 % of 600 to her ledger.
    expect((await lab('post', `imaging-studies/${id}/sign`, tech, { version: 2 })).status).toBe(403);
    const signed = await lab('post', `imaging-studies/${id}/sign`, radiologist, { version: 2 }).expect(200);
    expect(signed.body).toEqual({ reportingFee: 150 });
    expect(await owed()).toMatchObject({ earned: 150, closing: 150 });
    const pdf = await request(http)
      .post('/api/v1/reports/laboratory.imaging-report/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { studyId: id } });
    expect(pdf.status).toBe(200);

    // A correction: the signature and the fee come back, then signed again.
    await lab('post', `imaging-studies/${id}/unsign`, radiologist, { version: 3 }).expect(200);
    expect(await owed()).toMatchObject({ earned: 150, reversed: 150, closing: 0 });
    await lab('put', `imaging-studies/${id}/report`, tech, {
      version: 4,
      findings: 'Both lung fields are clear. Heart size normal.',
      impression: 'Normal chest X-ray.',
      radiologistId: doctor,
    }).expect(204);
    await lab('post', `imaging-studies/${id}/sign`, radiologist, { version: 5 }).expect(200);
    expect([await closing('fee'), await closing('payable')]).toEqual([150, -150]);

    // The bill is unpaid: held for the technologist, let go by a manager.
    const held = await lab('post', `imaging-studies/${id}/deliver`, tech, { version: 6, to: 'Patient' });
    expect([held.status, held.body.code]).toEqual([403, 'due_outstanding']);
    await lab('post', `imaging-studies/${id}/deliver`, manager, { version: 6, to: 'Her husband' }).expect(200);
    expect((await lab('post', `imaging-studies/${id}/unsign`, radiologist, { version: 7 })).body.code).toBe(
      'study_state',
    );
    const listed = await lab('get', `imaging-studies?radiologistId=${doctor}`, tech).expect(200);
    expect(listed.body.items[0]).toMatchObject({ status: 'delivered', radiologistName: 'Dr. Radiologist' });
  });
});
