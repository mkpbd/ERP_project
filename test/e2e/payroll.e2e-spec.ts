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
let policy: string;

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

const setSalary = (staffId: string, body: Record<string, unknown>) =>
  request(http).put(`/api/v1/payroll/salaries/${staffId}`).set(bearer(officer)).send(body);

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
  const staff = (employeeNo: string, fullName: string, joiningDate: string, userId: string | null = null) =>
    create('hr/staff', {
      employeeNo,
      fullName,
      departmentId: department,
      subDepartmentId: icu,
      designationId: designation,
      joiningDate,
      serviceNature: 'Permanent',
      salaryStatus: 'Regular',
      userId,
    });
  jane = { staffId: await staff('N-001', 'Jane', '2023-03-10', janeUser.userId), token: janeUser.token };
  bob = await staff('N-002', 'Bob', '2024-05-01');
  policy = await create(
    'payroll/salary-policies',
    {
      name: 'General',
      basicPercentOfGross: 60,
      houseRentPercentOfBasic: 50,
      medicalPercentOfBasic: 10,
      pfPercentOfBasic: 10,
      cpfPercentOfBasic: 10,
    },
    officer,
  );
});

describe('salary structure', () => {
  it('splits the gross by the policy and keeps salaries confidential', async () => {
    const taken = await request(http)
      .post('/api/v1/payroll/salary-policies')
      .set(bearer(officer))
      .send({ name: 'general', basicPercentOfGross: 50, houseRentPercentOfBasic: 50, medicalPercentOfBasic: 10 })
      .expect(409);
    expect(taken.body.code).toBe('salary_policy_name_taken');
    await request(http)
      .post('/api/v1/payroll/salary-policies')
      .set(bearer(officer))
      .send({ name: 'Bad', basicPercentOfGross: 150, houseRentPercentOfBasic: 50, medicalPercentOfBasic: 10 })
      .expect(400);

    const set = await setSalary(jane.staffId, { gross: 30_000, policyId: policy, pfEnabled: true }).expect(200);
    expect(set.body).toMatchObject({
      employeeNo: 'N-001',
      policyName: 'General',
      gross: 30_000,
      basic: 18_000,
      houseRent: 9_000,
      medical: 1_800,
      conveyance: 1_200,
      otherAllowance: 0,
      pf: 1_800,
      cpf: 1_800,
      incrementMethod: 'percentage',
      version: 1,
    });
    const again = await setSalary(jane.staffId, { gross: 25_000, policyId: policy, pfEnabled: false }).expect(409);
    expect(again.body.code).toBe('salary_exists');

    const stale = await request(http)
      .patch(`/api/v1/payroll/salaries/${jane.staffId}`)
      .set(bearer(officer))
      .send({ version: 2, gross: 32_000 })
      .expect(409);
    expect(stale.body.code).toBe('stale_salary');
    const revised = await request(http)
      .patch(`/api/v1/payroll/salaries/${jane.staffId}`)
      .set(bearer(officer))
      .send({ version: 1, gross: 32_000, pfEnabled: false })
      .expect(200);
    expect(revised.body).toMatchObject({ gross: 32_000, basic: 19_200, pf: 0, cpf: 0, version: 2 });

    const own = await request(http).get('/api/v1/payroll/salaries/me').set(bearer(jane.token)).expect(200);
    expect(own.body.gross).toBe(32_000);
    await setSalary(bob, { gross: 20_000, policyId: policy, pfEnabled: true }).expect(200);
    await request(http).get(`/api/v1/payroll/salaries/${bob}`).set(bearer(jane.token)).expect(403);
    await request(http).get('/api/v1/payroll/salaries').set(bearer(jane.token)).expect(403);
    const list = await request(http).get('/api/v1/payroll/salaries?q=bob').set(bearer(officer)).expect(200);
    expect(list.body).toMatchObject({ total: 1, items: [{ employeeNo: 'N-002' }] });

    const inUse = await request(http)
      .delete(`/api/v1/payroll/salary-policies/${policy}`)
      .set(bearer(officer))
      .expect(409);
    expect(inUse.body.code).toBe('salary_policy_in_use');
  });
});

describe('increments', () => {
  it('lists who is due, applies, reverses exactly and commits', async () => {
    await setSalary(jane.staffId, { gross: 32_000, policyId: policy, pfEnabled: true }).expect(200);
    await setSalary(bob, { gross: 20_000, policyId: policy, pfEnabled: true, incrementMethod: 'individual' }).expect(
      200,
    );

    // Jane joined in March 2023: her increment is paid with April's salary.
    const due = await request(http)
      .get('/api/v1/payroll/increments/candidates?year=2026&month=4')
      .set(bearer(officer))
      .expect(200);
    expect(due.body).toEqual([
      expect.objectContaining({ employeeNo: 'N-001', amountDue: 3_072, arrear: 2_180.13, applied: false }),
    ]);

    const missing = await request(http)
      .post('/api/v1/payroll/increments')
      .set(bearer(officer))
      .send({ year: 2026, month: 4, entries: [{ staffId: bob }] })
      .expect(422);
    expect(missing.body.detail).toMatch(/Enter the increment for N-002/);

    await request(http)
      .post('/api/v1/payroll/increments')
      .set(bearer(officer))
      .send({ year: 2026, month: 4, entries: [{ staffId: jane.staffId }, { staffId: bob, amount: 1_000 }] })
      .expect(200, { applied: 2 });
    const raised = await request(http).get(`/api/v1/payroll/salaries/${jane.staffId}`).set(bearer(officer));
    expect(raised.body).toMatchObject({ gross: 35_072, basic: 21_043 });
    const twice = await request(http)
      .post('/api/v1/payroll/increments')
      .set(bearer(officer))
      .send({ year: 2026, month: 4, entries: [{ staffId: jane.staffId }] })
      .expect(409);
    expect(twice.body.code).toBe('increment_exists');

    const listed = await request(http)
      .get('/api/v1/payroll/increments?year=2026&month=4')
      .set(bearer(officer))
      .expect(200);
    expect(
      listed.body.map((row: { employeeNo: string; amount: number; arrear: number }) => [
        row.employeeNo,
        row.amount,
        row.arrear,
      ]),
    ).toEqual([
      ['N-001', 3_072, 2_180.13],
      ['N-002', 1_000, 0],
    ]);

    await request(http)
      .post('/api/v1/payroll/increments/reverse')
      .set(bearer(officer))
      .send({ year: 2026, month: 4 })
      .expect(200, { reversed: 2 });
    const restored = await request(http).get(`/api/v1/payroll/salaries/${jane.staffId}`).set(bearer(officer));
    expect(restored.body).toMatchObject({ gross: 32_000, basic: 19_200, pf: 1_920 });

    // A salary edited after its increment cannot be reversed blindly.
    await request(http)
      .post('/api/v1/payroll/increments')
      .set(bearer(officer))
      .send({ year: 2026, month: 4, entries: [{ staffId: jane.staffId }] })
      .expect(200);
    const current = await request(http).get(`/api/v1/payroll/salaries/${jane.staffId}`).set(bearer(officer));
    await request(http)
      .patch(`/api/v1/payroll/salaries/${jane.staffId}`)
      .set(bearer(officer))
      .send({ version: current.body.version, specialAllowance: 500 })
      .expect(200);
    const blocked = await request(http)
      .post('/api/v1/payroll/increments/reverse')
      .set(bearer(officer))
      .send({ year: 2026, month: 4 })
      .expect(409);
    expect(blocked.body.code).toBe('salary_changed_since_increment');

    await request(http)
      .post('/api/v1/payroll/increments/commit')
      .set(bearer(officer))
      .send({ year: 2026, month: 4 })
      .expect(200, { committed: 1 });
    await request(http)
      .post('/api/v1/payroll/increments/reverse')
      .set(bearer(officer))
      .send({ year: 2026, month: 4 })
      .expect(200, { reversed: 0 });
    await request(http)
      .post('/api/v1/payroll/increments/commit')
      .set(bearer(jane.token))
      .send({ year: 2026, month: 4 })
      .expect(403);

    for (const [key, params] of [
      ['payroll.salary-structure', {}],
      ['payroll.increment-statement', { year: 2026, month: 4 }],
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
