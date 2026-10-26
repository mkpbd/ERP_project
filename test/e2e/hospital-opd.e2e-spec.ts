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
let nusrat: string;
let kamal: string;
let patient: { id: string; uhid: number };
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

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  manager = await user('manager', 'Manager Mitu', ['opd:read', 'opd:manage', 'opd:bill', 'opd:discount']);
  cashier = await user('cashier', 'Cashier Rana', [
    'opd:read',
    'opd:bill',
    'opd:book',
    'patient:read',
    'patient:register',
  ]);

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, role] of [
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['card', '1', 'debit', '1002', 'Card receipts', 'card_receipts'],
    ['receivable', '1', 'debit', '1210', 'OPD receivable', 'opd_receivable'],
    ['payable', '2', 'credit', '2201', 'Consultants payable', 'consultant_payable'],
    ['income', '4', 'credit', '4201', 'Consultation income', 'opd_consultation_income'],
    ['discount', '5', 'debit', '5201', 'OPD discount', 'opd_discount'],
    ['fee', '5', 'debit', '5202', 'Doctor fees', 'doctor_fee_expense'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role, glAccountId: gl[key] });
  }

  const doctor = (name: string, extra: Record<string, unknown>) =>
    create('hospital/doctors', { name, isConsultant: true, ...extra }, manager);
  nusrat = await doctor('Dr. Nusrat Jahan', {
    roomNo: '204',
    firstVisitFee: 1000,
    newVisitFee: 800,
    followUpFee: 500,
    reportFee: 300,
    sharePercent: 50,
  });
  kamal = await doctor('Dr. Kamal Uddin', { newVisitFee: 600, followUpFee: 400 });
  await create(
    'hospital/doctor-schedules',
    {
      doctorId: nusrat,
      dayOfWeek: new Date(`${today}T00:00:00Z`).getUTCDay(),
      startTime: '17:00',
      slotMinutes: 15,
      maxPatients: 20,
    },
    manager,
  );
  const registered = await api('post', 'patients', cashier, {
    fullName: 'Abdul Karim',
    sex: 'male',
    dateOfBirth: '1980-05-17',
    mobileNo: '01711000000',
  }).expect(201);
  patient = registered.body as { id: string; uhid: number };
});

describe('OPD consultation billing', () => {
  it('bills an appointment, limits the discount, posts, collects the due and cancels with everything given back', async () => {
    expect((await api('get', 'opd-policy', cashier).expect(200)).body).toEqual({
      followUpDays: 30,
      defaultSharePercent: 40,
      counterDiscountPercent: 10,
    });
    expect(
      (
        await api('put', 'opd-policy', cashier, {
          followUpDays: 14,
          defaultSharePercent: 40,
          counterDiscountPercent: 10,
        })
      ).status,
    ).toBe(403);
    await api('put', 'opd-policy', manager, {
      followUpDays: 30,
      defaultSharePercent: 40,
      counterDiscountPercent: 10,
    }).expect(204);

    const booked = await api('post', 'appointments', cashier, {
      doctorId: nusrat,
      appointmentDate: today,
      patientId: patient.id,
    }).expect(201);
    expect(booked.body.fee).toBe(800);
    expect(
      (await api('get', `opd-bills/visit-suggestion?patientId=${patient.id}&doctorId=${nusrat}`, cashier).expect(200))
        .body,
    ).toEqual({
      visitType: 'new',
      lastVisitOn: null,
      fee: 800,
    });

    // Nusrat 800 (her own 50 %) and Kamal 600 (the policy's 40 %): 1,400; the counter may take 140 off.
    const body = {
      patientId: patient.id,
      appointmentId: booked.body.id,
      lines: [{ doctorId: nusrat }, { doctorId: kamal }],
      discount: 150,
      discountReason: 'Staff relative',
      payment: { method: 'cash', amount: 1000 },
    };
    const limited = await api('post', 'opd-bills', cashier, body);
    expect([limited.status, limited.body.code]).toEqual([403, 'discount_limit']);
    const billed = await api('post', 'opd-bills', cashier, { ...body, discount: 140 }).expect(201);
    expect(billed.body).toMatchObject({ number: `OC-${year}-00001`, net: 1260, due: 260 });
    const again = await api('post', 'opd-bills', cashier, { ...body, discount: 140 });
    expect([again.status, again.body.code]).toEqual([422, 'appointment_billed']);
    expect((await api('get', `appointments/${booked.body.id}`, cashier).expect(200)).body.status).toBe('arrived');

    const view = await api('get', `opd-bills/${billed.body.id}`, cashier).expect(200);
    expect(view.body).toMatchObject({
      uhid: patient.uhid,
      gross: 1400,
      discount: 140,
      paid: 1000,
      due: 260,
      voucherNumber: expect.stringMatching(/^JV-/),
      lines: [
        { doctorName: 'Dr. Nusrat Jahan', visitType: 'new', fee: 800, sharePercent: 50, shareAmount: 400 },
        { doctorName: 'Dr. Kamal Uddin', visitType: 'new', fee: 600, sharePercent: 40, shareAmount: 240 },
      ],
    });
    expect([await closing('cash'), await closing('receivable'), await closing('discount')]).toEqual([1000, 260, 140]);
    expect([await closing('income'), await closing('fee'), await closing('payable')]).toEqual([-1400, 640, -640]);

    const due = await api('get', 'opd-bills?withDue=true', cashier).expect(200);
    expect(due.body.total).toBe(1);
    const stale = await api('post', `opd-bills/${billed.body.id}/collections`, cashier, { version: 2, amount: 260 });
    expect(stale.body.code).toBe('stale_bill');
    const over = await api('post', `opd-bills/${billed.body.id}/collections`, cashier, { version: 1, amount: 260.01 });
    expect(over.body.code).toBe('overpayment');
    const collected = await api('post', `opd-bills/${billed.body.id}/collections`, cashier, {
      version: 1,
      amount: 260,
      method: 'card',
      reference: 'VISA 4411',
    }).expect(201);
    expect(collected.body.number).toBe(`OR-${year}-00001`);
    expect([await closing('receivable'), await closing('card')]).toEqual([0, 260]);
    expect((await api('get', 'opd-bills?withDue=true', cashier).expect(200)).body.total).toBe(0);

    // Seen today, so the next visit to Nusrat is a follow-up.
    expect(
      (await api('get', `opd-bills/visit-suggestion?patientId=${patient.id}&doctorId=${nusrat}`, cashier).expect(200))
        .body,
    ).toMatchObject({
      visitType: 'follow_up',
      lastVisitOn: today,
      fee: 500,
    });

    const cancelled = await api('post', `opd-bills/${billed.body.id}/cancel`, cashier, {
      version: 2,
      reason: 'Billed the wrong doctor',
    }).expect(200);
    expect(cancelled.body.refunded).toBe(1260);
    expect([await closing('cash'), await closing('card'), await closing('receivable')]).toEqual([0, 0, 0]);
    expect([
      await closing('income'),
      await closing('discount'),
      await closing('fee'),
      await closing('payable'),
    ]).toEqual([0, 0, 0, 0]);
    expect(
      (await api('post', `opd-bills/${billed.body.id}/cancel`, cashier, { version: 3, reason: 'x' })).body.code,
    ).toBe('bill_state');
    const after = await api('get', `opd-bills/${billed.body.id}`, cashier).expect(200);
    expect(
      after.body.payments.map((payment: { kind: string; method: string; amount: number }) => [
        payment.kind,
        payment.method,
        payment.amount,
      ]),
    ).toEqual([
      ['payment', 'cash', 1000],
      ['collection', 'card', 260],
      ['refund', 'cash', 1000],
      ['refund', 'card', 260],
    ]);

    // A free report visit posts nothing; a manager discounts above the counter's limit and leaves the rest due.
    const walkIn = await api('post', 'opd-bills', manager, {
      patientId: patient.id,
      lines: [{ doctorId: kamal, visitType: 'report' }],
      discount: 0,
    });
    expect(walkIn.status, JSON.stringify(walkIn.body)).toBe(201);
    expect(walkIn.body).toMatchObject({ net: 0, due: 0 });
    const generous = await api('post', 'opd-bills', manager, {
      patientId: patient.id,
      lines: [{ doctorId: kamal, visitType: 'follow_up' }],
      discount: 200,
      discountReason: 'Poor patient',
    }).expect(201);
    expect(generous.body).toMatchObject({ net: 200, due: 200 });

    await request(http)
      .post('/api/v1/reports/hospital.opd-receipt/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: billed.body.id } })
      .expect(200);
    const counter = await sheet('hospital.opd-collection', { from: today, to: today });
    // At billing, dues collected, paid back, net: cash, card, mobile, total each.
    expect(counter.find((row) => row[0] === 'Cashier Rana')).toEqual([
      'Cashier Rana',
      1000,
      0,
      0,
      1000,
      0,
      260,
      0,
      260,
      -1000,
      -260,
      0,
      -1260,
      0,
      0,
      0,
      0,
    ]);
    const consultations = await sheet('hospital.doctor-consultations', { from: today, to: today });
    // Visits by kind, fees, cancelled visits and fees, net fees, share earned, taken back, net.
    expect(consultations.find((row) => row[0] === 'Dr. Nusrat Jahan')).toEqual([
      'Dr. Nusrat Jahan',
      0,
      1,
      0,
      0,
      800,
      1,
      800,
      0,
      400,
      400,
      0,
    ]);
    expect(consultations.find((row) => row[0] === 'Dr. Kamal Uddin')?.slice(1, 6)).toEqual([0, 1, 1, 1, 1000]);
  });

  it('refuses doctors who do not see patients, appointments of others and unknown patients', async () => {
    const referrer = await create('hospital/doctors', { name: 'Dr. Referrer' }, manager);
    const notHere = await api('post', 'opd-bills', cashier, { patientId: patient.id, lines: [{ doctorId: referrer }] });
    expect([notHere.status, notHere.body.code]).toEqual([422, 'not_bookable']);
    const someone = await api('post', 'appointments', cashier, {
      doctorId: nusrat,
      appointmentDate: today,
      patientName: 'Someone Else',
      mobileNo: '01911000000',
    }).expect(201);
    const other = await api('post', 'patients', cashier, {
      fullName: 'Rahima Begum',
      sex: 'female',
      dateOfBirth: '1990-01-01',
      mobileNo: '01811000000',
    }).expect(201);
    // An appointment booked by name is attached to the patient billed for it.
    await api('post', 'opd-bills', cashier, {
      patientId: other.body.id,
      appointmentId: someone.body.id,
      lines: [{ doctorId: nusrat }],
      payment: { method: 'cash', amount: 800 },
    }).expect(201);
    expect((await api('get', `appointments/${someone.body.id}`, cashier).expect(200)).body).toMatchObject({
      patientId: other.body.id,
      status: 'arrived',
    });
    const mine = await api('post', 'appointments', cashier, {
      doctorId: nusrat,
      appointmentDate: today,
      patientId: patient.id,
    }).expect(201);
    const wrong = await api('post', 'opd-bills', cashier, {
      patientId: other.body.id,
      appointmentId: mine.body.id,
      lines: [{ doctorId: nusrat }],
    });
    expect(wrong.body.code).toBe('appointment_mismatch');
    const noDoctor = await api('post', 'opd-bills', cashier, {
      patientId: patient.id,
      appointmentId: mine.body.id,
      lines: [{ doctorId: kamal }],
    });
    expect(noDoctor.body.code).toBe('appointment_mismatch');
    expect((await api('post', 'opd-bills', cashier, { patientId: nusrat, lines: [{ doctorId: nusrat }] })).status).toBe(
      404,
    );
  });
});
