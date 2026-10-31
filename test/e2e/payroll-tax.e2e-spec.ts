import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let officer: string;
let jane: { staffId: string; token: string };

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const scale = (taxFree: number) => [
  { width: taxFree, ratePercent: 0 },
  { width: 300_000, ratePercent: 10 },
  { width: 400_000, ratePercent: 15 },
  { width: 500_000, ratePercent: 20 },
  { width: 2_000_000, ratePercent: 25 },
  { width: null, ratePercent: 30 },
];
const TAX_YEAR = {
  label: '2025-2026',
  startsOn: '2025-07-01',
  endsOn: '2026-06-30',
  maleSlabs: scale(375_000),
  femaleSlabs: scale(425_000),
  maleExemptionCap: 500_000,
  femaleExemptionCap: 500_000,
  maleMinimumTaxGross: 40_600,
  femaleMinimumTaxGross: 46_000,
};

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
  const department = await create('hr/departments', { divisionId: division, name: 'Medicine' });
  const ward = await create('hr/sub-departments', { departmentId: department, name: 'Ward' });
  const designation = await create('hr/designations', { name: 'Consultant' });
  jane = {
    staffId: await create('hr/staff', {
      employeeNo: 'D-001',
      fullName: 'Jane',
      sex: 'male',
      departmentId: department,
      subDepartmentId: ward,
      designationId: designation,
      joiningDate: '2020-01-01',
      serviceNature: 'Permanent',
      salaryStatus: 'Regular',
      userId: janeUser.userId,
    }),
    token: janeUser.token,
  };
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
  await request(http)
    .put(`/api/v1/payroll/salaries/${jane.staffId}`)
    .set(bearer(officer))
    .send({ gross: 200_000, policyId: policy, pfEnabled: true })
    .expect(200);
});

describe('income tax', () => {
  it('works out monthly deductions from the tax year, takes overrides and feeds the salary sheet', async () => {
    const taxYear = await create('payroll/tax-years', TAX_YEAR, officer);
    const overlap = await request(http)
      .post('/api/v1/payroll/tax-years')
      .set(bearer(officer))
      .send({ ...TAX_YEAR, label: 'Overlap', startsOn: '2026-01-01', endsOn: '2026-12-31' })
      .expect(409);
    expect(overlap.body.code).toBe('income_tax_year_overlaps');
    await request(http)
      .post('/api/v1/payroll/tax-years')
      .set(bearer(officer))
      .send({
        ...TAX_YEAR,
        label: 'Bad',
        startsOn: '2027-07-01',
        endsOn: '2028-06-30',
        maleSlabs: [{ width: 1, ratePercent: 0 }],
      })
      .expect(400);
    const missing = await request(http)
      .post('/api/v1/payroll/income-tax/2027/7/compute')
      .set(bearer(officer))
      .expect(422);
    expect(missing.body.code).toBe('income_tax_year_missing');

    // No salary of the tax year is saved yet: the year is projected from the salary structure.
    await request(http)
      .post('/api/v1/payroll/income-tax/2025/7/compute')
      .set(bearer(officer))
      .expect(200, { people: 1, monthlyTax: 25_994 });
    await request(http)
      .put(`/api/v1/payroll/income-tax/2025/7/${jane.staffId}`)
      .set(bearer(officer))
      .send({ monthlyTax: 20_000, remarks: 'Investment proof received' })
      .expect(204);
    await request(http).post('/api/v1/payroll/income-tax/2025/7/compute').set(bearer(officer)).expect(200);
    const kept = await request(http).get('/api/v1/payroll/income-tax/2025/7').set(bearer(officer)).expect(200);
    expect(kept.body).toEqual([
      expect.objectContaining({ employeeNo: 'D-001', monthlyTax: 20_000, source: 'manual', yearlyTax: null }),
    ]);
    await request(http)
      .put(`/api/v1/payroll/income-tax/2025/7/${jane.staffId}`)
      .set(bearer(officer))
      .send({ monthlyTax: null })
      .expect(204);
    await request(http).post('/api/v1/payroll/income-tax/2025/7/compute').set(bearer(officer)).expect(200);
    const computed = await request(http).get('/api/v1/payroll/income-tax/2025/7').set(bearer(officer)).expect(200);
    expect(computed.body[0]).toMatchObject({ monthlyTax: 25_994, yearlyTax: 311_930, taxableIncome: 2_344_000 });

    const sheet = await request(http)
      .get('/api/v1/payroll/salary-sheets/2025/7/preview')
      .set(bearer(officer))
      .expect(200);
    expect(sheet.body.lines[0]).toMatchObject({ incomeTax: 25_994, pf: 12_000, netPayable: 200_000 - 12_000 - 25_994 });
    await request(http).post('/api/v1/payroll/salary-sheets/2025/7/approve').set(bearer(officer)).expect(200);
    await request(http).post('/api/v1/payroll/salary-sheets/2025/7/commit').set(bearer(officer)).expect(204);
    const closed = await request(http)
      .post('/api/v1/payroll/income-tax/2025/7/compute')
      .set(bearer(officer))
      .expect(409);
    expect(closed.body.code).toBe('pay_period_closed');

    const own = await request(http)
      .get(`/api/v1/payroll/tax-certificates/${taxYear}`)
      .set(bearer(jane.token))
      .expect(200);
    expect(own.body.certificate).toMatchObject({ monthsPaid: 1, monthsAhead: 11, taxPaid: 25_994 });
    await request(http)
      .get(`/api/v1/payroll/tax-certificates/${taxYear}?staffId=${jane.staffId}`)
      .set(bearer(officer))
      .expect(200);

    // The tax deducted in July is deposited with a treasury challan; the certificate shows both.
    const challan = {
      staffId: jane.staffId,
      payYear: 2025,
      payMonth: 7,
      challanNo: 'TC-0811',
      challanDate: '2025-08-10',
      bank: 'Sonali Bank, Kolatoli',
      amount: 25_994,
    };
    await create('payroll/tax-challans', challan, officer);
    const again = await request(http).post('/api/v1/payroll/tax-challans').set(bearer(officer)).send(challan);
    expect([again.status, again.body.code]).toEqual([409, 'tax_challan_month_taken']);
    expect(
      (await request(http).post('/api/v1/payroll/tax-challans').set(bearer(jane.token)).send(challan)).status,
    ).toBe(403);
    const listed = await request(http)
      .get(`/api/v1/payroll/tax-challans?staffId=${jane.staffId}&payYear=2025`)
      .set(bearer(officer))
      .expect(200);
    expect(listed.body).toEqual([expect.objectContaining({ challanNo: 'TC-0811', amount: 25_994 })]);
    const certificate = await request(http)
      .get(`/api/v1/payroll/tax-certificates/${taxYear}`)
      .set(bearer(jane.token))
      .expect(200);
    expect(certificate.body).toMatchObject({
      deposits: [
        {
          payYear: 2025,
          payMonth: 7,
          deducted: 25_994,
          challanNo: 'TC-0811',
          challanDate: '2025-08-10',
          bank: 'Sonali Bank, Kolatoli',
          deposited: 25_994,
        },
      ],
      deducted: 25_994,
      deposited: 25_994,
    });

    for (const [key, params, formats] of [
      ['payroll.tax-certificate', { taxYearId: taxYear, staffId: jane.staffId }, ['pdf']],
      ['payroll.tax-monthly', { year: 2025, month: 7 }, ['pdf', 'xlsx']],
    ] as const) {
      for (const format of formats) {
        const response = await request(http)
          .post(`/api/v1/reports/${key}/render`)
          .set(bearer(admin))
          .send({ format, params });
        expect(response.status, `${key} ${format}: ${JSON.stringify(response.body).slice(0, 200)}`).toBe(200);
      }
    }
  });
});
