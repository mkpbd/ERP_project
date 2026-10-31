import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let manager: string;
let officer: string;
let nusrat: string;
let kamal: string;
let referrer: string;
let acme: string;
let karim: string;
let rahima: string;
const bed: Record<string, string> = {};

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

/** The books the final bill posts to: a company's patient billed the admission fee only. */
async function books() {
  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [nature, normalBalance, code, name, role] of [
    ['1', 'debit', '1230', 'Corporate receivable', 'corporate_receivable'],
    ['4', 'credit', '4301', 'Admission fees', 'ipd_admission_income'],
  ] as const) {
    const natureId = await create('accounts/natures', {
      code: nature,
      name: `Nature ${nature}`,
      statement: nature === '4' ? 'profit_and_loss' : 'balance_sheet',
      normalBalance,
    });
    const category = await create('accounts/categories', { natureId, code: `${code}C`, name: `${name} group` });
    const sub = await create('accounts/sub-categories', { categoryId: category, name: 'General' });
    const head4 = await create('accounts/level4-heads', { subCategoryId: sub, name: 'General' });
    const head5 = await create('accounts/level5-heads', { level4HeadId: head4, name: 'General' });
    const glAccountId = await create('accounts/gl-accounts', { level5HeadId: head5, code, name });
    await create('accounts/gl-roles', { role, glAccountId });
  }
}

const api = (method: 'get' | 'post', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/hospital/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const bedStatus = async (code: string) =>
  ((await api('get', `beds/${bed[code]}`, officer).expect(200)).body as { status: string }).status;

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
  await books();
  manager = await user('manager', ['ipd:read', 'ipd:admit', 'ipd:manage', 'opd:read', 'opd:manage']);
  officer = await user('officer', ['ipd:read', 'ipd:admit', 'patient:read', 'patient:register']);

  nusrat = await create('hospital/doctors', { name: 'Dr. Nusrat Jahan', isConsultant: true }, manager);
  kamal = await create('hospital/doctors', { name: 'Dr. Kamal Uddin', isConsultant: true }, manager);
  referrer = await create('hospital/doctors', { name: 'Dr. Referrer' }, manager);
  acme = await create('hospital/corporate-clients', { name: 'Acme Ltd', payment: 'credit' }, manager);
  const medicine = await create('hospital/wards', { name: 'Medicine ward', floor: '3rd floor' }, manager);
  const icu = await create('hospital/wards', { name: 'ICU', floor: '5th floor' }, manager);
  const general = await create(
    'hospital/bed-categories',
    { name: 'General', admissionFee: 500, dailyRate: 1200 },
    manager,
  );
  const intensive = await create(
    'hospital/bed-categories',
    { name: 'ICU', admissionFee: 1000, dailyRate: 6000, isIntensive: true },
    manager,
  );
  bed['W-1'] = await create('hospital/beds', { code: 'W-1', wardId: medicine, categoryId: general }, manager);
  bed['W-2'] = await create(
    'hospital/beds',
    { code: 'W-2', wardId: medicine, categoryId: general, dailyRate: 1500, displayOrder: 2 },
    manager,
  );
  bed['ICU-1'] = await create('hospital/beds', { code: 'ICU-1', wardId: icu, categoryId: intensive }, manager);
  karim = (
    await api('post', 'patients', officer, {
      fullName: 'Abdul Karim',
      sex: 'male',
      dateOfBirth: '1980-05-17',
      mobileNo: '01711000000',
      corporateClientId: acme,
    }).expect(201)
  ).body.id as string;
  rahima = (
    await api('post', 'patients', officer, {
      fullName: 'Rahima Begum',
      sex: 'female',
      dateOfBirth: '1990-01-01',
      mobileNo: '01811000000',
    }).expect(201)
  ).body.id as string;
});

describe('admissions, beds and discharge', () => {
  it('admits once to a free bed, moves beds through housekeeping, changes doctors and discharges', async () => {
    expect(
      (await request(http).post('/api/v1/hospital/beds').set(bearer(officer)).send({ code: 'X', wardId: nusrat }))
        .status,
    ).toBe(403);
    const admitted = await api('post', 'admissions', officer, {
      patientId: karim,
      bedId: bed['W-1'],
      doctorId: nusrat,
      additionalDoctorIds: [kamal],
      kind: 'emergency',
      reason: 'Chest pain',
      referredById: referrer,
    }).expect(201);
    expect(admitted.body.number).toBe(`IP-${year}-00001`);
    const twice = await api('post', 'admissions', officer, { patientId: karim, bedId: bed['W-2'], doctorId: nusrat });
    expect([twice.status, twice.body.code]).toEqual([409, 'already_admitted']);
    const taken = await api('post', 'admissions', officer, { patientId: rahima, bedId: bed['W-1'], doctorId: nusrat });
    expect([taken.status, taken.body.code]).toEqual([409, 'bed_unavailable']);
    const notHere = await api('post', 'admissions', officer, {
      patientId: rahima,
      bedId: bed['W-2'],
      doctorId: referrer,
    });
    expect(notHere.body.code).toBe('not_bookable');
    const second = await api('post', 'admissions', officer, {
      patientId: rahima,
      bedId: bed['W-2'],
      doctorId: kamal,
    }).expect(201);

    const view = await api('get', `admissions/${admitted.body.id}`, officer).expect(200);
    expect(view.body).toMatchObject({
      status: 'admitted',
      kind: 'emergency',
      bedCode: 'W-1',
      wardName: 'Medicine ward',
      doctorName: 'Dr. Nusrat Jahan',
      referredByName: 'Dr. Referrer',
      corporateClientName: 'Acme Ltd',
      admissionFee: 500,
      stays: [{ bedCode: 'W-1', categoryName: 'General', dailyRate: 1200, toAt: null }],
    });
    expect((await api('get', `admissions/${second.body.id}`, officer).expect(200)).body).toMatchObject({
      corporateClientId: null,
      stays: [{ bedCode: 'W-2', dailyRate: 1500 }],
    });
    const board = await api('get', 'bed-board', officer).expect(200);
    expect(board.body.counts).toEqual({ available: 1, occupied: 2, housekeeping: 0, out_of_order: 0 });
    expect(board.body.wards.map((ward: { name: string }) => ward.name)).toEqual(['ICU', 'Medicine ward']);

    // Karim goes to the ICU; his bed waits for housekeeping before anyone else gets it.
    const moved = await api('post', `admissions/${admitted.body.id}/transfer`, officer, {
      version: 1,
      bedId: bed['ICU-1'],
      reason: 'Needs ventilation',
    });
    expect(moved.status).toBe(204);
    expect(await bedStatus('W-1')).toBe('housekeeping');
    const notReady = await api('post', `admissions/${second.body.id}/transfer`, officer, {
      version: 1,
      bedId: bed['W-1'],
      reason: 'Window bed',
    });
    expect(notReady.body.code).toBe('bed_unavailable');
    expect((await api('post', `beds/${bed['W-1']}/status`, officer, { status: 'out_of_order' })).status).toBe(403);
    const occupiedOut = await api('post', `beds/${bed['ICU-1']}/status`, manager, { status: 'out_of_order' });
    expect([occupiedOut.status, occupiedOut.body.code]).toEqual([409, 'bed_occupied']);
    await api('post', `beds/${bed['W-1']}/status`, officer, { status: 'available' }).expect(204);

    await api('post', `admissions/${admitted.body.id}/consultant`, officer, { version: 2, doctorId: kamal }).expect(
      204,
    );
    await api('post', `admissions/${admitted.body.id}/additional-doctors`, officer, {
      version: 3,
      doctorIds: [nusrat],
    }).expect(204);
    const unbilled = await api('post', `admissions/${admitted.body.id}/discharge`, officer, { version: 4 });
    expect(unbilled.body.code).toBe('bill_needed');
    await api('post', `admissions/${admitted.body.id}/final-bill`, admin, {}).expect(201);
    const noNote = await api('post', `admissions/${admitted.body.id}/discharge`, officer, { version: 4, type: 'lama' });
    expect(noNote.body.code).toBe('invalid_remarks');
    await api('post', `admissions/${admitted.body.id}/discharge`, officer, {
      version: 4,
      type: 'lama',
      note: 'Family took him home',
    }).expect(204);
    expect(await bedStatus('ICU-1')).toBe('housekeeping');
    const discharged = await api('get', `admissions/${admitted.body.id}`, officer).expect(200);
    expect(discharged.body).toMatchObject({
      status: 'discharged',
      dischargeType: 'lama',
      bedCode: 'ICU-1',
      doctorName: 'Dr. Kamal Uddin',
    });
    expect(
      discharged.body.stays.map((stay: { bedCode: string; reason: string }) => [stay.bedCode, stay.reason]),
    ).toEqual([
      ['W-1', 'Admitted'],
      ['ICU-1', 'Needs ventilation'],
    ]);
    expect(
      discharged.body.doctors.map((doctor: { doctorName: string; role: string }) => [doctor.doctorName, doctor.role]),
    ).toEqual([
      ['Dr. Nusrat Jahan', 'primary'],
      ['Dr. Kamal Uddin', 'additional'],
      ['Dr. Kamal Uddin', 'primary'],
      ['Dr. Nusrat Jahan', 'additional'],
    ]);

    expect(
      (await api('post', `admissions/${second.body.id}/cancel`, officer, { version: 1, reason: 'Wrong' })).status,
    ).toBe(403);
    await api('post', `admissions/${second.body.id}/cancel`, manager, {
      version: 1,
      reason: 'Admitted by mistake',
    }).expect(204);
    expect(await bedStatus('W-2')).toBe('housekeeping');
    // Discharged and cancelled, Karim can be admitted again.
    await api('post', 'admissions', officer, { patientId: karim, bedId: bed['W-1'], doctorId: nusrat }).expect(201);
    expect((await api('get', 'admissions?status=admitted', officer).expect(200)).body.total).toBe(1);
    // Found by the patient's name or the admission number.
    const found = await api('get', 'admissions?q=karim&status=admitted', officer).expect(200);
    expect(found.body.items.map((row: { patientName: string }) => row.patientName)).toEqual(['Abdul Karim']);
    const byNumber = await api('get', `admissions?q=${found.body.items[0].number}`, officer).expect(200);
    expect(byNumber.body.total).toBe(1);
    expect((await api('get', 'admissions?q=nobody', officer).expect(200)).body.total).toBe(0);

    await request(http)
      .post('/api/v1/reports/hospital.admission-form/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: admitted.body.id } })
      .expect(200);
    const census = await sheet('hospital.inpatient-census', {});
    expect(census.find((row) => row[1] === 'W-1')?.slice(3, 6)).toEqual([
      'occupied',
      `IP-${year}-00003`,
      'Abdul Karim',
    ]);
    expect(census.find((row) => row[1] === 'ICU-1')?.[3]).toBe('housekeeping');
    const register = await sheet('hospital.admission-register', { from: today, to: today });
    expect(register.filter((row) => String(row[0]).startsWith('IP-')).map((row) => [row[0], row[8], row[10]])).toEqual([
      [`IP-${year}-00001`, 'Left against medical advice', 'Discharged'],
      [`IP-${year}-00002`, null, 'Cancelled'],
      [`IP-${year}-00003`, null, 'Admitted'],
    ]);
    // Same-day stays use no night yet.
    const occupancy = await sheet('hospital.bed-occupancy', { from: today, to: today });
    expect(occupancy.find((row) => row[0] === 'General')).toEqual(['General', 2, 2, 0, 0]);
    expect(occupancy.find((row) => row[0] === 'ICU')).toEqual(['ICU', 1, 1, 0, 0]);
  });

  it('puts an admission right while the patient is in, and gives visitor passes up to the limit', async () => {
    const admitted = await api('post', 'admissions', officer, {
      patientId: rahima,
      bedId: bed['W-1'],
      doctorId: nusrat,
    }).expect(201);
    const id = admitted.body.id as string;
    const correct = (body: object) =>
      request(http).put(`/api/v1/hospital/admissions/${id}`).set(bearer(officer)).send(body);
    const unchanged = { kind: 'elective', reason: null, referredById: null, corporateClientId: null, staffId: null };
    expect((await correct({ version: 1, ...unchanged })).body.code).toBe('nothing_changed');
    const corrected = await correct({
      version: 1,
      ...unchanged,
      kind: 'emergency',
      reason: '  Chest pain ',
      referredById: referrer,
      corporateClientId: acme,
    }).expect(200);
    expect(corrected.body).toEqual({
      version: 2,
      changed: ['kind', 'reason', 'referredById', 'corporateClientId'],
    });
    expect((await api('get', `admissions/${id}`, officer).expect(200)).body).toMatchObject({
      kind: 'emergency',
      reason: 'Chest pain',
      referredById: referrer,
      corporateClientName: 'Acme Ltd',
    });
    expect((await correct({ version: 1, ...unchanged })).body.code).toBe('stale_admission');

    // Two passes in force at once (the policy's default); one handed back makes room for another.
    const pass = (visitorName: string) =>
      api('post', `admissions/${id}/visitor-passes`, officer, {
        visitorName,
        relation: 'Husband',
        mobileNo: '01711000001',
      });
    const first = await pass('Abdul Rahim').expect(201);
    expect(first.body.number).toBe(`VP-${year}-00001`);
    const second = await pass('Fatema Begum').expect(201);
    const third = await pass('Jamal Uddin');
    expect([third.status, third.body.code]).toEqual([409, 'pass_limit']);
    await api('post', `visitor-passes/${first.body.id}/return`, officer).expect(204);
    expect((await api('post', `visitor-passes/${first.body.id}/return`, officer)).body.code).toBe('pass_state');
    await pass('Jamal Uddin').expect(201);
    const passes = await api('get', `admissions/${id}/visitor-passes`, officer).expect(200);
    expect(
      passes.body.items.map((row: { visitorName: string; valid: boolean }) => [row.visitorName, row.valid]),
    ).toEqual([
      ['Jamal Uddin', true],
      ['Fatema Begum', true],
      ['Abdul Rahim', false],
    ]);
    const card = (passId: string) =>
      request(http)
        .post('/api/v1/reports/hospital.visitor-pass/render')
        .set(bearer(admin))
        .send({ format: 'pdf', params: { id: passId } });
    expect((await card(second.body.id)).status).toBe(200);
    expect((await card(first.body.id)).body.code).toBe('pass_not_valid');
  });
});
