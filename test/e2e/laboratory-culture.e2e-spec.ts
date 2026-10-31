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
let rahima: string;
const test: Record<string, string> = {};
const master: Record<string, string> = {};

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
  const radiology = await create('hospital/diagnostic-departments', { name: 'Radiology', kind: 'imaging' }, manager);
  const add = (name: string, departmentId: string, rate: number) =>
    create('hospital/diagnostic-tests', { name, departmentId, rate, reportHours: 24 }, manager);
  test.urine = await add('Urine culture and sensitivity', pathology, 900);
  test.biopsy = await add('Histopathology (small biopsy)', pathology, 2500);
  test.xray = await add('X-ray chest PA', radiology, 600);
  rahima = (
    await request(http)
      .post('/api/v1/hospital/patients')
      .set(bearer(admin))
      .send({ fullName: 'Rahima Begum', sex: 'female', dateOfBirth: '1990-01-01', mobileNo: '01811000000' })
      .expect(201)
  ).body.id as string;

  // The culture masters and a template, kept by the lab manager.
  master.cipro = await create('lab/antibiotics', { name: 'Ciprofloxacin', groupName: 'Fluoroquinolones' }, manager);
  master.mero = await create('lab/antibiotics', { name: 'Meropenem', groupName: 'Carbapenems' }, manager);
  master.ecoli = await create('lab/organisms', { name: 'Escherichia coli' }, manager);
  master.kleb = await create('lab/organisms', { name: 'Klebsiella pneumoniae' }, manager);
  master.heavy = await create('lab/growth-types', { name: 'Heavy growth' }, manager);
  await create('lab/culture-messages', { text: 'Repeat the culture after the course of antibiotics.' }, manager);
  master.template = await create(
    'lab/report-templates',
    { name: 'Benign skin lesion', body: 'GROSS:\nOne grey-white skin piece.\n\nMICROSCOPY:\nNo malignancy seen.' },
    manager,
  );
});

describe('culture and written reports (step 15b)', () => {
  it('keeps the masters for the lab manager only, each name once', async () => {
    const twice = await request(http)
      .post('/api/v1/lab/antibiotics')
      .set(bearer(manager))
      .send({ name: 'Ciprofloxacin' });
    expect([twice.status, twice.body.code]).toEqual([409, 'antibiotic_name_taken']);
    expect((await request(http).post('/api/v1/lab/organisms').set(bearer(tech)).send({ name: 'Proteus' })).status).toBe(
      403,
    );
    const listed = await request(http).get('/api/v1/lab/antibiotics').set(bearer(tech)).expect(200);
    // Ordered by class.
    expect(listed.body.map((row: { name: string }) => row.name)).toEqual(['Meropenem', 'Ciprofloxacin']);
    const templates = await request(http).get('/api/v1/lab/report-templates?q=skin').set(bearer(tech)).expect(200);
    expect(templates.body[0].body).toContain('No malignancy seen.');
  });

  it('enters a culture and a written report, each verified by someone else, and prints them', async () => {
    // How each test is reported is set by the lab manager; imaging tests are not the lab's.
    expect((await lab('put', `tests/${test.urine}/form`, tech, { form: 'culture' })).status).toBe(403);
    await lab('put', `tests/${test.urine}/form`, manager, { form: 'culture' }).expect(204);
    await lab('put', `tests/${test.biopsy}/form`, manager, { form: 'descriptive' }).expect(204);
    expect((await lab('put', `tests/${test.xray}/form`, manager, { form: 'culture' })).body.code).toBe('not_lab_test');
    expect((await lab('get', `tests/${test.urine}/form`, tech).expect(200)).body).toEqual({ form: 'culture' });
    // Lab tests found by name with their form; the X-ray is not the lab's.
    const found = await lab('get', 'tests?q=a', tech).expect(200);
    expect(found.body.items.map((row: { name: string; form: string }) => [row.name, row.form]).sort()).toEqual([
      ['Histopathology (small biopsy)', 'descriptive'],
      ['Urine culture and sensitivity', 'culture'],
    ]);

    const billed = await request(http)
      .post('/api/v1/hospital/diagnostic-bills')
      .set(bearer(manager))
      .send({ patientId: rahima, testIds: [test.urine, test.biopsy, test.xray], payment: { amount: 4000 } })
      .expect(201);
    // The bill by its number, as the collector finds it: the lab's tests only, none in work yet.
    const order = await lab('get', `orders/${billed.body.number.toLowerCase()}`, collector).expect(200);
    expect(order.body).toMatchObject({ billId: billed.body.id, patientName: 'Rahima Begum' });
    expect(order.body.departments).toEqual([
      {
        departmentId: pathology,
        departmentName: 'Pathology',
        tests: [
          { line: 1, testName: 'Urine culture and sensitivity', inWork: false },
          { line: 2, testName: 'Histopathology (small biopsy)', inWork: false },
        ],
      },
    ]);
    expect((await lab('get', 'orders/NO-SUCH-BILL', collector)).status).toBe(404);
    const collected = await lab('post', 'samples', collector, {
      billId: billed.body.id,
      departmentId: pathology,
    }).expect(201);
    const inWork = await lab('get', `orders/${billed.body.number}`, collector).expect(200);
    expect(inWork.body.departments[0].tests.map((row: { inWork: boolean }) => row.inWork)).toEqual([true, true]);
    await lab('post', `samples/${collected.body.id}/receive`, tech, { version: 1 }).expect(200);
    const results = (await lab('get', `results?sampleId=${collected.body.id}`, tech).expect(200)).body.items as {
      id: string;
      testId: string;
    }[];
    const urine = results.find((row) => row.testId === test.urine)!.id;
    const biopsy = results.find((row) => row.testId === test.biopsy)!.id;

    // The worklist tells the form to enter each in; values are refused for a culture.
    const pending = await lab('get', `results/${urine}`, tech).expect(200);
    expect([pending.body.form, pending.body.template]).toEqual(['culture', []]);
    const asValues = await lab('put', `results/${urine}`, tech, {
      version: 1,
      values: [{ parameterId: master.cipro, value: '1' }],
    });
    expect([asValues.status, asValues.body.code]).toEqual([422, 'wrong_form']);

    const culture = {
      pusCells: '8-10 /HPF',
      epithelialCells: '2-4 /HPF',
      growth: true,
      growthTypeId: master.heavy,
      organismIds: [master.ecoli, master.kleb],
      colonyCount: '>10^5 CFU/ml',
      incubation: '48 hours at 37 °C',
      media: 'Blood agar, MacConkey agar',
      message: 'Repeat the culture after the course of antibiotics.',
      sensitivity: [
        { antibioticId: master.cipro, zone: '22', results: ['S', 'R'] },
        { antibioticId: master.mero, results: ['S', 'S'] },
      ],
    };
    const mismatched = await lab('put', `results/${urine}/culture`, tech, {
      ...culture,
      version: 1,
      sensitivity: [{ antibioticId: master.cipro, results: ['S'] }],
    });
    expect(mismatched.body.code).toBe('invalid_culture');
    const unknown = await lab('put', `results/${urine}/culture`, tech, {
      ...culture,
      version: 1,
      organismIds: [master.ecoli, master.cipro],
    });
    expect([unknown.status, unknown.body.code]).toEqual([422, 'invalid_culture']);
    await lab('put', `results/${urine}/culture`, tech, { ...culture, version: 1 }).expect(204);
    const entered = await lab('get', `results/${urine}`, tech).expect(200);
    expect(entered.body).toMatchObject({
      form: 'culture',
      status: 'entered',
      culture: {
        growth: true,
        growthType: 'Heavy growth',
        organisms: [
          { organismId: master.ecoli, name: 'Escherichia coli' },
          { organismId: master.kleb, name: 'Klebsiella pneumoniae' },
        ],
        sensitivity: [
          { antibiotic: 'Ciprofloxacin', zone: '22', results: ['S', 'R'] },
          { antibiotic: 'Meropenem', zone: null, results: ['S', 'S'] },
        ],
      },
    });

    // The written report: from the template, as written.
    const asCulture = await lab('put', `results/${biopsy}/culture`, tech, { ...culture, version: 1 });
    expect(asCulture.body.code).toBe('wrong_form');
    const template = (await request(http).get(`/api/v1/lab/report-templates/${master.template}`).set(bearer(tech))).body
      .body as string;
    await lab('put', `results/${biopsy}/text`, tech, {
      version: 1,
      narrative: `${template}\r\n\r\nDIAGNOSIS:\nSeborrhoeic keratosis.   `,
    }).expect(204);
    const written = await lab('get', `results/${biopsy}`, tech).expect(200);
    expect(written.body.narrative).toBe(`${template}\n\nDIAGNOSIS:\nSeborrhoeic keratosis.`);

    // Verified by the pathologist, not by who entered them.
    expect((await lab('post', `results/${urine}/verify`, tech, { version: 2 })).status).toBe(403);
    await lab('post', `results/${urine}/verify`, pathologist, { version: 2 }).expect(204);
    await lab('post', `results/${biopsy}/verify`, pathologist, { version: 2 }).expect(204);
    const corrected = await lab('put', `results/${biopsy}/text`, tech, { version: 3, narrative: 'Changed' });
    expect(corrected.body.code).toBe('result_state');

    const sample = (await lab('get', `samples/${collected.body.id}`, tech).expect(200)).body;
    expect(sample.results.map((row: { form: string }) => row.form).sort()).toEqual(['culture', 'descriptive']);
    const pdf = await request(http)
      .post('/api/v1/reports/laboratory.lab-report/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { sampleId: collected.body.id } });
    expect(pdf.status).toBe(200);
  });

  it('enters no growth without organisms or an antibiogram', async () => {
    await lab('put', `tests/${test.urine}/form`, manager, { form: 'culture' }).expect(204);
    const billed = await request(http)
      .post('/api/v1/hospital/diagnostic-bills')
      .set(bearer(manager))
      .send({ patientId: rahima, testIds: [test.urine], payment: { amount: 900 } })
      .expect(201);
    const collected = await lab('post', 'samples', collector, {
      billId: billed.body.id,
      departmentId: pathology,
    }).expect(201);
    await lab('post', `samples/${collected.body.id}/receive`, tech, { version: 1 }).expect(200);
    const [result] = (await lab('get', `results?sampleId=${collected.body.id}`, tech).expect(200)).body.items;
    const withOrganism = await lab('put', `results/${result.id}/culture`, tech, {
      version: 1,
      growth: false,
      organismIds: [master.ecoli],
    });
    expect(withOrganism.body.code).toBe('invalid_culture');
    await lab('put', `results/${result.id}/culture`, tech, { version: 1, growth: false, pusCells: 'Nil' }).expect(204);
    const entered = await lab('get', `results/${result.id}`, tech).expect(200);
    expect(entered.body.culture).toMatchObject({ growth: false, organisms: [], sensitivity: [], pusCells: 'Nil' });
  });
});
