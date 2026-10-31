import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let seller: string;
let officer: string;
let outlet: string;
let napa: string;
let acme: string;
let cashCo: string;
let jane: string;
let bob: string;
const gl: Record<string, string> = {};

const PASSWORD = 'quite long passphrase 42';
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const fiscal = Number(today.slice(5, 7)) >= 7 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
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

const ph = (method: 'get' | 'post', path: string, token: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/pharmacy/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const closing = async (account: string) =>
  (
    await request(http)
      .get(`/api/v1/accounts/books/ledger?glAccountId=${gl[account]}&from=2026-01-01&to=2026-06-30`)
      .set(bearer(admin))
      .expect(200)
  ).body.closing as number;
const sell = (qty: number, extra: Record<string, unknown>) =>
  ph('post', 'sales', seller, {
    outletId: outlet,
    soldOn: '2026-04-10',
    lines: [{ productId: napa, qty }],
    tendered: 0,
    ...extra,
  });
const ledger = async (staffId: string) =>
  (
    await request(http)
      .get(`/api/v1/payroll/statements/dues?from=2026-01-01&to=2026-12-31&staffId=${staffId}`)
      .set(bearer(officer))
      .expect(200)
  ).body as { closing: number; rows: { description: string; debit: number; credit: number }[] };

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  const counter = await user('seller', ['pharmacy:read', 'pharmacy:sell']);
  seller = counter.token;
  officer = (await user('officer', ['payroll:read', 'payroll:manage'])).token;

  await create('accounts/fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  // OPD bills are dated today.
  if (fiscal !== 2025) {
    await create('accounts/fiscal-years', {
      label: `${fiscal}-${fiscal + 1}`,
      startsOn: `${fiscal}-07-01`,
      endsOn: `${fiscal + 1}-06-30`,
    });
  }
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, role] of [
    ['inventory', '1', 'debit', '1350', 'Medicine inventory', 'pharmacy_inventory'],
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['receivable', '1', 'debit', '1201', 'Pharmacy receivable', 'pharmacy_receivable'],
    ['corporate', '1', 'debit', '1220', 'Corporate receivable', 'corporate_receivable'],
    ['staff', '1', 'debit', '1230', 'Staff receivable', 'staff_receivable'],
    ['sales', '4', 'credit', '4101', 'Medicine sales', 'pharmacy_sales'],
    ['services', '4', 'credit', '4202', 'OPD service income', 'opd_service_income'],
    ['discount', '5', 'debit', '5102', 'Sales discount', 'pharmacy_sales_discount'],
    ['cogs', '5', 'debit', '5101', 'Cost of medicines sold', 'pharmacy_cogs'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role, glAccountId: gl[key] });
  }

  const maker = await create('pharmacy/manufacturers', { name: 'Beximco' });
  napa = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Napa', manufacturerId: maker }),
    genericId: await create('pharmacy/generics', { name: 'Paracetamol' }),
    formationId: await create('pharmacy/formations', { name: 'Tablet', shortName: 'Tab.' }),
  });
  // No discount: 10 taka a tablet.
  await create('pharmacy/product-discounts', { productId: napa, isAllowed: false });
  outlet = await create('pharmacy/outlets', { name: 'Outdoor pharmacy' });
  await create('pharmacy/outlet-users', { outletId: outlet, userId: counter.id });
  await create('pharmacy/opening-stock', {
    outletId: outlet,
    openedOn: '2026-01-01',
    lines: [{ productId: napa, qty: 1000, unitCost: 6, saleRate: 10, batchNo: 'B', expiryDate: '2027-12-31' }],
  });

  acme = await create('hospital/corporate-clients', { name: 'Acme Ltd', payment: 'credit', creditLimit: 1000 });
  cashCo = await create('hospital/corporate-clients', { name: 'CashCo', payment: 'cash' });

  const division = await create('hr/divisions', { name: 'Clinical' });
  const department = await create('hr/departments', { divisionId: division, name: 'Nursing' });
  const ward = await create('hr/sub-departments', { departmentId: department, name: 'Ward' });
  const designation = await create('hr/designations', { name: 'Staff Nurse' });
  const staff = (employeeNo: string, fullName: string) =>
    create('hr/staff', {
      departmentId: department,
      subDepartmentId: ward,
      designationId: designation,
      serviceNature: 'Permanent',
      salaryStatus: 'Regular',
      employeeNo,
      fullName,
      joiningDate: '2023-03-10',
    });
  jane = await staff('N-001', 'Jane');
  bob = await staff('N-002', 'Bob');
  const policy = await create(
    'payroll/salary-policies',
    { name: 'General', basicPercentOfGross: 60, houseRentPercentOfBasic: 50, medicalPercentOfBasic: 10 },
    officer,
  );
  // Jane is paid; Bob has no salary.
  await request(http)
    .put(`/api/v1/payroll/salaries/${jane}`)
    .set(bearer(officer))
    .send({ gross: 1_000, policyId: policy, pfEnabled: false })
    .expect(200);
});

describe('pharmacy credit', () => {
  it('sells to a company on credit within its limit across the hospital, and collects at the counter', async () => {
    const first = await sell(40, { corporateClientId: acme }).expect(201);
    expect(first.body).toMatchObject({ total: 400, due: 400 });
    await sell(50, { corporateClientId: acme }).expect(201);
    expect([await closing('corporate'), await closing('receivable')]).toEqual([900, 0]);

    const over = await sell(20, { corporateClientId: acme });
    expect([over.status, over.body.code]).toEqual([422, 'credit_limit']);
    // Part paid: 100 of 200 owed, up to the limit exactly.
    await sell(20, { corporateClientId: acme, tendered: 100 }).expect(201);
    const cash = await sell(5, { corporateClientId: cashCo });
    expect([cash.status, cash.body.code]).toEqual([422, 'cash_client']);
    await sell(5, { corporateClientId: cashCo, tendered: 50 }).expect(201);
    const both = await sell(5, { corporateClientId: acme, staffId: jane });
    expect([both.status, both.body.code]).toEqual([422, 'one_debtor']);
    const nobody = await sell(5, {});
    expect([nobody.status, nobody.body.code]).toEqual([422, 'due_needs_debtor']);

    const listed = await ph('get', `sales?corporateClientId=${acme}`, seller).expect(200);
    expect(listed.body.items.map((row: { corporateClientName: string; due: number }) => row.due)).toEqual([
      100, 500, 400,
    ]);
    expect(listed.body.items[0].corporateClientName).toBe('Acme Ltd');

    // The hospital counts what Acme owes the pharmacy: no more OPD credit.
    const group = await create('hospital/service-groups', { name: 'Emergency procedures' });
    const dressing = await create('hospital/services', { code: 'DR-01', name: 'Dressing', groupId: group, rate: 150 });
    const patient = await create('hospital/patients', {
      fullName: 'Selim Reza',
      sex: 'male',
      dateOfBirth: '1985-03-03',
      mobileNo: '01911000000',
    });
    const opd = await request(http)
      .post('/api/v1/hospital/opd-bills')
      .set(bearer(admin))
      .send({ patientId: patient, corporateClientId: acme, lines: [{ serviceId: dressing }] });
    expect([opd.status, opd.body.code]).toEqual([422, 'credit_limit']);

    const dues = await ph('get', `corporate-clients/${acme}/dues`, seller).expect(200);
    expect(dues.body).toMatchObject({ name: 'Acme Ltd', creditLimit: 1000, owed: 1000, due: 1000 });
    expect(dues.body.sales.map((sale: { due: number }) => sale.due)).toEqual([400, 500, 100]);

    const tooMuch = await ph('post', `corporate-clients/${acme}/collections`, seller, {
      collectedOn: '2026-04-12',
      amount: 1000.01,
    });
    expect(tooMuch.body.code).toBe('overpayment');
    const paid = await ph('post', `corporate-clients/${acme}/collections`, seller, {
      collectedOn: '2026-04-12',
      amount: 600,
    }).expect(201);
    expect(paid.body.number).toMatch(/^DC-/);
    const after = await ph('get', `corporate-clients/${acme}/dues`, seller).expect(200);
    expect(after.body).toMatchObject({ owed: 400, due: 400 });
    expect(after.body.sales.map((sale: { due: number; collected: number }) => sale.due - sale.collected)).toEqual([
      300, 100,
    ]);
    expect([await closing('corporate'), await closing('cash')]).toEqual([400, 750]);
    await request(http)
      .post('/api/v1/reports/pharmacy.due-receipt/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: paid.body.id } })
      .expect(200);
    await request(http)
      .post('/api/v1/reports/pharmacy.sale-receipt/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: first.body.id } })
      .expect(200);

    // Now there is room: the hospital bills Acme again.
    const billed = await request(http)
      .post('/api/v1/hospital/opd-bills')
      .set(bearer(admin))
      .send({ patientId: patient, corporateClientId: acme, lines: [{ serviceId: dressing }] });
    expect(billed.status, JSON.stringify(billed.body)).toBe(201);
  });

  it("puts a staff member's due on their staff ledger, takes returns and cancellations off, and collects it", async () => {
    const sold = await sell(30, { staffId: jane }).expect(201);
    expect(sold.body.due).toBe(300);
    await sell(20, { staffId: jane, tendered: 50 }).expect(201);
    expect(await closing('staff')).toBe(450);
    expect((await ledger(jane)).closing).toBe(450);

    // Five tablets back from the first sale; the second sale cancelled by the seller the same day.
    await ph('post', `sales/${sold.body.id}/returns`, seller, {
      version: 1,
      returnedOn: '2026-04-10',
      reason: 'Not needed',
      lines: [{ line: 1, qty: 5 }],
    }).expect(201);
    const second = (await ph('get', `sales?staffId=${jane}`, seller).expect(200)).body.items[0];
    expect(second.staffName).toBe('Jane');
    await ph('post', `sales/${second.id}/cancel`, seller, {
      version: second.version,
      on: '2026-04-10',
      reason: 'Wrong person',
    }).expect(204);
    const statement = await ledger(jane);
    expect(statement.closing).toBe(250);
    expect(statement.rows.map((row) => [row.debit, row.credit])).toEqual([
      [300, 0],
      [150, 0],
      [0, 50],
      [0, 150],
    ]);
    expect(await closing('staff')).toBe(250);

    const dues = await ph('get', `staff/${jane}/dues`, seller).expect(200);
    expect(dues.body).toMatchObject({ employeeNo: 'N-001', fullName: 'Jane', balance: 250 });
    const tooMuch = await ph('post', `staff/${jane}/collections`, seller, { collectedOn: '2026-04-15', amount: 251 });
    expect([tooMuch.status, tooMuch.body.code]).toEqual([422, 'overpayment']);
    const paid = await ph('post', `staff/${jane}/collections`, seller, {
      collectedOn: '2026-04-15',
      amount: 100,
    }).expect(201);
    expect((await ledger(jane)).closing).toBe(150);
    expect(await closing('staff')).toBe(150);
    await request(http)
      .post('/api/v1/reports/pharmacy.due-receipt/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: paid.body.id } })
      .expect(200);
  });

  it("recovers staff dues from the month's salary up to the net pay, before the sheet is committed", async () => {
    // Jane owes 1,500 against about 940 of pay; Bob owes 100 and is not paid this month.
    await sell(150, { staffId: jane }).expect(201);
    await sell(10, { staffId: bob }).expect(201);
    const preview = await request(http)
      .get('/api/v1/payroll/salary-sheets/2026/4/preview')
      .set(bearer(officer))
      .expect(200);
    const pay = preview.body.lines.find((line: { staffId: string }) => line.staffId === jane).netPayable as number;
    expect(pay).toBeLessThan(1_500);

    await request(http)
      .post('/api/v1/payroll/staff-dues/recover')
      .set(bearer(seller))
      .send({ year: 2026, month: 4 })
      .expect(403);
    const recovered = await request(http)
      .post('/api/v1/payroll/staff-dues/recover')
      .set(bearer(officer))
      .send({ year: 2026, month: 4 })
      .expect(200);
    expect(recovered.body).toEqual({
      lines: [
        { staffId: jane, employeeNo: 'N-001', fullName: 'Jane', owed: 1_500, recovered: pay },
        { staffId: bob, employeeNo: 'N-002', fullName: 'Bob', owed: 100, recovered: 0 },
      ],
      total: pay,
    });
    expect((await ledger(jane)).closing).toBe(1_500 - pay);
    const sheet = await request(http)
      .get('/api/v1/payroll/salary-sheets/2026/4/preview')
      .set(bearer(officer))
      .expect(200);
    expect(sheet.body.lines.find((line: { staffId: string }) => line.staffId === jane).netPayable).toBe(0);

    // Again: nothing more to take this month.
    const again = await request(http)
      .post('/api/v1/payroll/staff-dues/recover')
      .set(bearer(officer))
      .send({ year: 2026, month: 4 })
      .expect(200);
    expect(again.body.total).toBe(0);

    await request(http).post('/api/v1/payroll/salary-sheets/2026/4/approve').set(bearer(officer)).expect(200);
    await request(http).post('/api/v1/payroll/salary-sheets/2026/4/commit').set(bearer(officer)).expect(204);
    const late = await request(http)
      .post('/api/v1/payroll/staff-dues/recover')
      .set(bearer(officer))
      .send({ year: 2026, month: 4 })
      .expect(409);
    expect(late.body.code).toBe('salary_sheet_committed');
  });
});
