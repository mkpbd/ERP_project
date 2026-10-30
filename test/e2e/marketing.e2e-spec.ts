import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let manager: string;
let viewer: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const year = Number(today.slice(0, 4));
const month = Number(today.slice(5, 7));
const fiscal = month >= 7 ? year : year - 1;

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

const mk = (method: 'get' | 'post' | 'put', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/marketing/${path}`).set(bearer(token));
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
  manager = await user('manager', ['mkt:read', 'mkt:manage']);
  viewer = await user('viewer', ['mkt:read']);
  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [nature, balance, code, name, role] of [
    ['1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['1', 'debit', '1250', 'Diagnostic receivable', 'diagnostic_receivable'],
    ['2', 'credit', '2201', 'Consultants payable', 'consultant_payable'],
    ['4', 'credit', '4401', 'Diagnostic income', 'diagnostic_income'],
    ['5', 'debit', '5402', 'Referral commission', 'referral_commission_expense'],
  ] as const) {
    await create('accounts/gl-roles', { role, glAccountId: await glAccount(nature, balance, code, name) });
  }
});

describe('marketing', () => {
  it('keeps the team and its doctors, and measures referred billing against targets', async () => {
    // Zones and the team.
    const north = await create('marketing/zones', { name: 'North' }, manager);
    expect((await mk('post', 'zones', viewer, { name: 'South' })).status).toBe(403);
    await create('marketing/areas', { zoneId: north, name: 'Sadar' }, manager);
    const lost = await mk('post', 'areas', manager, { zoneId: '00000000-0000-4000-8000-000000000000', name: 'X' });
    expect(lost.body.code).toBe('marketing_zone_not_found');
    const kamal = await create('marketing/people', { kind: 'manager', name: 'Kamal Hossain' }, manager);
    const orphan = await mk('post', 'people', manager, { kind: 'officer', name: 'Nobody' });
    expect(orphan.body.code).toBe('invalid_parent');
    const rafiq = await create(
      'marketing/people',
      { kind: 'officer', name: 'Rafiq', code: 'MO-1', parentId: kamal, zoneId: north },
      manager,
    );
    const mitu = await create(
      'marketing/people',
      { kind: 'officer', name: 'Mitu', code: 'MO-2', parentId: kamal },
      manager,
    );
    expect((await mk('post', 'people', manager, { kind: 'agent', name: 'Babu', parentId: kamal })).body.code).toBe(
      'invalid_parent',
    );
    await create('marketing/people', { kind: 'agent', name: 'Babu', code: 'AG-1', parentId: rafiq }, manager);
    expect(
      (await mk('post', 'people', manager, { kind: 'agent', name: 'Dup', code: 'mo-1', parentId: rafiq })).body.code,
    ).toBe('code_taken');
    const leaving = await mk('put', `people/${rafiq}`, manager, {
      version: 1,
      name: 'Rafiq',
      code: 'MO-1',
      parentId: kamal,
      zoneId: north,
      isActive: false,
    });
    expect(leaving.body.code).toBe('has_reports');
    const team = await mk('get', 'people', viewer).expect(200);
    expect(
      team.body.items.map((entry: { kind: string; name: string; parentName: string | null }) => [
        entry.kind,
        entry.name,
        entry.parentName,
      ]),
    ).toEqual([
      ['manager', 'Kamal Hossain', null],
      ['officer', 'Mitu', 'Kamal Hossain'],
      ['officer', 'Rafiq', 'Kamal Hossain'],
      ['agent', 'Babu', 'Rafiq'],
    ]);

    // Doctors looked after: Dr. Alam moves from Rafiq to Mitu.
    const doctor = (name: string) => create('hospital/doctors', { name, referralPercent: 10 });
    const [anwar, alam, kabir] = [await doctor('Dr. Anwar'), await doctor('Dr. Alam'), await doctor('Dr. Kabir')];
    await mk('put', `people/${rafiq}/doctors`, manager, { doctorIds: [anwar, alam] }).expect(204);
    await mk('put', `people/${mitu}/doctors`, manager, { doctorIds: [alam] }).expect(204);
    expect((await mk('get', `people/${rafiq}/doctors`, viewer).expect(200)).body.items).toEqual([
      { id: anwar, name: 'Dr. Anwar' },
    ]);

    // Referred tests this month: 1000 by Dr. Anwar, 400 by Dr. Alam, 300 by Dr. Kabir (nobody's).
    const pathology = await create('hospital/diagnostic-departments', { name: 'Pathology' });
    const test = (name: string, rate: number) =>
      create('hospital/diagnostic-tests', { name, departmentId: pathology, rate });
    const [lipid, cbc, sugar] = [
      await test('Lipid profile', 1000),
      await test('CBC', 400),
      await test('Blood sugar', 300),
    ];
    const patient = await create('hospital/patients', {
      fullName: 'Rahima Begum',
      sex: 'female',
      dateOfBirth: '1990-01-01',
      mobileNo: '01811000000',
    });
    for (const [referredById, testId, amount] of [
      [anwar, lipid, 1000],
      [alam, cbc, 400],
      [kabir, sugar, 300],
    ] as const) {
      await create('hospital/diagnostic-bills', {
        patientId: patient,
        referredById,
        testIds: [testId],
        payment: { amount },
      });
    }

    await mk('put', 'targets', manager, { officerId: rafiq, year, month, amount: 2000 }).expect(204);
    await mk('put', 'targets', manager, { year, month, amount: 5000 }).expect(204);
    await mk('put', 'targets', manager, { year, month, amount: 5000 }).expect(204);
    const result = await mk('get', `performance?year=${year}&month=${month}`, viewer).expect(200);
    expect(
      result.body.rows.map(
        (row: { officerName: string; achieved: number; target: number | null; percent: number | null }) => [
          row.officerName,
          row.achieved,
          row.target,
          row.percent,
        ],
      ),
    ).toEqual([
      ['Mitu', 400, null, null],
      ['Rafiq', 1000, 2000, 50],
    ]);
    expect(result.body).toMatchObject({ total: 1700, unassigned: 300, grossTarget: 5000, grossPercent: 34 });

    const sheet = await request(http)
      .post('/api/v1/reports/marketing.performance/render')
      .set(bearer(admin))
      .send({ format: 'xlsx', params: { year, month } })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(sheet.body as Buffer).buffer);
    expect(workbook.worksheets[0]!.rowCount).toBeGreaterThan(3);
    const pdf = await request(http)
      .post('/api/v1/reports/marketing.performance/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { year, month } });
    expect(pdf.status).toBe(200);
  });
});
