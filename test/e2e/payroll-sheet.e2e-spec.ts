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

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const APRIL = { payYear: 2026, payMonth: 4 };

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

const sheet = (path: string) => `/api/v1/payroll/salary-sheets/2026/4${path}`;

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
  bob = await staff({ employeeNo: 'N-002', fullName: 'Bob', joiningDate: '2026-04-11', paymentMode: 'Cash' });
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
  ] as const) {
    await request(http)
      .put(`/api/v1/payroll/salaries/${staffId}`)
      .set(bearer(officer))
      .send({ gross, policyId: policy, pfEnabled })
      .expect(200);
  }
});

describe('monthly salary', () => {
  it('works out, approves and commits the sheet, then freezes the month', async () => {
    const janeApril = { staffId: jane.staffId, ...APRIL };
    await create('payroll/overtimes', { ...janeApril, workYear: 2026, workMonth: 3, hours: 10, amount: 500 }, officer);
    const deduction = await create(
      'payroll/deductions',
      { ...janeApril, lwpDays: 2, lwpFrom: '2026-04-05', lwpTo: '2026-04-06', otherDeduction: 200, cause: 'Absent' },
      officer,
    );
    const again = await request(http)
      .post('/api/v1/payroll/deductions')
      .set(bearer(officer))
      .send({ ...janeApril, otherDeduction: 50, cause: 'Again' })
      .expect(409);
    expect(again.body.code).toBe('salary_deduction_exists');
    await request(http)
      .post('/api/v1/payroll/deductions')
      .set(bearer(officer))
      .send({ staffId: bob, ...APRIL, lwpDays: 1, cause: 'No dates' })
      .expect(400);
    const punishment = await create(
      'payroll/punishments',
      { ...janeApril, amount: 300, description: 'Late for duty' },
      officer,
    );
    await create('payroll/arrears', { ...janeApril, amount: 1_000 }, officer);
    await create('payroll/allowance-payments', { ...janeApril, otherAllowance: 700, specialAllowance: 300 }, officer);
    await create('payroll/salary-payments', { ...janeApril, advancePaid: 5_000, paymentMode: 'Cash' }, officer);

    await request(http).get(sheet('/preview')).set(bearer(jane.token)).expect(403);
    await request(http).get(sheet('')).set(bearer(officer)).expect(404);
    const preview = await request(http).get(sheet('/preview')).set(bearer(officer)).expect(200);
    expect(preview.body.status).toBeNull();
    expect(
      preview.body.lines.map((line: { employeeNo: string; netPayable: number }) => [line.employeeNo, line.netPayable]),
    ).toEqual([
      ['N-001', 29_410],
      ['N-002', 13_333],
    ]);
    expect(preview.body.lines[0]).toMatchObject({
      overtime: 1_710,
      lwp: 2_000,
      punishment: 500,
      arrear: 1_000,
      advance: 5_000,
    });
    expect(preview.body.lines[1]).toMatchObject({ arrear: -6_667, pf: 0 });

    await request(http).post(sheet('/commit')).set(bearer(officer)).expect(422);
    await request(http).post(sheet('/approve')).set(bearer(officer)).expect(200, { lines: 2, netPayable: 42_743 });
    // Approving again picks up later changes.
    await request(http)
      .patch(`/api/v1/payroll/punishments/${punishment}`)
      .set(bearer(officer))
      .send({ amount: 400 })
      .expect(200);
    await request(http).post(sheet('/approve')).set(bearer(officer)).expect(200, { lines: 2, netPayable: 42_643 });

    const own = await request(http).get(sheet('/payslips/me')).set(bearer(jane.token)).expect(200);
    expect(own.body).toMatchObject({ employeeNo: 'N-001', netPayable: 29_310, bankAccountNo: '0123456789' });
    await request(http)
      .get(sheet(`/payslips/${bob}`))
      .set(bearer(jane.token))
      .expect(403);

    await request(http).post(sheet('/commit')).set(bearer(officer)).expect(204);
    const saved = await request(http).get(sheet('')).set(bearer(officer)).expect(200);
    expect(saved.body).toMatchObject({ status: 'committed', lines: [{ netPayable: 29_310 }, { netPayable: 13_333 }] });

    const closed = await request(http)
      .post('/api/v1/payroll/overtimes')
      .set(bearer(officer))
      .send({ ...janeApril, workYear: 2026, workMonth: 4, hours: 2 })
      .expect(409);
    expect(closed.body.code).toBe('pay_period_closed');
    await request(http)
      .patch(`/api/v1/payroll/deductions/${deduction}`)
      .set(bearer(officer))
      .send({ otherDeduction: 0 })
      .expect(409);
    await request(http).delete(`/api/v1/payroll/punishments/${punishment}`).set(bearer(officer)).expect(409);
    // Moving an entry out of a closed month is refused too.
    await request(http)
      .patch(`/api/v1/payroll/deductions/${deduction}`)
      .set(bearer(officer))
      .send({ payMonth: 5 })
      .expect(409);
    await create('payroll/salary-payments', { ...janeApril, salaryPaid: 24_310, paymentMode: 'Bank' }, officer);
    await create(
      'payroll/punishments',
      { staffId: jane.staffId, payYear: 2026, payMonth: 5, amount: 100, description: 'May' },
      officer,
    );
    const reapprove = await request(http).post(sheet('/approve')).set(bearer(officer)).expect(409);
    expect(reapprove.body.code).toBe('salary_sheet_committed');
    const increment = await request(http)
      .post('/api/v1/payroll/increments')
      .set(bearer(officer))
      .send({ year: 2026, month: 4, entries: [{ staffId: jane.staffId, amount: 500 }] })
      .expect(409);
    expect(increment.body.code).toBe('pay_period_closed');

    for (const [key, params, formats] of [
      ['payroll.salary-sheet', { year: 2026, month: 4 }, ['pdf', 'xlsx']],
      ['payroll.salary-sheet', { year: 2026, month: 5 }, ['pdf']],
      ['payroll.payslip', { year: 2026, month: 4, staffId: jane.staffId }, ['pdf']],
      ['payroll.salary-statement', { year: 2026, month: 4, mode: 'bank' }, ['pdf', 'xlsx']],
      ['payroll.salary-statement', { year: 2026, month: 4, mode: 'cash' }, ['pdf']],
      ['payroll.department-summary', { year: 2026, month: 4 }, ['pdf', 'xlsx']],
      ['payroll.salary-envelope', { year: 2026, month: 4 }, ['pdf']],
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
      .post('/api/v1/reports/payroll.payslip/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { year: 2026, month: 6, staffId: jane.staffId } })
      .expect(404);
  });
});
