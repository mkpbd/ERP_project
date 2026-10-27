import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let manager: string;
let cashier: string;
let rafiq: string;
let mitu: string;
let acme: string;
let rahima: string;
let karim: string;
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

const api = (method: 'get' | 'post' | 'put', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/hospital/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};

async function sheet(key: string, params: Record<string, unknown>): Promise<unknown[][]> {
  await request(http)
    .post(`/api/v1/reports/${key}/render`)
    .set(bearer(admin))
    .send({ format: 'pdf', params })
    .expect(200);
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
  return (workbook.worksheets[0]!.getSheetValues() as unknown[][]).filter(Boolean).map((row) =>
    Array.from(row)
      .slice(1)
      .map((value) => value ?? null),
  );
}

const patient = async (fullName: string, mobileNo: string, extra: Record<string, unknown> = {}) =>
  (
    await api('post', 'patients', admin, {
      fullName,
      sex: 'female',
      dateOfBirth: '1990-01-01',
      mobileNo,
      ...extra,
    }).expect(201)
  ).body.id as string;

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  manager = await user('manager', [
    'diag:read',
    'diag:manage',
    'diag:bill',
    'diag:discount',
    'opd:read',
    'opd:manage',
    'opd:bill',
  ]);
  cashier = await user('cashier', ['diag:read', 'diag:bill', 'opd:read', 'opd:bill']);

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, role] of [
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['receivable', '1', 'debit', '1250', 'Diagnostic receivable', 'diagnostic_receivable'],
    ['corporate', '1', 'debit', '1230', 'Corporate receivable', 'corporate_receivable'],
    ['payable', '2', 'credit', '2201', 'Consultants payable', 'consultant_payable'],
    ['income', '4', 'credit', '4401', 'Diagnostic income', 'diagnostic_income'],
    ['discount', '5', 'debit', '5401', 'Diagnostic discount', 'diagnostic_discount'],
    ['commission', '5', 'debit', '5402', 'Referral commission', 'referral_commission_expense'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role, glAccountId: gl[key] });
  }

  const pathology = await create('hospital/diagnostic-departments', { name: 'Pathology' }, manager);
  const radiology = await create('hospital/diagnostic-departments', { name: 'Radiology', kind: 'imaging' }, manager);
  expect((await api('post', 'diagnostic-departments', cashier, { name: 'ECG' })).status).toBe(403);
  const add = (name: string, body: Record<string, unknown>) =>
    create('hospital/diagnostic-tests', { name, ...body }, manager);
  test.cbc = await add('Complete blood count', {
    code: 'CBC',
    departmentId: pathology,
    specimen: 'Blood',
    roomNo: '101',
    rate: 400,
    reportHours: 6,
    referralPercent: 20,
  });
  test.xray = await add('X-ray chest PA', {
    departmentId: radiology,
    roomNo: 'R2',
    rate: 600,
    reportHours: 2,
    referralPercent: 10,
  });
  test.tube = await add('Vacutainer tube', {
    departmentId: pathology,
    rate: 20,
    discountAllowed: false,
    referralPercent: 0,
  });
  test.widal = await add('Widal test', { departmentId: pathology, rate: 400, reportHours: 24 });
  rafiq = await create('hospital/doctors', { name: 'Dr. Rafiq' }, manager);
  mitu = await create('hospital/doctors', { name: 'Dr. Mitu', referralPercent: 30 }, manager);
  acme = await create('hospital/corporate-clients', { name: 'Acme Ltd', payment: 'credit' }, manager);
  rahima = await patient('Rahima Begum', '01811000000');
  karim = await patient('Abdul Karim', '01711000000', { corporateClientId: acme });
  expect(
    (await api('put', 'diagnostic-policy', cashier, { counterDiscountPercent: 10, defaultReferralPercent: 15 })).status,
  ).toBe(403);
  await api('put', 'diagnostic-policy', manager, { counterDiscountPercent: 10, defaultReferralPercent: 15 }).expect(
    204,
  );
});

describe('diagnostic bills', () => {
  it('bills tests with report times, earns the referrer their commission and cancels a test with a refund', async () => {
    const bill = {
      patientId: rahima,
      referredById: rafiq,
      testIds: [test.cbc, test.xray, test.tube],
      discountReason: 'Poor',
      payment: { amount: 500 },
    };
    const generous = await api('post', 'diagnostic-bills', cashier, { ...bill, discount: 150 });
    expect([generous.status, generous.body.code]).toEqual([403, 'discount_limit']);
    const made = await api('post', 'diagnostic-bills', cashier, { ...bill, discount: 100 }).expect(201);
    expect(made.body).toMatchObject({ number: `DB-${year}-00001`, net: 920, due: 420 });

    const view = await api('get', `diagnostic-bills/${made.body.id}`, cashier).expect(200);
    expect(view.body).toMatchObject({ referredByName: 'Dr. Rafiq', gross: 1020, discount: 100, due: 420 });
    expect(
      view.body.lines.map(
        (line: { testName: string; discount: number; referralAmount: number; reportDueAt: string | null }) => [
          line.testName,
          line.discount,
          line.referralAmount,
          line.reportDueAt === null,
        ],
      ),
    ).toEqual([
      ['Complete blood count', 40, 80, false],
      ['X-ray chest PA', 60, 60, false],
      ['Vacutainer tube', 0, 0, true],
    ]);

    // The X-ray machine is down: 540 of the bill goes, the 420 due is cleared and 120 paid back.
    const cancelled = await api('post', `diagnostic-bills/${made.body.id}/cancel`, cashier, {
      version: 1,
      lines: [2],
      reason: 'Machine down',
    }).expect(200);
    expect(cancelled.body).toEqual({ refunded: 120, due: 0 });
    const ledger = await api('get', `doctors/${rafiq}/ledger?from=${today}&to=${today}`, manager).expect(200);
    expect(ledger.body).toMatchObject({ earned: 140, reversed: 60, closing: 80 });
    expect([await closing('cash'), await closing('receivable'), await closing('income')]).toEqual([380, 0, -420]);
    expect([await closing('discount'), await closing('commission'), await closing('payable')]).toEqual([40, 80, -80]);

    // A package at its own rates, referred by a doctor with her own commission; paid later.
    const fever = await create('hospital/diagnostic-packages', { name: 'Fever profile' }, manager);
    await api('put', `diagnostic-packages/${fever}/tests`, manager, {
      tests: [
        { testId: test.cbc, rate: 350 },
        { testId: test.widal, rate: 300 },
      ],
    }).expect(204);
    expect((await api('get', `diagnostic-packages/${fever}/tests`, cashier).expect(200)).body.total).toBe(650);
    const packaged = await api('post', 'diagnostic-bills', cashier, {
      patientId: rahima,
      referredById: mitu,
      packageIds: [fever],
    }).expect(201);
    expect(packaged.body).toMatchObject({ net: 650, due: 650 });
    const collected = await api('post', `diagnostic-bills/${packaged.body.id}/collections`, cashier, {
      version: 1,
      amount: 650,
    }).expect(201);
    expect(collected.body).toEqual({ number: `DR-${year}-00001`, due: 0 });

    expect(
      (
        await request(http)
          .post('/api/v1/reports/hospital.diagnostic-receipt/render')
          .set(bearer(admin))
          .send({ format: 'pdf', params: { id: made.body.id } })
      ).status,
    ).toBe(200);
    const commission = await sheet('hospital.referral-commission', { from: today, to: today });
    expect(commission.find((row) => row[0] === 'Dr. Rafiq')).toEqual(['Dr. Rafiq', 3, 1020, 1, 600, 140, 60, 80]);
    expect(commission.find((row) => row[0] === 'Dr. Mitu')).toEqual(['Dr. Mitu', 2, 650, 0, 0, 195, 0, 195]);
    const income = await sheet('hospital.diagnostic-income', { from: today, to: today });
    expect(income.find((row) => row[0] === 'Pathology')).toEqual(['Pathology', 4, 1070, 0, 0, 1070, 40, 1030]);
    expect(income.find((row) => row[0] === 'Radiology')).toEqual(['Radiology', 1, 600, 1, 600, 0, 0, 0]);
  });

  it("puts a company patient's tests on the company and settles them with its other bills", async () => {
    const made = await api('post', 'diagnostic-bills', cashier, { patientId: karim, testIds: [test.xray] }).expect(201);
    expect(made.body.due).toBe(600);
    expect((await api('get', `diagnostic-bills/${made.body.id}`, cashier).expect(200)).body.corporateClientName).toBe(
      'Acme Ltd',
    );
    const settled = await api('post', `corporate-clients/${acme}/collections`, cashier, { amount: 600 }).expect(201);
    expect(settled.body.settled).toEqual([
      { kind: 'diag', billId: made.body.id, number: `DB-${year}-00001`, amount: 600 },
    ]);
    expect(await closing('corporate')).toBe(0);
    expect((await api('get', 'diagnostic-bills?withDue=true', cashier).expect(200)).body.total).toBe(0);
  });
});
