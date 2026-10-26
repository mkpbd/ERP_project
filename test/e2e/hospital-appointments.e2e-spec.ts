import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let manager: string;
let clerk: string;
let consultant: string;
let referrer: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const inDays = (days: number) => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const weekday = (isoDay: string) => new Date(`${isoDay}T00:00:00Z`).getUTCDay();
const tomorrow = inDays(1);

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

const api = (method: 'get' | 'post', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/hospital/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const book = (body: Record<string, unknown>, token = clerk) =>
  api('post', 'appointments', token, { doctorId: consultant, appointmentDate: tomorrow, ...body });
const walkIn = { patientName: 'Abdul Karim', mobileNo: '01711000000' };

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  manager = await user('manager', ['opd:read', 'opd:manage']);
  clerk = await user('clerk', ['opd:read', 'opd:book', 'patient:read', 'patient:register']);

  const medicine = await create('hospital/specialities', { name: 'Medicine' }, manager);
  consultant = await create(
    'hospital/doctors',
    {
      code: 'D-101',
      name: 'Dr. Nusrat Jahan',
      degrees: 'MBBS, FCPS (Medicine)',
      specialityId: medicine,
      roomNo: '204',
      isConsultant: true,
      firstVisitFee: 1000,
      newVisitFee: 800,
      followUpFee: 500,
      reportFee: 300,
    },
    manager,
  );
  referrer = await create('hospital/doctors', { name: 'Dr. Kamal Uddin' }, manager);
  for (const date of [today, tomorrow]) {
    await create(
      'hospital/doctor-schedules',
      { doctorId: consultant, dayOfWeek: weekday(date), startTime: '17:00', slotMinutes: 15, maxPatients: 3 },
      manager,
    );
  }
});

describe('doctors and appointments', () => {
  it('keeps doctors, their sittings and days off; only managers change them', async () => {
    expect((await request(http).post('/api/v1/hospital/doctors').set(bearer(clerk)).send({ name: 'X' })).status).toBe(
      403,
    );
    const again = await request(http)
      .post('/api/v1/hospital/doctors')
      .set(bearer(manager))
      .send({ code: 'd-101', name: 'Someone' });
    expect([again.status, again.body.code]).toEqual([409, 'doctor_code_taken']);
    const twice = await request(http)
      .post('/api/v1/hospital/doctor-schedules')
      .set(bearer(manager))
      .send({ doctorId: consultant, dayOfWeek: weekday(today), startTime: '09:00', slotMinutes: 10, maxPatients: 5 });
    expect([twice.status, twice.body.code]).toEqual([409, 'schedule_day_taken']);
    const consultants = await request(http)
      .get('/api/v1/hospital/doctors?isConsultant=true')
      .set(bearer(clerk))
      .expect(200);
    expect(JSON.stringify(consultants.body)).toContain('Dr. Nusrat Jahan');
    expect(JSON.stringify(consultants.body)).not.toContain('Dr. Kamal Uddin');

    await create(
      'hospital/doctor-closures',
      { doctorId: consultant, closedOn: inDays(8), reason: 'Conference' },
      manager,
    );
    const off = await book({ ...walkIn, appointmentDate: inDays(8) });
    expect([off.status, off.body.code, off.body.detail]).toEqual([
      422,
      'doctor_off',
      expect.stringContaining('Conference'),
    ]);
    expect((await book({ ...walkIn, appointmentDate: inDays(2) })).body.code).toBe('doctor_off');
    expect((await book({ ...walkIn, doctorId: referrer })).body.code).toBe('not_bookable');
    expect((await book({ ...walkIn, appointmentDate: inDays(-7) })).body.code).toBe('invalid_date');
  });

  it('books serials under a lock, frees a cancelled one, and moves a booking through the day', async () => {
    expect((await book(walkIn, manager)).status).toBe(403);
    const first = await book({ ...walkIn, referredById: referrer }).expect(201);
    expect(first.body).toMatchObject({ serial: 1, slotTime: '17:00', fee: 800 });
    expect((await book({ ...walkIn, serial: 3, visitType: 'follow_up' }).expect(201)).body).toMatchObject({
      serial: 3,
      slotTime: '17:30',
      fee: 500,
    });
    const taken = await book({ ...walkIn, serial: 3 });
    expect([taken.status, taken.body.code]).toEqual([409, 'serial_taken']);
    const second = await book({ patientName: 'Rahima Begum', mobileNo: '+8801811000000' }).expect(201);
    expect(second.body.serial).toBe(2);
    expect((await book(walkIn)).body.code).toBe('fully_booked');
    expect((await book({ patientName: 'X' })).body.code).toBe('patient_needed');

    // Serial 2 is cancelled; two counters then race for it and only one gets it.
    await api('post', `appointments/${second.body.id}/cancel`, clerk, { version: 1, reason: 'Patient called' }).expect(
      204,
    );
    const race = await Promise.all([book(walkIn), book(walkIn)]);
    expect(race.map((response) => response.status).sort()).toEqual([201, 422]);

    const board = await api('get', `doctors/${consultant}/day?date=${tomorrow}`, clerk).expect(200);
    expect(board.body.sitting).toEqual({ startTime: '17:00', slotMinutes: 15, maxPatients: 3 });
    expect(
      board.body.slots.map((slot: { time: string; appointment: unknown }) => [slot.time, slot.appointment !== null]),
    ).toEqual([
      ['17:00', true],
      ['17:15', true],
      ['17:30', true],
    ]);
    const view = await api('get', `appointments/${first.body.id}`, clerk).expect(200);
    expect(view.body).toMatchObject({
      doctorName: 'Dr. Nusrat Jahan',
      roomNo: '204',
      referredByName: 'Dr. Kamal Uddin',
      patientId: null,
      uhid: null,
      status: 'booked',
    });

    // A walk-in today registers, is attached and arrives; another misses the day.
    const todays = await book({ ...walkIn, appointmentDate: today }).expect(201);
    const early = await api('post', `appointments/${todays.body.id}/arrive`, clerk, { version: 1 });
    expect([early.status, early.body.code]).toEqual([422, 'patient_not_registered']);
    const patient = await request(http)
      .post('/api/v1/hospital/patients')
      .set(bearer(clerk))
      .send({ fullName: 'Abdul Karim', sex: 'male', dateOfBirth: '1980-05-17', mobileNo: '01711000000' })
      .expect(201);
    await api('post', `appointments/${todays.body.id}/patient`, clerk, {
      version: 1,
      patientId: patient.body.id,
    }).expect(204);
    await api('post', `appointments/${todays.body.id}/arrive`, clerk, { version: 2 }).expect(204);
    const late = await api('post', `appointments/${todays.body.id}/cancel`, clerk, { version: 3, reason: 'x' });
    expect([late.status, late.body.code]).toEqual([422, 'appointment_state']);
    expect((await api('get', `appointments/${todays.body.id}`, clerk).expect(200)).body).toMatchObject({
      status: 'arrived',
      uhid: patient.body.uhid,
    });
    const missed = await book({ patientName: 'Rahima Begum', mobileNo: '01811000000', appointmentDate: today }).expect(
      201,
    );
    await api('post', `appointments/${missed.body.id}/no-show`, clerk, { version: 1 }).expect(204);
    const tooEarly = await api('post', `appointments/${first.body.id}/no-show`, clerk, { version: 1 });
    expect(tooEarly.body.code).toBe('invalid_date');

    // Booking a registered patient takes their name and mobile.
    const registered = await book({ patientId: patient.body.id, appointmentDate: today }).expect(201);
    expect((await api('get', `appointments/${registered.body.id}`, clerk).expect(200)).body).toMatchObject({
      patientName: 'Abdul Karim',
      mobileNo: '01711000000',
    });

    const list = await api(
      'get',
      `appointments?doctorId=${consultant}&from=${today}&to=${today}&status=booked`,
      clerk,
    ).expect(200);
    expect(list.body.total).toBe(1);

    const book2 = await request(http)
      .post('/api/v1/reports/hospital.doctor-appointments/render')
      .set(bearer(admin))
      .send({ format: 'xlsx', params: { doctorId: consultant, date: tomorrow } })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(book2.body as Buffer).buffer);
    expect(workbook.worksheets[0]!.getSheetValues().flat()).toContain('Abdul Karim');
    for (const [key, params] of [
      ['hospital.doctor-appointments', { doctorId: consultant, date: tomorrow }],
      ['hospital.appointment-slip', { id: first.body.id }],
    ] as const) {
      await request(http)
        .post(`/api/v1/reports/${key}/render`)
        .set(bearer(admin))
        .send({ format: 'pdf', params })
        .expect(200);
    }
  });
});
