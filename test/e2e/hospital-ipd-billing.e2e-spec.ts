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
let dressing: string;
let ecg: string;
const bed: Record<string, string> = {};
const gl: Record<string, string> = {};

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const dhaka = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
const today = dhaka(new Date());
const daysAgo = (days: number) => dhaka(new Date(Date.now() - days * 86_400_000));
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
      .get(`/api/v1/accounts/books/ledger?glAccountId=${gl[account]}&from=${daysAgo(10)}&to=${today}`)
      .set(bearer(admin))
      .expect(200)
  ).body.closing as number;

const api = (method: 'get' | 'post' | 'put', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/hospital/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};

/** Moves an admission back by some days, as if the patient came in then. */
async function backdate(admissionId: string, days: number) {
  const { db } = t.app.get(DbContext);
  const shift = sql.raw(`interval '${days} days'`);
  await db.execute(sql`update hospital_admissions set admitted_at = admitted_at - ${shift} where id = ${admissionId}`);
  await db.execute(sql`update hospital_bed_stays set from_at = from_at - ${shift} where admission_id = ${admissionId}`);
}

async function sheet(key: string, params: Record<string, unknown>): Promise<unknown[][]> {
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

const pdf = (key: string, params: Record<string, unknown>) =>
  request(http).post(`/api/v1/reports/${key}/render`).set(bearer(admin)).send({ format: 'pdf', params });

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
    'ipd:discount',
    'opd:read',
    'opd:manage',
  ]);
  cashier = await user('cashier', 'Cashier Rana', ['ipd:read', 'ipd:admit', 'ipd:bill', 'patient:read']);

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, role] of [
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['receivable', '1', 'debit', '1220', 'IPD receivable', 'ipd_receivable'],
    ['corporate', '1', 'debit', '1230', 'Corporate receivable', 'corporate_receivable'],
    ['advance', '2', 'credit', '2301', 'Patient advances', 'ipd_advance'],
    ['payable', '2', 'credit', '2201', 'Consultants payable', 'consultant_payable'],
    ['admission', '4', 'credit', '4301', 'Admission fees', 'ipd_admission_income'],
    ['bed', '4', 'credit', '4302', 'Bed rent', 'ipd_bed_income'],
    ['round', '4', 'credit', '4303', 'Round fees', 'ipd_round_income'],
    ['service', '4', 'credit', '4304', 'Indoor services', 'ipd_service_income'],
    ['charge', '4', 'credit', '4305', 'Service charge', 'ipd_service_charge_income'],
    ['discount', '5', 'debit', '5301', 'Indoor discount', 'ipd_discount'],
    ['fee', '5', 'debit', '5202', 'Doctor fees', 'doctor_fee_expense'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role, glAccountId: gl[key] });
  }

  nusrat = await create('hospital/doctors', { name: 'Dr. Nusrat Jahan', isConsultant: true }, manager);
  acme = await create(
    'hospital/corporate-clients',
    { name: 'Acme Ltd', payment: 'credit', discountPercent: 10 },
    manager,
  );
  const group = await create('hospital/service-groups', { name: 'Ward' }, manager);
  const service = (name: string, rate: number, extra: Record<string, unknown>) =>
    create('hospital/services', { name, groupId: group, rate, ...extra }, manager);
  visit = await service('Consultant visit', 1000, { sharePercent: 50, isOpd: false, isIpd: true });
  dressing = await service('Dressing', 200, { isOpd: true, isIpd: true });
  ecg = await service('ECG', 400, { isOpd: true, isIpd: false });
  const medicine = await create('hospital/wards', { name: 'Medicine ward' }, manager);
  const general = await create(
    'hospital/bed-categories',
    { name: 'General', admissionFee: 500, dailyRate: 1200 },
    manager,
  );
  bed['W-1'] = await create('hospital/beds', { code: 'W-1', wardId: medicine, categoryId: general }, manager);
  bed['W-2'] = await create('hospital/beds', { code: 'W-2', wardId: medicine, categoryId: general }, manager);
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
  rahima = await patient('Rahima Begum', '01811000000');
  karim = await patient('Abdul Karim', '01711000000', { corporateClientId: acme });
  await api('put', 'ipd-policy', cashier, {
    roundFeePerNight: 300,
    serviceChargePercent: 10,
    counterDiscountPercent: 5,
  }).expect(403);
  await api('put', 'ipd-policy', manager, {
    roundFeePerNight: 300,
    serviceChargePercent: 10,
    counterDiscountPercent: 5,
  }).expect(204);
});

describe('the indoor bill', () => {
  it('charges a stay, takes advances, makes the final bill and lets the patient go only when cleared', async () => {
    const admitted = await api('post', 'admissions', cashier, {
      patientId: rahima,
      bedId: bed['W-1'],
      doctorId: nusrat,
      advance: { amount: 3000, method: 'cash' },
    }).expect(201);
    const id = admitted.body.id as string;
    expect(admitted.body.receipt).toBe(`AR-${year}-00001`);
    await backdate(id, 3);

    // Charges: a consultant's visits (with her share) and a dressing taken off again.
    const twoVisits = await api('post', `admissions/${id}/charges`, cashier, {
      serviceId: visit,
      doctorId: nusrat,
      qty: 2,
      chargedOn: daysAgo(1),
    }).expect(201);
    expect(twoVisits.body.amount).toBe(2000);
    const noDoctor = await api('post', `admissions/${id}/charges`, cashier, { serviceId: visit });
    expect(noDoctor.body.code).toBe('doctor_needed');
    const outdoor = await api('post', `admissions/${id}/charges`, cashier, { serviceId: ecg });
    expect(outdoor.body.code).toBe('not_billable');
    const early = await api('post', `admissions/${id}/charges`, cashier, {
      serviceId: dressing,
      chargedOn: daysAgo(5),
    });
    expect(early.body.code).toBe('invalid_date');
    const dressed = await api('post', `admissions/${id}/charges`, cashier, { serviceId: dressing }).expect(201);
    await api('post', `admissions/${id}/charges/${dressed.body.id}/cancel`, cashier, { reason: 'Not done' }).expect(
      204,
    );

    // Bill so far: admission fee, 3 nights at 1200 and the round fee with 10 % service charge, and the visits.
    const account = await api('get', `admissions/${id}/account`, cashier).expect(200);
    expect(account.body).toMatchObject({
      asOf: today,
      nights: 3,
      gross: 7000,
      serviceCharge: 500,
      total: 7500,
      held: 3000,
      balance: 4500,
      bill: null,
    });
    expect(account.body.lines.map((line: { head: string; amount: number }) => [line.head, line.amount])).toEqual([
      ['admission', 500],
      ['bed', 3600],
      ['round', 900],
      ['service', 2000],
    ]);
    expect(account.body.charges.map((charge: { status: string }) => charge.status)).toEqual(['active', 'cancelled']);

    // An admission with charges is not cancelled; advance held is refunded no more than held.
    const cancel = await api('post', `admissions/${id}/cancel`, manager, { version: 1, reason: 'Wrong' });
    expect(cancel.body.code).toBe('has_charges');
    const tooMuch = await api('post', `admissions/${id}/refunds`, cashier, { amount: 5000 });
    expect(tooMuch.body.code).toBe('overpayment');
    const refunded = await api('post', `admissions/${id}/refunds`, cashier, { amount: 500 }).expect(201);
    expect(refunded.body).toEqual({ number: `AF-${year}-00001`, held: 2500 });

    // No discharge without the final bill; the counter's discount is limited.
    const unbilled = await api('post', `admissions/${id}/discharge`, cashier, { version: 1 });
    expect(unbilled.body.code).toBe('bill_needed');
    const generous = await api('post', `admissions/${id}/final-bill`, cashier, {
      discount: 1000,
      discountReason: 'Poor',
    });
    expect(generous.status).toBe(403);
    expect(generous.body.code).toBe('discount_limit');
    const billed = await api('post', `admissions/${id}/final-bill`, cashier, {
      discount: 300,
      discountReason: 'Poor',
      payment: { amount: 2000, method: 'cash' },
    }).expect(201);
    expect(billed.body).toMatchObject({
      number: `IB-${year}-00001`,
      net: 7200,
      due: 2700,
      receipt: `IR-${year}-00001`,
    });
    const again = await api('post', `admissions/${id}/final-bill`, cashier, {});
    expect(again.body.code).toBe('bill_made');
    const late = await api('post', `admissions/${id}/charges`, cashier, { serviceId: dressing });
    expect(late.body.code).toBe('bill_made');

    // Leaving with a due of her own needs a manager.
    const owing = await api('post', `admissions/${id}/discharge`, cashier, { version: 1 });
    expect(owing.status).toBe(403);
    expect(owing.body.code).toBe('due_on_discharge');
    await api('post', `ipd-bills/${billed.body.id}/collections`, cashier, { version: 1, amount: 700 }).expect(201);
    await api('post', `admissions/${id}/discharge`, manager, { version: 1 }).expect(204);
    const kept = await api('post', `ipd-bills/${billed.body.id}/cancel`, manager, { version: 2, reason: 'Late' });
    expect(kept.body.code).toBe('admission_state');
    const stale = await api('post', `ipd-bills/${billed.body.id}/collections`, cashier, { version: 1, amount: 10 });
    expect(stale.body.code).toBe('stale_bill');
    const paid = await api('post', `ipd-bills/${billed.body.id}/collections`, cashier, {
      version: 2,
      amount: 2000,
    }).expect(201);
    expect(paid.body).toEqual({ number: `IR-${year}-00003`, due: 0 });

    const bill = await api('get', `ipd-bills/${billed.body.id}`, cashier).expect(200);
    expect(bill.body).toMatchObject({
      nights: 3,
      gross: 7000,
      serviceCharge: 500,
      discount: 300,
      net: 7200,
      deposit: 2500,
      paid: 2000,
      collected: 2700,
      due: 0,
      status: 'billed',
    });
    const dues = await api('get', 'ipd-bills?withDue=true', cashier).expect(200);
    expect(dues.body.total).toBe(0);

    // Books: the advance is used up, the patient owes nothing, the doctor is owed her half of the visits.
    expect([await closing('cash'), await closing('advance'), await closing('receivable')]).toEqual([7200, 0, 0]);
    expect([
      await closing('admission'),
      await closing('bed'),
      await closing('round'),
      await closing('service'),
      await closing('charge'),
    ]).toEqual([-500, -3600, -900, -2000, -500]);
    expect([await closing('discount'), await closing('fee'), await closing('payable')]).toEqual([300, 1000, -1000]);

    // Prints and the collection sheet.
    expect((await pdf('hospital.ipd-bill', { admissionId: id })).status).toBe(200);
    expect((await pdf('hospital.ipd-receipt', { number: `ar-${year}-00001` })).status).toBe(200);
    expect((await pdf('hospital.ipd-collection', { from: today, to: today })).status).toBe(200);
    const collection = await sheet('hospital.ipd-collection', { from: today, to: today });
    const rana = collection.find((row) => row[0] === 'Cashier Rana')!;
    // Receipts 5; advance 3000, on the bill 2000, collected 2700, paid back 500 — all cash; 7200 to hand over.
    expect([rana[1], rana[2], rana[6], rana[10], rana[14], rana[18], rana[21]]).toEqual([
      5, 3000, 2000, 2700, 500, 7200, 7200,
    ]);
  });

  it("bills a company's patient with its discount, cancels and re-bills, and refunds before cancelling", async () => {
    const admitted = await api('post', 'admissions', cashier, {
      patientId: karim,
      bedId: bed['W-2'],
      doctorId: nusrat,
    });
    const id = admitted.body.id as string;
    await backdate(id, 1);
    // Acme's 10 % comes off unless the counter says otherwise: 500 + 1200 + 300 + 200 service charge = 2200.
    const billed = await api('post', `admissions/${id}/final-bill`, cashier, {}).expect(201);
    expect(billed.body).toMatchObject({ net: 1980, due: 1980 });
    const view = await api('get', `ipd-bills/${billed.body.id}`, cashier).expect(200);
    expect(view.body).toMatchObject({ corporateClientName: 'Acme Ltd', discountReason: 'Corporate: Acme Ltd' });

    // A charge forgotten: the bill is cancelled on its day and made again.
    await api('post', `ipd-bills/${billed.body.id}/cancel`, cashier, { version: 1, reason: 'Visit missed' }).expect(
      200,
    );
    await api('post', `admissions/${id}/charges`, cashier, { serviceId: visit, doctorId: nusrat }).expect(201);
    const rebilled = await api('post', `admissions/${id}/final-bill`, cashier, { discount: 0 }).expect(201);
    expect(rebilled.body).toMatchObject({ number: `IB-${year}-00002`, net: 3200, due: 3200 });
    // The company owes it; no manager needed to let him go.
    await api('post', `admissions/${id}/discharge`, cashier, { version: 1 }).expect(204);
    expect(await closing('corporate')).toBe(3200);
    expect([await closing('service'), await closing('payable')]).toEqual([-1000, -500]);

    // Another admission made by mistake, with an advance: refunded first, then cancelled.
    const mistaken = await api('post', 'admissions', cashier, {
      patientId: rahima,
      bedId: bed['W-1'],
      doctorId: nusrat,
      advance: { amount: 1000, method: 'cash' },
    }).expect(201);
    const held = await api('post', `admissions/${mistaken.body.id}/cancel`, manager, { version: 1, reason: 'Wrong' });
    expect(held.body.code).toBe('has_advance');
    await api('post', `admissions/${mistaken.body.id}/refunds`, cashier, { amount: 1000 }).expect(201);
    await api('post', `admissions/${mistaken.body.id}/cancel`, manager, { version: 1, reason: 'Wrong' }).expect(204);
    expect(await closing('advance')).toBe(0);
  });
});
