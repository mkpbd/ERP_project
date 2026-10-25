import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let officer: string;
let jane: { staffId: string; token: string };
let bob: string;
let carl: string;
let eid: string;

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

async function user(name: string, permissions: string[]): Promise<{ userId: string; token: string }> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  if (permissions.length > 0) {
    const role = await create('roles', { name: `role-${name}`, permissions });
    await request(http)
      .post(`/api/v1/users/${created.body.id}/roles`)
      .set(bearer(admin))
      .send({ roleId: role })
      .expect(204);
  }
  return { userId: created.body.id as string, token: await login(`${name}@example.com`, PASSWORD) };
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
  officer = (await user('officer', ['payroll:read', 'payroll:manage'])).token;
  const janeUser = await user('jane', []);
  const division = await create('hr/divisions', { name: 'Clinical' });
  const department = await create('hr/departments', { divisionId: division, name: 'Nursing' });
  const icu = await create('hr/sub-departments', { departmentId: department, name: 'ICU' });
  const designation = await create('hr/designations', { name: 'Staff Nurse' });
  eid = await create('hr/festivals', { name: 'Eid' });
  const staff = (extra: Record<string, unknown>) =>
    create('hr/staff', {
      departmentId: department,
      subDepartmentId: icu,
      designationId: designation,
      serviceNature: 'Permanent',
      salaryStatus: 'Regular',
      ...extra,
    });
  jane = {
    staffId: await staff({
      employeeNo: 'N-001',
      fullName: 'Jane',
      joiningDate: '2023-03-10',
      userId: janeUser.userId,
      paymentMode: 'Bank',
      bankAccountNo: '0123456789',
    }),
    token: janeUser.token,
  };
  bob = await staff({ employeeNo: 'N-002', fullName: 'Bob', joiningDate: '2026-02-01' });
  carl = await staff({ employeeNo: 'N-003', fullName: 'Carl', joiningDate: '2020-01-01' });
  for (const id of [jane.staffId, bob]) {
    await request(http)
      .put(`/api/v1/hr/staff/${id}/festivals`)
      .set(bearer(admin))
      .send({ festivalIds: [eid] })
      .expect(204);
  }
  const policy = await create(
    'payroll/salary-policies',
    {
      name: 'General',
      basicPercentOfGross: 60,
      houseRentPercentOfBasic: 50,
      medicalPercentOfBasic: 10,
      pfPercentOfBasic: 10,
    },
    officer,
  );
  for (const [staffId, gross, pfEnabled] of [
    [jane.staffId, 30_000, true],
    [bob, 20_000, false],
    [carl, 25_000, false],
  ] as const) {
    await request(http)
      .put(`/api/v1/payroll/salaries/${staffId}`)
      .set(bearer(officer))
      .send({ gross, policyId: policy, pfEnabled })
      .expect(200);
  }
  await request(http).post('/api/v1/payroll/salary-sheets/2026/3/approve').set(bearer(officer)).expect(200);
});

describe('festival bonus', () => {
  it('pays observers who joined by the cut-off a share of last month’s basic, with salary when chosen', async () => {
    const bonus = await create(
      'payroll/festival-bonuses',
      { festivalId: eid, payYear: 2026, payMonth: 4, percentOfBasic: 50, joinedBy: '2026-01-31', payWithSalary: true },
      officer,
    );
    const twice = await request(http)
      .post('/api/v1/payroll/festival-bonuses')
      .set(bearer(officer))
      .send({ festivalId: eid, payYear: 2026, payMonth: 4, percentOfBasic: 10, joinedBy: '2026-01-31' })
      .expect(409);
    expect(twice.body.code).toBe('festival_bonus_exists');

    const preview = await request(http)
      .get(`/api/v1/payroll/festival-bonuses/${bonus}/sheet/preview`)
      .set(bearer(officer))
      .expect(200);
    expect(preview.body).toMatchObject({ status: null, schedule: { festivalName: 'Eid' } });
    expect(
      preview.body.lines.map((line: { employeeNo: string; amount: number }) => [line.employeeNo, line.amount]),
    ).toEqual([['N-001', 9_000]]);

    const later = await create(
      'payroll/festival-bonuses',
      { festivalId: eid, payYear: 2026, payMonth: 6, percentOfBasic: 50, joinedBy: '2026-05-31' },
      officer,
    );
    const noBase = await request(http)
      .get(`/api/v1/payroll/festival-bonuses/${later}/sheet/preview`)
      .set(bearer(officer))
      .expect(422);
    expect(noBase.body.code).toBe('salary_sheet_not_approved');

    const sheet = (action: string) =>
      request(http).post(`/api/v1/payroll/festival-bonuses/${bonus}/sheet/${action}`).set(bearer(officer));
    await sheet('commit').expect(422);
    await sheet('approve').expect(200, { lines: 1, amount: 9_000 });
    const locked = await request(http)
      .patch(`/api/v1/payroll/festival-bonuses/${bonus}`)
      .set(bearer(officer))
      .send({ percentOfBasic: 60 })
      .expect(409);
    expect(locked.body.code).toBe('festival_bonus_has_sheet');

    const april = await request(http)
      .get('/api/v1/payroll/salary-sheets/2026/4/preview')
      .set(bearer(officer))
      .expect(200);
    expect(april.body.lines.find((line: { employeeNo: string }) => line.employeeNo === 'N-001')).toMatchObject({
      festivalBonus: 9_000,
      netPayable: 30_000 + 9_000 - 1_800,
    });

    await sheet('reverse').expect(200, { lines: 1, amount: 0 });
    await sheet('approve').expect(200);
    await sheet('commit').expect(200);
    const final = await sheet('reverse').expect(409);
    expect(final.body.code).toBe('festival_bonus_committed');

    for (const mode of ['all', 'bank']) {
      for (const format of ['pdf', 'xlsx']) {
        const response = await request(http)
          .post('/api/v1/reports/payroll.festival-bonus/render')
          .set(bearer(admin))
          .send({ format, params: { bonusId: bonus, mode } });
        expect(response.status, `${mode} ${format}`).toBe(200);
      }
    }
  });
});

describe('leave encashment, PF and dues', () => {
  it('encashes unused leave, keeps the PF account and staff dues', async () => {
    const leaveType = await create('hr/leave/types', { code: 'CL', name: 'Casual leave' });
    await create('hr/leave/records', {
      staffId: jane.staffId,
      leaveTypeId: leaveType,
      startDate: '2026-03-02',
      endDate: '2026-03-05',
    });
    const preview = await request(http)
      .get('/api/v1/payroll/leave-encashments/2026/3/preview')
      .set(bearer(officer))
      .expect(200);
    expect(
      preview.body.lines.map((line: { employeeNo: string; remainingDays: number; amount: number }) => [
        line.employeeNo,
        line.remainingDays,
        line.amount,
      ]),
    ).toEqual([
      ['N-001', 20, 20_000],
      ['N-002', 22, 14_667],
      ['N-003', 24, 20_000],
    ]);
    await request(http)
      .post('/api/v1/payroll/leave-encashments/2026/3')
      .set(bearer(officer))
      .send({})
      .expect(200, { lines: 3, amount: 54_667 });
    const saved = await request(http).get('/api/v1/payroll/leave-encashments/2026/3').set(bearer(officer)).expect(200);
    expect(saved.body.lines).toHaveLength(3);

    await request(http).post('/api/v1/payroll/salary-sheets/2026/3/commit').set(bearer(officer)).expect(204);
    await create(
      'payroll/pf-ledger',
      { staffId: jane.staffId, entryDate: '2026-01-01', type: 'opening', credit: 10_000 },
      officer,
    );
    await create(
      'payroll/pf-ledger',
      { staffId: jane.staffId, entryDate: '2026-03-15', type: 'withdrawal', debit: 2_000, remarks: 'Loan' },
      officer,
    );
    await request(http)
      .post('/api/v1/payroll/pf-ledger')
      .set(bearer(officer))
      .send({ staffId: jane.staffId, entryDate: '2026-03-15', type: 'adjustment', credit: 1, debit: 1 })
      .expect(400);
    const pf = await request(http)
      .get('/api/v1/payroll/statements/pf?from=2026-02-01&to=2026-12-31')
      .set(bearer(jane.token))
      .expect(200);
    expect(pf.body).toEqual({
      opening: 10_000,
      rows: [
        { date: '2026-03-15', description: 'Withdrawal — Loan', credit: 0, debit: 2_000, balance: 8_000 },
        { date: '2026-03-31', description: 'PF deduction, March 2026', credit: 1_800, debit: 0, balance: 9_800 },
      ],
      closing: 9_800,
    });
    await request(http)
      .get(`/api/v1/payroll/statements/pf?from=2026-01-01&to=2026-12-31&staffId=${bob}`)
      .set(bearer(jane.token))
      .expect(403);

    await create(
      'payroll/staff-dues',
      { staffId: jane.staffId, entryDate: '2026-03-10', particulars: 'Canteen on credit', debit: 500 },
      officer,
    );
    await create(
      'payroll/staff-dues',
      { staffId: jane.staffId, entryDate: '2026-03-20', particulars: 'Paid back', credit: 200 },
      officer,
    );
    const dues = await request(http)
      .get(`/api/v1/payroll/statements/dues?from=2026-03-01&to=2026-03-31&staffId=${jane.staffId}`)
      .set(bearer(officer))
      .expect(200);
    expect(dues.body).toMatchObject({ opening: 0, closing: 300 });

    for (const [key, params, formats] of [
      ['payroll.leave-encashment', { year: 2026, month: 3 }, ['pdf', 'xlsx']],
      ['payroll.pf-monthly', { year: 2026, month: 3 }, ['pdf', 'xlsx']],
      ['payroll.pf-statement', { staffId: jane.staffId, from: '2026-01-01', to: '2026-12-31' }, ['pdf']],
      ['payroll.dues-statement', { staffId: jane.staffId, from: '2026-01-01', to: '2026-12-31' }, ['pdf']],
    ] as const) {
      for (const format of formats) {
        const response = await request(http)
          .post(`/api/v1/reports/${key}/render`)
          .set(bearer(admin))
          .send({ format, params });
        expect(response.status, `${key} ${format}: ${JSON.stringify(response.body).slice(0, 200)}`).toBe(200);
      }
    }
    await request(http)
      .delete('/api/v1/payroll/leave-encashments/2026/3')
      .set(bearer(officer))
      .expect(200, { removed: 3 });
  });
});

describe('PF fund', () => {
  it('shares interest by balance once per date and works out the settlement', async () => {
    await request(http).post('/api/v1/payroll/salary-sheets/2026/3/commit').set(bearer(officer)).expect(204);
    await create(
      'payroll/pf-ledger',
      { staffId: jane.staffId, entryDate: '2026-01-01', type: 'opening', credit: 10_000 },
      officer,
    );
    await create(
      'payroll/pf-ledger',
      { staffId: carl, entryDate: '2026-01-01', type: 'opening', credit: 5_000 },
      officer,
    );

    // Jane: 10,000 opening + 1,800 own (March) + 1,800 employer's match = 13,600; Carl: 5,000; Bob: nothing.
    const preview = await request(http)
      .get('/api/v1/payroll/pf/interest/preview?asOf=2026-03-31&amount=1000')
      .set(bearer(officer))
      .expect(200);
    expect(preview.body).toMatchObject({ totalBalance: 18_600, amount: 1_000, matchPercent: 100 });
    expect(
      preview.body.lines.map((line: { employeeNo: string; balance: number; interest: number }) => [
        line.employeeNo,
        line.balance,
        line.interest,
      ]),
    ).toEqual([
      ['N-001', 13_600, 731.18],
      ['N-003', 5_000, 268.82],
    ]);
    await request(http)
      .get('/api/v1/payroll/pf/interest/preview?asOf=2026-03-31&amount=1000')
      .set(bearer(jane.token))
      .expect(403);

    const body = { asOf: '2026-03-31', amount: 1_000 };
    await request(http).post('/api/v1/payroll/pf/interest').set(bearer(jane.token)).send(body).expect(403);
    const done = await request(http).post('/api/v1/payroll/pf/interest').set(bearer(officer)).send(body).expect(200);
    expect(done.body).toEqual({ members: 2, amount: 1_000 });
    const again = await request(http).post('/api/v1/payroll/pf/interest').set(bearer(officer)).send(body).expect(409);
    expect(again.body.code).toBe('pf_interest_exists');

    const mine = await request(http)
      .get('/api/v1/payroll/pf/settlement?asOf=2026-12-31')
      .set(bearer(jane.token))
      .expect(200);
    expect(mine.body).toMatchObject({
      staff: { employeeNo: 'N-001' },
      opening: 10_000,
      own: 1_800,
      employer: 1_800,
      interest: 731.18,
      withdrawn: 0,
      balance: 14_331.18,
      years: [{ year: 2026, own: 1_800, employer: 1_800, interest: 731.18, withdrawn: 0 }],
    });
    const halfMatch = await request(http)
      .get(`/api/v1/payroll/pf/settlement?asOf=2026-12-31&staffId=${jane.staffId}&matchPercent=50`)
      .set(bearer(officer))
      .expect(200);
    expect(halfMatch.body).toMatchObject({ employer: 900, balance: 13_431.18 });
    await request(http)
      .get(`/api/v1/payroll/pf/settlement?asOf=2026-12-31&staffId=${carl}`)
      .set(bearer(jane.token))
      .expect(403);

    for (const [key, params, format] of [
      ['payroll.pf-settlement', { staffId: jane.staffId, asOf: '2026-12-31' }, 'pdf'],
      ['payroll.pf-interest', { asOf: '2026-03-31', amount: 1_000 }, 'pdf'],
      ['payroll.pf-interest', { asOf: '2026-03-31', amount: 1_000 }, 'xlsx'],
    ] as const) {
      const response = await request(http)
        .post(`/api/v1/reports/${key}/render`)
        .set(bearer(admin))
        .send({ format, params });
      expect(response.status, `${key} ${format}: ${JSON.stringify(response.body).slice(0, 200)}`).toBe(200);
    }
  });
});
