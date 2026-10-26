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
let kamal: string;
let dressing: string;
let nebulisation: string;
let patient: string;
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

const api = (method: 'get' | 'post', path: string, token: string, body?: object) => {
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

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  manager = await user('manager', ['opd:read', 'opd:manage', 'opd:bill', 'opd:discount']);
  cashier = await user('cashier', ['opd:read', 'opd:bill', 'patient:read', 'patient:register']);

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, role] of [
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['receivable', '1', 'debit', '1210', 'OPD receivable', 'opd_receivable'],
    ['corporate', '1', 'debit', '1220', 'Corporate receivable', 'corporate_receivable'],
    ['staff', '1', 'debit', '1230', 'Staff receivable', 'staff_receivable'],
    ['payable', '2', 'credit', '2201', 'Consultants payable', 'consultant_payable'],
    ['consultations', '4', 'credit', '4201', 'Consultation income', 'opd_consultation_income'],
    ['services', '4', 'credit', '4202', 'OPD service income', 'opd_service_income'],
    ['discount', '5', 'debit', '5201', 'OPD discount', 'opd_discount'],
    ['fee', '5', 'debit', '5202', 'Doctor fees', 'doctor_fee_expense'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role, glAccountId: gl[key] });
  }

  kamal = await create(
    'hospital/doctors',
    { name: 'Dr. Kamal Uddin', isConsultant: true, newVisitFee: 600, sharePercent: 0 },
    manager,
  );
  const emergency = await create('hospital/service-groups', { name: 'Emergency procedures' }, manager);
  dressing = await create(
    'hospital/services',
    { code: 'DR-01', name: 'Dressing', groupId: emergency, rate: 150.5 },
    manager,
  );
  nebulisation = await create(
    'hospital/services',
    { code: 'NB-01', name: 'Nebulisation', groupId: emergency, rate: 200, sharePercent: 25 },
    manager,
  );
  patient = (
    await api('post', 'patients', cashier, {
      fullName: 'Abdul Karim',
      sex: 'male',
      dateOfBirth: '1980-05-17',
      mobileNo: '01711000000',
    }).expect(201)
  ).body.id as string;
});

describe('OPD and emergency services', () => {
  it('bills services by quantity at their rate, shares with the doctor who gave one, and cancels', async () => {
    const ward = await create('hospital/service-groups', { name: 'Ward' }, manager);
    const wardOnly = await create(
      'hospital/services',
      { name: 'Bed making', groupId: ward, rate: 50, isOpd: false, isIpd: true },
      manager,
    );
    const retired = await create(
      'hospital/services',
      { name: 'Old dressing', groupId: ward, rate: 90, isActive: false },
      manager,
    );
    for (const serviceId of [wardOnly, retired]) {
      const refused = await api('post', 'opd-bills', cashier, { patientId: patient, lines: [{ serviceId }] });
      expect([refused.status, refused.body.code]).toEqual([422, 'not_billable']);
    }
    const noGiver = await api('post', 'opd-bills', cashier, {
      patientId: patient,
      lines: [{ serviceId: nebulisation }],
    });
    expect([noGiver.status, noGiver.body.code]).toEqual([422, 'doctor_needed']);

    const billed = await api('post', 'opd-bills', cashier, {
      patientId: patient,
      lines: [
        { serviceId: dressing, qty: 3 },
        { serviceId: nebulisation, qty: 2, doctorId: kamal },
      ],
      payment: { method: 'cash', amount: 851.5 },
    }).expect(201);
    expect(billed.body).toMatchObject({ number: `OS-${year}-00001`, net: 851.5, due: 0 });
    const view = await api('get', `opd-bills/${billed.body.id}`, cashier).expect(200);
    expect(
      view.body.lines.map((line: Record<string, unknown>) => [
        line.serviceName,
        line.qty,
        line.rate,
        line.fee,
        line.doctorName,
        line.shareAmount,
      ]),
    ).toEqual([
      ['Dressing', 3, 150.5, 451.5, null, 0],
      ['Nebulisation', 2, 200, 400, 'Dr. Kamal Uddin', 100],
    ]);
    expect([await closing('services'), await closing('fee'), await closing('payable'), await closing('cash')]).toEqual([
      -851.5, 100, -100, 851.5,
    ]);

    // A consultation and a service on one bill: each to its own income.
    await api('post', 'opd-bills', cashier, {
      patientId: patient,
      lines: [{ doctorId: kamal }, { serviceId: dressing }],
      payment: { method: 'cash', amount: 750.5 },
    }).expect(201);
    expect([await closing('consultations'), await closing('services')]).toEqual([-600, -1002]);

    await api('post', `opd-bills/${billed.body.id}/cancel`, cashier, { version: 1, reason: 'Wrong patient' }).expect(
      200,
    );
    expect([await closing('services'), await closing('fee'), await closing('payable')]).toEqual([-150.5, 0, 0]);

    const income = await sheet('hospital.service-income', { from: today, to: today });
    // Group, service, units, fees, units cancelled, fees cancelled, net fees.
    expect(income.find((row) => row[1] === 'Dressing')).toEqual([
      'Emergency procedures',
      'Dressing',
      4,
      602,
      3,
      451.5,
      150.5,
    ]);
    expect(income.find((row) => row[1] === 'Nebulisation')).toEqual([
      'Emergency procedures',
      'Nebulisation',
      2,
      400,
      2,
      400,
      0,
    ]);
  });

  it("bills corporate clients' people to the company within its limit, collects oldest first, and bills staff", async () => {
    const acme = await create(
      'hospital/corporate-clients',
      { name: 'Acme Ltd', payment: 'credit', creditLimit: 1000, discountPercent: 10, contactPerson: 'Mr. Hasan' },
      manager,
    );
    const cashCo = await create('hospital/corporate-clients', { name: 'CashCo', payment: 'cash' }, manager);

    // 600 + 150.50 less Acme's 10 %, all owed by Acme.
    const first = await api('post', 'opd-bills', cashier, {
      patientId: patient,
      corporateClientId: acme,
      lines: [{ doctorId: kamal }, { serviceId: dressing }],
    }).expect(201);
    expect(first.body).toMatchObject({ net: 675.45, due: 675.45 });
    const firstView = await api('get', `opd-bills/${first.body.id}`, cashier).expect(200);
    expect(firstView.body).toMatchObject({
      discount: 75.05,
      discountReason: 'Corporate: Acme Ltd',
      corporateClientName: 'Acme Ltd',
    });
    expect([await closing('corporate'), await closing('receivable')]).toEqual([675.45, 0]);

    const over = await api('post', 'opd-bills', cashier, {
      patientId: patient,
      corporateClientId: acme,
      lines: [{ serviceId: dressing, qty: 3 }],
    });
    expect([over.status, over.body.code]).toEqual([422, 'credit_limit']);
    const unpaid = await api('post', 'opd-bills', cashier, {
      patientId: patient,
      corporateClientId: cashCo,
      lines: [{ serviceId: dressing }],
    });
    expect([unpaid.status, unpaid.body.code]).toEqual([422, 'payment_needed']);
    await api('post', 'opd-bills', cashier, {
      patientId: patient,
      corporateClientId: cashCo,
      lines: [{ serviceId: dressing }],
      payment: { method: 'cash', amount: 150.5 },
    }).expect(201);

    // Acme pays 500; the second bill now fits its limit.
    const tooMuch = await api('post', `corporate-clients/${acme}/collections`, cashier, { amount: 675.46 });
    expect(tooMuch.body.code).toBe('overpayment');
    await api('post', `corporate-clients/${acme}/collections`, cashier, { amount: 500 }).expect(201);
    const second = await api('post', 'opd-bills', cashier, {
      patientId: patient,
      corporateClientId: acme,
      lines: [{ serviceId: dressing, qty: 3 }],
    }).expect(201);
    expect(second.body).toMatchObject({ net: 406.35, due: 406.35 });
    const settled = await api('post', `corporate-clients/${acme}/collections`, cashier, {
      amount: 581.8,
      method: 'cash',
      reference: 'Cheque 7781',
    }).expect(201);
    expect(settled.body).toMatchObject({
      number: `OR-${year}-00002`,
      settled: [
        { number: first.body.number, amount: 175.45 },
        { number: second.body.number, amount: 406.35 },
      ],
    });
    expect(await closing('corporate')).toBe(0);
    expect((await api('get', `opd-bills?corporateClientId=${acme}&withDue=true`, cashier).expect(200)).body.total).toBe(
      0,
    );

    const statement = await sheet('hospital.corporate-statement', { clientId: acme, from: today, to: today });
    expect(statement.find((row) => row[1] === first.body.number)?.slice(4, 7)).toEqual([675.45, 0, 675.45]);
    expect(statement.find((row) => row[1] === second.body.number)?.slice(4, 7)).toEqual([406.35, 0, 406.35]);

    // A nurse billed as staff: what she does not pay is owed by her.
    const division = await create('hr/divisions', { name: 'Clinical' });
    const department = await create('hr/departments', { divisionId: division, name: 'Nursing' });
    const nurse = await create('hr/staff', {
      employeeNo: 'FAK-0001',
      fullName: 'Rahima Akter',
      departmentId: department,
      subDepartmentId: await create('hr/sub-departments', { departmentId: department, name: 'ICU' }),
      designationId: await create('hr/designations', { name: 'Staff Nurse', joiningSalary: 25000 }),
      joiningDate: '2020-01-15',
      serviceNature: 'Permanent',
      salaryStatus: 'Regular',
      dateOfBirth: '1990-05-01',
      sex: 'female',
      mobileNo: '01700000000',
    });
    const both = await api('post', 'opd-bills', cashier, {
      patientId: patient,
      corporateClientId: acme,
      staffId: nurse,
      lines: [{ serviceId: dressing }],
    });
    expect(both.body.code).toBe('invalid_payer');
    const staffBill = await api('post', 'opd-bills', cashier, {
      patientId: patient,
      staffId: nurse,
      lines: [{ serviceId: dressing }],
    }).expect(201);
    expect(staffBill.body.due).toBe(150.5);
    expect(await closing('staff')).toBe(150.5);
    expect((await api('get', `opd-bills?staffId=${nurse}`, cashier).expect(200)).body.total).toBe(1);
    await request(http)
      .post('/api/v1/reports/hospital.opd-receipt/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: staffBill.body.id } })
      .expect(200);
  });
});
