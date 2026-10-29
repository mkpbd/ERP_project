import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let assistant: string;
let doctor: string;
let colleague: string;
let manager: string;
let doctorId: string;
let colleagueId: string;
let patient: string;
let appointment: string;
let napa: string;
let paracetamol: string;
let cbc: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const dayIn = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
const today = dayIn(new Date());
const nextWeek = dayIn(new Date(Date.now() + 7 * 86_400_000));
const year = Number(today.slice(0, 4));
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

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

const rx = (method: 'get' | 'post' | 'put' | 'delete', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/clinical/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};

const written = () => ({
  complaints: [
    { complaint: 'Fever', duration: '3 days' },
    { complaint: 'Headache', duration: null },
  ],
  history: 'High grade fever with chills, worse at night.',
  examination: 'Throat congested.',
  diagnosis: 'Viral fever',
  drugs: [
    { productId: napa, dose: '1+1+1 after meal', duration: '5 days', qty: 15 },
    { name: 'ORS sachet', dose: 'One sachet in 500 ml water after each loose stool' },
  ],
  tests: [{ testId: cbc }, { name: 'Dengue NS1', note: 'if fever persists' }],
  advices: ['Drink plenty of water', 'Sponge the body when the fever is high'],
  followUpOn: nextWeek,
  followUpNote: 'With the CBC report',
});

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  assistant = (await user('assistant', ['rx:read', 'rx:vitals'])).token;
  const nusrat = await user('nusrat', ['rx:read', 'rx:write']);
  doctor = nusrat.token;
  const kamal = await user('kamal', ['rx:read', 'rx:write']);
  colleague = kamal.token;
  manager = (await user('manager', ['rx:read', 'rx:manage'])).token;

  const medicine = await create('hospital/specialities', { name: 'Medicine' });
  doctorId = await create('hospital/doctors', {
    name: 'Dr. Nusrat Jahan',
    degrees: 'MBBS, FCPS (Medicine)',
    specialityId: medicine,
    isConsultant: true,
    firstVisitFee: 1000,
    userId: nusrat.id,
  });
  colleagueId = await create('hospital/doctors', { name: 'Dr. Kamal Uddin', isConsultant: true, userId: kamal.id });
  await create('hospital/doctor-schedules', {
    doctorId,
    dayOfWeek: weekday(today),
    startTime: '17:00',
    slotMinutes: 15,
    maxPatients: 20,
  });
  patient = await create('hospital/patients', {
    fullName: 'Abdul Karim',
    sex: 'male',
    dateOfBirth: '1980-05-17',
    mobileNo: '01711000000',
  });
  appointment = await create('hospital/appointments', { doctorId, appointmentDate: today, patientId: patient });

  const maker = await create('pharmacy/manufacturers', { name: 'Beximco' });
  paracetamol = await create('pharmacy/generics', { name: 'Paracetamol' });
  napa = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Napa', manufacturerId: maker }),
    genericId: paracetamol,
    formationId: await create('pharmacy/formations', { name: 'Tablet', shortName: 'Tab.' }),
  });
  const pathology = await create('hospital/diagnostic-departments', { name: 'Pathology' });
  cbc = await create('hospital/diagnostic-tests', {
    name: 'Complete blood count',
    code: 'CBC',
    departmentId: pathology,
    rate: 400,
  });
});

describe('prescriptions', () => {
  it('opens a visit from the appointment, takes vitals, and lets its doctor write, sign and correct it', async () => {
    const opened = await rx('post', 'prescriptions', assistant, { appointmentId: appointment }).expect(201);
    expect(opened.body.number).toBe(`RX-${year}-00001`);
    const again = await rx('post', 'prescriptions', assistant, { appointmentId: appointment });
    expect([again.status, again.body.code]).toEqual([409, 'visit_open']);
    const id = opened.body.id as string;

    const vitals = { weightKg: 70, heightCm: 175, bpSystolic: 130, bpDiastolic: 85, pulse: 92, temperatureF: 101.2 };
    const bad = await rx('put', `prescriptions/${id}/vitals`, assistant, { version: 1, ...vitals, spo2: 120 });
    expect(bad.body.code).toBe('invalid_vitals');
    await rx('put', `prescriptions/${id}/vitals`, assistant, { version: 1, ...vitals, spo2: 97 }).expect(200);

    // Medicines and tests to pick from.
    const found = await rx('get', 'medicines?q=nap', doctor).expect(200);
    expect(found.body.items).toEqual([
      expect.objectContaining({ id: napa, name: 'Tab. Napa', genericName: 'Paracetamol' }),
    ]);
    expect((await rx('get', 'tests?q=cbc', doctor).expect(200)).body.items[0]).toMatchObject({ id: cbc });

    // Only the patient's doctor writes it.
    expect((await rx('put', `prescriptions/${id}`, assistant, { version: 2, ...written() })).status).toBe(403);
    const other = await rx('put', `prescriptions/${id}`, colleague, { version: 2, ...written() });
    expect([other.status, other.body.code]).toEqual([403, 'not_your_patient']);
    expect((await rx('put', `prescriptions/${id}`, doctor, { version: 1, ...written() })).status).toBe(409);
    const early = await rx('put', `prescriptions/${id}`, doctor, {
      version: 2,
      ...written(),
      followUpOn: '2020-01-01',
    });
    expect(early.body.code).toBe('invalid_date');
    await rx('put', `prescriptions/${id}`, doctor, { version: 2, ...written() }).expect(200);
    expect((await rx('post', `prescriptions/${id}/sign`, colleague, { version: 3 })).status).toBe(403);
    await rx('post', `prescriptions/${id}/sign`, doctor, { version: 3 }).expect(200);

    const view = await rx('get', `prescriptions/${id}`, assistant).expect(200);
    expect(view.body).toMatchObject({
      status: 'signed',
      visitNo: 1,
      appointmentId: appointment,
      bmi: 22.9,
      spo2: 97,
      diagnosis: 'Viral fever',
      patient: { id: patient, name: 'Abdul Karim' },
      doctor: { id: doctorId, name: 'Dr. Nusrat Jahan', specialityName: 'Medicine' },
    });
    expect(view.body.drugs.map((drug: { name: string }) => drug.name)).toEqual(['Tab. Napa', 'ORS sachet']);
    expect(view.body.tests.map((test: { name: string }) => test.name)).toEqual(['Complete blood count', 'Dengue NS1']);

    // Signed: corrected only by reopening it today; never cancelled.
    const late = await rx('put', `prescriptions/${id}`, doctor, { version: 4, ...written() });
    expect(late.body.code).toBe('rx_state');
    await rx('post', `prescriptions/${id}/reopen`, doctor, { version: 4 }).expect(200);
    await rx('put', `prescriptions/${id}`, doctor, { version: 5, ...written(), diagnosis: 'Dengue fever?' }).expect(
      200,
    );
    const cancel = await rx('post', `prescriptions/${id}/cancel`, assistant, { version: 6, reason: 'x' });
    expect(cancel.body.code).toBe('rx_state');
    await rx('post', `prescriptions/${id}/sign`, doctor, { version: 6 }).expect(200);

    const pdf = await request(http)
      .post('/api/v1/reports/clinical.prescription/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { prescriptionId: id } });
    expect(pdf.status).toBe(200);

    // A visit without an appointment: the doctor opens it for themself only.
    expect((await rx('post', 'prescriptions', doctor, { patientId: patient, doctorId: colleagueId })).status).toBe(403);
    const walkIn = await rx('post', 'prescriptions', doctor, { patientId: patient, doctorId }).expect(201);
    const draft = await rx('get', `prescriptions/${walkIn.body.id}`, doctor).expect(200);
    expect(draft.body).toMatchObject({ visitNo: 2, appointmentId: null, status: 'draft' });
    const unsigned = await request(http)
      .post('/api/v1/reports/clinical.prescription/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { prescriptionId: walkIn.body.id } });
    expect(unsigned.body.code).toBe('not_signed');
    expect((await rx('post', `prescriptions/${walkIn.body.id}/sign`, doctor, { version: 1 })).body.code).toBe(
      'nothing_prescribed',
    );
    await rx('post', `prescriptions/${walkIn.body.id}/cancel`, assistant, { version: 1, reason: 'Left' }).expect(204);

    const mine = await rx('get', 'prescriptions?mine=true', doctor).expect(200);
    expect(mine.body.items.map((row: { number: string; status: string }) => [row.number, row.status])).toEqual([
      [`RX-${year}-00002`, 'cancelled'],
      [`RX-${year}-00001`, 'signed'],
    ]);
    expect(mine.body.items[1]).toMatchObject({ patientName: 'Abdul Karim', doctorName: 'Dr. Nusrat Jahan' });
    expect((await rx('get', 'prescriptions?mine=true', assistant)).body.code).toBe('not_a_doctor');
    const byNumber = await rx('get', `prescriptions?number=rx-${year}-00001`, assistant).expect(200);
    expect(byNumber.body.items).toHaveLength(1);
    expect((await rx('get', `prescriptions?doctorId=${colleagueId}`, assistant).expect(200)).body.items).toEqual([]);
  });

  it("keeps each doctor's pick lists and templates, and the shared ones", async () => {
    const own = await rx('post', 'phrases', doctor, { kind: 'complaint', text: 'Fever', shortKey: 'fev' }).expect(201);
    const twice = await rx('post', 'phrases', doctor, { kind: 'complaint', text: 'fever' });
    expect(twice.body.code).toBe('phrase_exists');
    expect((await rx('post', 'phrases', doctor, { kind: 'advice', text: 'Rest', shared: true })).status).toBe(403);
    await rx('post', 'phrases', manager, { kind: 'complaint', text: 'Cough', shared: true }).expect(201);
    await rx('post', 'phrases', manager, {
      kind: 'dose',
      text: '1+1+1 after meal',
      genericId: paracetamol,
      shared: true,
    }).expect(201);
    expect(
      (await rx('post', 'phrases', manager, { kind: 'advice', text: 'Rest', genericId: paracetamol, shared: true }))
        .body.code,
    ).toBe('invalid_phrase');

    const listed = await rx('get', 'phrases?kind=complaint', doctor).expect(200);
    expect(listed.body.items.map((phrase: { text: string }) => phrase.text)).toEqual(['Fever', 'Cough']);
    const theirs = await rx('get', 'phrases?kind=complaint', colleague).expect(200);
    expect(theirs.body.items.map((phrase: { text: string }) => phrase.text)).toEqual(['Cough']);
    expect((await rx('get', `phrases?kind=dose&genericId=${paracetamol}`, doctor).expect(200)).body.items).toHaveLength(
      1,
    );
    expect((await rx('put', `phrases/${own.body.id}`, colleague, { text: 'High fever' })).status).toBe(404);
    await rx('put', `phrases/${own.body.id}`, doctor, { text: 'High fever', shortKey: 'hf' }).expect(204);
    await rx('delete', `phrases/${own.body.id}`, doctor).expect(204);

    const fever = {
      name: 'Fever',
      diagnosis: 'Viral fever',
      drugs: [{ productId: napa, dose: '1+1+1', duration: '5 days' }],
      tests: [{ testId: cbc }],
      advices: ['Rest'],
    };
    const empty = await rx('post', 'templates', doctor, { name: 'Empty' });
    expect(empty.body.code).toBe('empty_template');
    const made = await rx('post', 'templates', doctor, fever).expect(201);
    expect((await rx('post', 'templates', doctor, fever)).body.code).toBe('template_name_taken');
    expect((await rx('get', 'templates', doctor).expect(200)).body.items).toEqual([
      { id: made.body.id, name: 'Fever', diagnosis: 'Viral fever' },
    ]);
    const kept = await rx('get', `templates/${made.body.id}`, doctor).expect(200);
    expect(kept.body.drugs[0]).toMatchObject({ productId: napa, name: 'Tab. Napa' });
    expect(kept.body.tests[0]).toMatchObject({ testId: cbc, name: 'Complete blood count' });
    expect((await rx('get', `templates/${made.body.id}`, colleague)).status).toBe(404);
    expect((await rx('put', `templates/${made.body.id}`, doctor, { version: 2, ...fever })).status).toBe(409);
    await rx('put', `templates/${made.body.id}`, doctor, { version: 1, ...fever, advices: ['Rest', 'Fluids'] }).expect(
      200,
    );
    await rx('delete', `templates/${made.body.id}`, doctor).expect(204);
    expect((await rx('get', 'templates', assistant)).status).toBe(403);
  });
});
