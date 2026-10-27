import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbContext } from '../../src/database/drizzle-transaction-manager.js';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let manager: string;
let cashier: string;
let nusrat: string;
let acme: string;
let rahima: string;
let karim: string;
let visit: string;
const bed: Record<string, string> = {};
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

async function backdate(admissionId: string, days: number) {
  const { db } = t.app.get(DbContext);
  const shift = sql.raw(`interval '${days} days'`);
  await db.execute(sql`update hospital_admissions set admitted_at = admitted_at - ${shift} where id = ${admissionId}`);
  await db.execute(sql`update hospital_bed_stays set from_at = from_at - ${shift} where admission_id = ${admissionId}`);
}

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

/** The rows under a sheet's header (the sheet opens with the title, filters and when it was made). */
const body = (rows: unknown[][], firstHeader: string) =>
  rows.slice(rows.findIndex((row) => row[0] === firstHeader) + 1);

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
  manager = await user('manager', 'Manager Mitu', [
    'ipd:read',
    'ipd:admit',
    'ipd:manage',
    'ipd:bill',
    'opd:read',
    'opd:manage',
    'opd:bill',
    'doctor:pay',
    'patient:read',
    'patient:manage',
  ]);
  cashier = await user('cashier', 'Cashier Rana', ['ipd:read', 'ipd:admit', 'ipd:bill', 'opd:read', 'opd:bill']);

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, role] of [
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['opdReceivable', '1', 'debit', '1210', 'OPD receivable', 'opd_receivable'],
    ['corporate', '1', 'debit', '1230', 'Corporate receivable', 'corporate_receivable'],
    ['advance', '2', 'credit', '2301', 'Patient advances', 'ipd_advance'],
    ['payable', '2', 'credit', '2201', 'Consultants payable', 'consultant_payable'],
    ['consultation', '4', 'credit', '4201', 'Consultation income', 'opd_consultation_income'],
    ['admission', '4', 'credit', '4301', 'Admission fees', 'ipd_admission_income'],
    ['bed', '4', 'credit', '4302', 'Bed rent', 'ipd_bed_income'],
    ['service', '4', 'credit', '4304', 'Indoor services', 'ipd_service_income'],
    ['discount', '5', 'debit', '5301', 'Indoor discount', 'ipd_discount'],
    ['fee', '5', 'debit', '5202', 'Doctor fees', 'doctor_fee_expense'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role, glAccountId: gl[key] });
  }

  nusrat = await create(
    'hospital/doctors',
    { name: 'Dr. Nusrat Jahan', isConsultant: true, newVisitFee: 1000, sharePercent: 50 },
    manager,
  );
  acme = await create(
    'hospital/corporate-clients',
    { name: 'Acme Ltd', payment: 'credit', creditLimit: 2500 },
    manager,
  );
  const group = await create('hospital/service-groups', { name: 'Ward' }, manager);
  visit = await create(
    'hospital/services',
    { name: 'Consultant visit', groupId: group, rate: 1000, sharePercent: 50, isOpd: false, isIpd: true },
    manager,
  );
  const ward = await create('hospital/wards', { name: 'Medicine ward' }, manager);
  const general = await create(
    'hospital/bed-categories',
    { name: 'General', admissionFee: 500, dailyRate: 1200 },
    manager,
  );
  for (const code of ['W-1', 'W-2', 'W-3']) {
    bed[code] = await create('hospital/beds', { code, wardId: ward, categoryId: general }, manager);
  }
  rahima = await patient('Rahima Begum', '01811000000');
  karim = await patient('Abdul Karim', '01711000000', { corporateClientId: acme });
});

describe('hospital statements', () => {
  it('pays a doctor from their ledger of OPD and indoor shares, with income, discounts and payables', async () => {
    // An OPD consultation (half of 1000 hers) and an indoor visit (half of 1000 hers).
    await api('post', 'opd-bills', cashier, {
      patientId: rahima,
      lines: [{ doctorId: nusrat }],
      payment: { amount: 1000 },
    }).expect(201);
    const admitted = await api('post', 'admissions', cashier, {
      patientId: rahima,
      bedId: bed['W-1'],
      doctorId: nusrat,
    });
    await api('post', `admissions/${admitted.body.id}/charges`, cashier, { serviceId: visit, doctorId: nusrat }).expect(
      201,
    );
    await api('post', `admissions/${admitted.body.id}/final-bill`, cashier, {
      discount: 100,
      discountReason: 'Staff family',
      payment: { amount: 1400 },
    }).expect(201);

    const tooMuch = await api('post', `doctors/${nusrat}/payments`, manager, { amount: 1500 });
    expect(tooMuch.body.code).toBe('overpayment');
    expect((await api('post', `doctors/${nusrat}/payments`, cashier, { amount: 100 })).status).toBe(403);
    const paid = await api('post', `doctors/${nusrat}/payments`, manager, {
      amount: 600,
      note: 'October, first part',
    }).expect(201);
    expect(paid.body).toEqual({ number: `DP-${year}-00001`, balance: 400 });

    const ledger = await api('get', `doctors/${nusrat}/ledger?from=${today}&to=${today}`, cashier).expect(200);
    expect(ledger.body).toMatchObject({ opening: 0, earned: 1000, reversed: 0, paid: 600, closing: 400 });
    expect(ledger.body.entries.map((entry: { kind: string; balance: number }) => [entry.kind, entry.balance])).toEqual([
      ['share', 500],
      ['share', 1000],
      ['payment', 400],
    ]);
    expect([await closing('payable'), await closing('fee'), await closing('cash')]).toEqual([-400, 1000, 1800]);

    expect(body(await sheet('hospital.doctor-payables', { from: today, to: today }), 'Doctor')).toEqual([
      ['Dr. Nusrat Jahan', 0, 1000, 0, 600, 400],
      ['Total', 0, 1000, 0, 600, 400],
    ]);
    const entries = await sheet('hospital.doctor-ledger', { doctorId: nusrat, from: today, to: today });
    expect(body(entries, 'Date').map((row) => [row[2], row[4]])).toEqual([
      ['Share earned', 500],
      ['Share earned', 1000],
      ['Paid', 400],
    ]);
    // The OPD report still counts shares only.
    const consultations = await sheet('hospital.doctor-consultations', { from: today, to: today });
    expect(consultations.find((row) => row[0] === 'Dr. Nusrat Jahan')).toBeDefined();

    const income = await sheet('hospital.income-by-head', { from: today, to: today });
    const head = (label: string) => income.find((row) => row[0] === label)?.slice(2);
    expect(head('OPD consultations')).toEqual([1000, 0, 1000]);
    expect(head('Admission fees')).toEqual([500, 0, 500]);
    expect(head('Indoor services and consultant visits')).toEqual([1000, 0, 1000]);
    expect(head('Less discounts')).toEqual([100, 0, 100]);
    expect(income.at(-1)).toEqual(['Net income', null, null, null, 2400]);

    const discounts = await sheet('hospital.discounts', { from: today, to: today });
    expect(body(discounts, 'Billed on').map((row) => [row[2], row[7], row[9], row[10]])).toEqual([
      ['Indoor', 100, 'Staff family', 'Cashier Rana'],
    ]);
  });

  it('lets a company settle OPD and indoor bills on one payment and holds admissions over its limit', async () => {
    // Acme owes 1000 for a consultation and 1700 for a night's stay.
    await api('post', 'opd-bills', cashier, { patientId: karim, lines: [{ doctorId: nusrat }] }).expect(201);
    const first = await api('post', 'admissions', cashier, { patientId: karim, bedId: bed['W-2'], doctorId: nusrat });
    await backdate(first.body.id, 1);
    const bill = await api('post', `admissions/${first.body.id}/final-bill`, cashier, {}).expect(201);
    expect(bill.body.due).toBe(1700);
    await api('post', `admissions/${first.body.id}/discharge`, cashier, { version: 1 }).expect(204);

    // At or over its limit of 2500: no more admissions for its people.
    const held = await api('post', 'admissions', cashier, { patientId: karim, bedId: bed['W-1'], doctorId: nusrat });
    expect(held.body.code).toBe('credit_limit');
    // A self-paying admission is not held.
    await api('post', 'admissions', cashier, {
      patientId: karim,
      bedId: bed['W-1'],
      doctorId: nusrat,
      corporateClientId: null,
    }).expect(201);

    const dues = await sheet('hospital.dues', { payer: 'corporate' });
    expect(body(dues, 'Billed on').map((row) => [row[1], row[6], row[8]])).toEqual([
      [`IB-${year}-00001`, 'Acme Ltd', 1700],
      [`OC-${year}-00001`, 'Acme Ltd', 1000],
    ]);

    const settled = await api('post', `corporate-clients/${acme}/collections`, cashier, { amount: 2000 }).expect(201);
    expect(settled.body).toEqual({
      number: `OR-${year}-00001`,
      settled: [
        { kind: 'ipd', billId: bill.body.id, number: `IB-${year}-00001`, amount: 1700 },
        { kind: 'opd', billId: expect.any(String), number: `OC-${year}-00001`, amount: 300 },
      ],
    });
    expect(await closing('corporate')).toBe(700);
    const indoorBill = await api('get', `ipd-bills/${bill.body.id}`, cashier).expect(200);
    expect(indoorBill.body).toMatchObject({ collected: 1700, due: 0 });
    expect(
      (
        await request(http)
          .post('/api/v1/reports/hospital.ipd-receipt/render')
          .set(bearer(admin))
          .send({ format: 'pdf', params: { number: `OR-${year}-00001` } })
      ).status,
    ).toBe(200);

    const statement = await sheet('hospital.corporate-statement', { clientId: acme, from: today, to: today });
    expect(body(statement, 'Billed on').map((row) => [row[1], row[6]])).toEqual([
      [`IB-${year}-00001`, 1700],
      [`OC-${year}-00001`, 1000],
    ]);
  });

  it('merges a duplicate record into the one kept, moving its bills, admission and visits', async () => {
    const duplicate = await patient('Rahima B.', '01811000001', { dateOfBirth: '1990-02-02' });
    await api('post', 'opd-bills', cashier, {
      patientId: duplicate,
      lines: [{ doctorId: nusrat }],
      payment: { amount: 1000 },
    }).expect(201);
    const admitted = await api('post', 'admissions', cashier, {
      patientId: duplicate,
      bedId: bed['W-1'],
      doctorId: nusrat,
      advance: { amount: 2000 },
    }).expect(201);
    const version = (await api('get', `patients/${duplicate}`, manager).expect(200)).body.version as number;

    expect(
      (await api('post', `patients/${duplicate}/merge`, cashier, { version, intoId: rahima, reason: 'Twice' })).status,
    ).toBe(403);
    const merged = await api('post', `patients/${duplicate}/merge`, manager, {
      version,
      intoId: rahima,
      reason: 'Registered twice',
    }).expect(200);
    expect(merged.body).toEqual({ appointments: 0, opdBills: 1, admissions: 1, ipdBills: 0, visits: 2 });

    const gone = await api('get', `patients/${duplicate}`, manager).expect(200);
    expect(gone.body).toMatchObject({ isActive: false, mergedIntoId: rahima });
    const again = await api('post', `patients/${duplicate}/reactivate`, manager, { version: gone.body.version });
    expect(again.body.code).toBe('patient_merged');
    expect((await api('get', `admissions/${admitted.body.id}`, manager).expect(200)).body.patientId).toBe(rahima);
    expect((await api('get', `opd-bills?patientId=${rahima}`, manager).expect(200)).body.total).toBe(1);

    // Two open admissions are never brought together.
    const third = await patient('Rahima Begum', '01811000009', { dateOfBirth: '1990-03-03' });
    await api('post', 'admissions', cashier, { patientId: third, bedId: bed['W-2'], doctorId: nusrat }).expect(201);
    const thirdVersion = (await api('get', `patients/${third}`, manager).expect(200)).body.version as number;
    const both = await api('post', `patients/${third}/merge`, manager, {
      version: thirdVersion,
      intoId: rahima,
      reason: 'Registered again',
    });
    expect(both.body.code).toBe('both_admitted');

    expect(
      (
        await request(http)
          .post('/api/v1/reports/hospital.patient-statement/render')
          .set(bearer(admin))
          .send({ format: 'pdf', params: { patientId: rahima } })
      ).status,
    ).toBe(200);
  });
});
