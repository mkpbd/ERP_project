import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let nurse: string;
let doctor: string;
let registrar: string;
let admission: string;
let ceftriaxone: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

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

const cl = (method: 'get' | 'post' | 'put', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/clinical/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
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
  nurse = (await user('nurse', ['emr:read', 'emr:write'])).token;
  const nusrat = await user('nusrat', ['emr:read', 'emr:order']);
  doctor = nusrat.token;
  registrar = (await user('registrar', ['emr:read', 'emr:order'])).token;

  const doctorId = await create('hospital/doctors', {
    name: 'Dr. Nusrat Jahan',
    degrees: 'MBBS, FCPS (Medicine)',
    isConsultant: true,
    userId: nusrat.id,
  });
  const ward = await create('hospital/wards', { name: 'Medicine ward' });
  const general = await create('hospital/bed-categories', { name: 'General', admissionFee: 500, dailyRate: 1200 });
  const bed = await create('hospital/beds', { code: 'M-1', wardId: ward, categoryId: general });
  const patient = await create('hospital/patients', {
    fullName: 'Karim Uddin',
    sex: 'male',
    dateOfBirth: '1965-03-01',
    mobileNo: '01711000000',
  });
  admission = await create('hospital/admissions', { patientId: patient, bedId: bed, doctorId });

  const maker = await create('pharmacy/manufacturers', { name: 'Square' });
  ceftriaxone = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Ceftron', manufacturerId: maker }),
    genericId: await create('pharmacy/generics', { name: 'Ceftriaxone' }),
    formationId: await create('pharmacy/formations', { name: 'Injection', shortName: 'Inj.' }),
  });
});

describe('treatment', () => {
  it('orders medicines, charts the doses given or missed, and holds and stops them', async () => {
    const every4h = {
      productId: ceftriaxone,
      dose: '1 g in 100 ml NS over 30 min',
      route: 'iv',
      schedule: 'interval',
      intervalHours: 4,
    };
    expect((await cl('post', `admissions/${admission}/orders`, nurse, every4h)).status).toBe(403);
    expect((await cl('post', `admissions/${admission}/orders`, registrar, every4h)).body.code).toBe('doctor_needed');
    const bad = await cl('post', `admissions/${admission}/orders`, doctor, { ...every4h, times: ['08:00'] });
    expect(bad.body.code).toBe('invalid_schedule');
    const antibiotic = await cl('post', `admissions/${admission}/orders`, doctor, every4h).expect(201);
    const once = await cl('post', `admissions/${admission}/orders`, doctor, {
      drugName: 'Inj. Ondansetron 8 mg',
      dose: '8 mg',
      route: 'iv',
      schedule: 'once',
    }).expect(201);
    const prn = await cl('post', `admissions/${admission}/orders`, doctor, {
      drugName: 'Tab. Paracetamol 500 mg',
      dose: '2 tablets',
      route: 'oral',
      schedule: 'prn',
      note: 'If temperature above 101 °F',
    }).expect(201);
    await cl('post', `admissions/${admission}/orders`, doctor, {
      drugName: 'Tab. Omeprazole 20 mg',
      dose: '1 capsule',
      route: 'oral',
      schedule: 'times',
      times: ['20:00', '07:00'],
    }).expect(201);

    const orders = await cl('get', `admissions/${admission}/orders`, nurse).expect(200);
    expect(orders.body.items).toHaveLength(4);
    const first = orders.body.items.find((entry: { id: string }) => entry.id === antibiotic.body.id);
    expect(first).toMatchObject({ drugName: 'Inj. Ceftron', doctorName: 'Dr. Nusrat Jahan', status: 'active' });
    const startAt = first.startAt as string;
    const later = new Date(Date.parse(startAt) + 4 * 3_600_000).toISOString();

    // Doses: the due one given, a time that is not due, early or missed before its time, twice.
    const dose = (orderId: string, body: object) => cl('post', `orders/${orderId}/doses`, nurse, body);
    expect(
      (
        await dose(antibiotic.body.id, {
          dueAt: new Date(Date.parse(startAt) + 60_000).toISOString(),
          outcome: 'given',
        })
      ).body.code,
    ).toBe('not_due');
    expect((await dose(antibiotic.body.id, { dueAt: later, outcome: 'given' })).body.code).toBe('invalid_time');
    expect((await dose(antibiotic.body.id, { dueAt: later, outcome: 'missed', reason: 'x' })).body.code).toBe(
      'not_due',
    );
    expect((await dose(antibiotic.body.id, { dueAt: startAt, outcome: 'missed' })).body.code).toBe('invalid_text');
    await dose(antibiotic.body.id, { dueAt: startAt, outcome: 'given' }).expect(201);
    expect((await dose(antibiotic.body.id, { dueAt: startAt, outcome: 'given' })).body.code).toBe('dose_recorded');
    const onceAt = orders.body.items.find((entry: { id: string }) => entry.id === once.body.id).startAt as string;
    await dose(once.body.id, { dueAt: onceAt, outcome: 'missed', reason: 'Patient vomiting, refused' }).expect(201);
    expect((await dose(prn.body.id, { dueAt: onceAt, outcome: 'given' })).body.code).toBe('invalid_dose');
    await dose(prn.body.id, { outcome: 'given' }).expect(201);

    const chart = await cl('get', `admissions/${admission}/chart`, nurse).expect(200);
    expect(chart.body.day).toBe(today);
    const byId = (id: string) => chart.body.orders.find((entry: { id: string }) => entry.id === id);
    expect(byId(antibiotic.body.id).slots[0]).toMatchObject({ dueAt: startAt, state: 'given' });
    expect(byId(once.body.id).slots).toEqual([
      expect.objectContaining({
        state: 'missed',
        record: expect.objectContaining({ reason: 'Patient vomiting, refused' }),
      }),
    ]);
    expect(byId(prn.body.id).doses).toHaveLength(1);
    expect(chart.body.orders).toHaveLength(4);

    // Held (nothing falls due), resumed, stopped for good.
    expect((await cl('post', `orders/${antibiotic.body.id}/hold`, nurse, { version: 1, reason: 'x' })).status).toBe(
      403,
    );
    await cl('post', `orders/${antibiotic.body.id}/hold`, doctor, { version: 1, reason: 'Rash after the dose' }).expect(
      200,
    );
    expect(
      (await dose(antibiotic.body.id, { dueAt: later, outcome: 'given', givenAt: new Date().toISOString() })).body.code,
    ).toBe('not_due');
    await cl('post', `orders/${antibiotic.body.id}/resume`, doctor, { version: 2 }).expect(200);
    await cl('post', `orders/${antibiotic.body.id}/stop`, doctor, { version: 3, reason: 'Switched to oral' }).expect(
      200,
    );
    const stopped = await cl('get', `admissions/${admission}/orders?status=stopped`, nurse).expect(200);
    expect(stopped.body.items[0].events.map((entry: { event: string; byName: string }) => entry.event)).toEqual([
      'start',
      'hold',
      'resume',
      'stop',
    ]);
    expect((await cl('post', `orders/${antibiotic.body.id}/resume`, doctor, { version: 4 })).body.code).toBe(
      'order_state',
    );

    expect((await pdf('clinical.medication-chart', { admissionId: admission, day: today })).status).toBe(200);
  });

  it('writes, signs and reopens the discharge summary', async () => {
    const summary = {
      course: 'Admitted with fever and cough. Treated with IV ceftriaxone; improved by day 3.',
      treatment: [
        { productId: ceftriaxone, name: 'Tab. Cefuroxime 500 mg', dose: '1+0+1 after meal', duration: '7 days' },
      ],
      diet: 'Normal diet, plenty of fluids',
      followUpOn: nextWeek,
    };
    expect((await cl('get', `admissions/${admission}/discharge-summary`, nurse)).status).toBe(404);
    expect(
      (await cl('put', `admissions/${admission}/discharge-summary`, doctor, { version: 1, ...summary })).status,
    ).toBe(404);
    await cl('put', `admissions/${admission}/discharge-summary`, doctor, summary).expect(200);
    expect((await cl('put', `admissions/${admission}/discharge-summary`, doctor, summary)).body.code).toBe(
      'stale_summary',
    );
    expect((await cl('post', `admissions/${admission}/discharge-summary/sign`, doctor, { version: 1 })).body.code).toBe(
      'diagnosis_needed',
    );
    await cl('put', `admissions/${admission}/discharge-summary`, doctor, {
      version: 1,
      ...summary,
      diagnosis: 'Community-acquired pneumonia',
    }).expect(200);
    await cl('post', `admissions/${admission}/discharge-summary/sign`, doctor, { version: 2 }).expect(200);
    const signed = await cl('get', `admissions/${admission}/discharge-summary`, nurse).expect(200);
    expect(signed.body).toMatchObject({ status: 'signed', doctorName: 'Dr. Nusrat Jahan', version: 3 });
    expect(
      (await cl('put', `admissions/${admission}/discharge-summary`, doctor, { version: 3, ...summary })).body.code,
    ).toBe('summary_signed');
    expect((await pdf('clinical.discharge-summary', { admissionId: admission })).status).toBe(200);

    await cl('post', `admissions/${admission}/discharge-summary/reopen`, doctor, { version: 3 }).expect(200);
    expect((await pdf('clinical.discharge-summary', { admissionId: admission })).body.code).toBe('not_signed');
  });

  it('orders nursing care done at its times, and charts observations at the rounds with their flags', async () => {
    // Care: turning every 2 hours, ordered by the doctor, done by the nurse.
    const turning = {
      order: 'Turn the patient',
      instruction: 'Left, back, right',
      schedule: 'interval',
      intervalHours: 2,
    };
    expect((await cl('post', `admissions/${admission}/care-orders`, nurse, turning)).status).toBe(403);
    const care = await cl('post', `admissions/${admission}/care-orders`, doctor, turning).expect(201);
    const [order] = (await cl('get', `admissions/${admission}/orders`, nurse).expect(200)).body.items;
    expect(order).toMatchObject({ kind: 'care', drugName: 'Turn the patient', dose: 'Left, back, right', route: null });
    await cl('post', `orders/${care.body.id}/doses`, nurse, { dueAt: order.startAt, outcome: 'given' }).expect(201);
    const careChart = await cl('get', `admissions/${admission}/chart?kind=care`, nurse).expect(200);
    expect(careChart.body.orders[0].slots[0].state).toBe('given');
    expect((await cl('get', `admissions/${admission}/chart?kind=medicine`, nurse).expect(200)).body.orders).toEqual([]);
    expect((await pdf('clinical.care-chart', { admissionId: admission, day: today })).status).toBe(200);

    // The wards' rounds cover the day; a reading answers the round of its time.
    for (const [name, startTime, endTime] of [
      ['Morning', '06:00', '12:00'],
      ['Day', '12:00', '18:00'],
      ['Evening', '18:00', '22:00'],
      ['Night', '22:00', '06:00'],
    ]) {
      await cl('post', 'observation-rounds', admin, { name, startTime, endTime }).expect(201);
    }
    const observe = (body: object, token = nurse) => cl('post', `admissions/${admission}/observations`, token, body);
    expect((await observe({ pulse: 80 }, doctor)).status).toBe(403);
    expect((await observe({ systolic: 120 })).body.code).toBe('invalid_vitals');
    expect((await observe({ pulse: 400 })).body.code).toBe('invalid_vitals');
    expect((await observe({})).body.code).toBe('invalid_vitals');
    const ahead = new Date(Date.now() + 3_600_000).toISOString();
    expect((await observe({ pulse: 80, takenAt: ahead })).body.code).toBe('invalid_time');
    const reading = await observe({
      temperatureF: 101.2,
      pulse: 124,
      respRate: 22,
      systolic: 128,
      diastolic: 82,
      spo2: 95,
      painScore: 4,
      note: 'Restless',
    }).expect(201);
    expect(reading.body.flags).toEqual(['fever', 'tachycardia']);

    const sheet = await cl('get', `admissions/${admission}/observations`, doctor).expect(200);
    expect(sheet.body.items).toHaveLength(1);
    expect(sheet.body.items[0]).toMatchObject({ temperatureF: 101.2, pulse: 124, recordedByName: 'nurse' });
    expect(['Morning', 'Day', 'Evening', 'Night']).toContain(sheet.body.items[0].roundName);
    const board = await cl('get', 'observation-board', nurse).expect(200);
    expect(board.body.rounds.map((round: { name: string }) => round.name)).toEqual([
      'Morning',
      'Day',
      'Evening',
      'Night',
    ]);
    const [bedside] = board.body.patients;
    expect(bedside.rounds.filter((state: string | null) => state === 'done')).toHaveLength(1);
    expect(bedside.lastFlags).toEqual(['fever', 'tachycardia']);
    expect((await pdf('clinical.observation-chart', { admissionId: admission, from: today, to: today })).status).toBe(
      200,
    );

    // Entered on the wrong patient: struck through, kept, and no longer counted.
    expect((await cl('post', `observations/${reading.body.id}/strike`, nurse, { reason: ' ' })).body.code).toBe(
      'invalid_text',
    );
    await cl('post', `observations/${reading.body.id}/strike`, nurse, { reason: 'Wrong patient' }).expect(204);
    const struck = await cl('get', `admissions/${admission}/observations`, nurse).expect(200);
    expect(struck.body.items[0]).toMatchObject({ struckReason: 'Wrong patient', struckByName: 'nurse' });
    const after = (await cl('get', 'observation-board', nurse).expect(200)).body.patients[0];
    expect([after.rounds.includes('done'), after.lastFlags]).toEqual([false, []]);
  });
});
