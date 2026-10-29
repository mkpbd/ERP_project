import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let nurse: string;
let nightNurse: { id: string; token: string };
let doctor: string;
let registrar: string;
let manager: string;
let doctorId: string;
let husband: string;
let mother: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const year = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric' }).format(new Date()));
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

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

const emr = (method: 'get' | 'post' | 'put', path: string, token: string, body?: object) => {
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
  nightNurse = await user('night', ['emr:read', 'emr:write']);
  const nusrat = await user('nusrat', ['emr:read', 'emr:write']);
  doctor = nusrat.token;
  registrar = (await user('registrar', ['emr:read', 'emr:certify'])).token;
  manager = (await user('manager', ['rx:read', 'rx:manage'])).token;

  doctorId = await create('hospital/doctors', {
    name: 'Dr. Nusrat Jahan',
    degrees: 'MBBS, FCPS (Medicine)',
    isConsultant: true,
    userId: nusrat.id,
  });
  const ward = await create('hospital/wards', { name: 'Medicine ward' });
  const general = await create('hospital/bed-categories', { name: 'General', admissionFee: 500, dailyRate: 1200 });
  const admit = async (fullName: string, sex: string, mobileNo: string, code: string) => {
    const patient = await create('hospital/patients', { fullName, sex, dateOfBirth: '1985-03-01', mobileNo });
    const bed = await create('hospital/beds', { code, wardId: ward, categoryId: general });
    return create('hospital/admissions', { patientId: patient, bedId: bed, doctorId });
  };
  husband = await admit('Karim Uddin', 'male', '01711000000', 'M-1');
  mother = await admit('Rahima Begum', 'female', '01811000000', 'M-2');
});

describe('EMR', () => {
  it('keeps notes on an admitted patient: rounds, procedures and acknowledged handovers', async () => {
    const round = { kind: 'round', note: 'Afebrile. Chest clear. Continue antibiotics.' };
    expect((await emr('post', `admissions/${husband}/notes`, nurse, round)).body.code).toBe('doctor_needed');
    expect((await emr('post', `admissions/${husband}/notes`, registrar, round)).status).toBe(403);
    await emr('post', `admissions/${husband}/notes`, doctor, { ...round, notedAt: ago(60) }).expect(201);
    const ahead = await emr('post', `admissions/${husband}/notes`, nurse, {
      kind: 'procedure',
      note: 'Cannula changed.',
      notedAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(ahead.body.code).toBe('invalid_time');
    const procedure = await emr('post', `admissions/${husband}/notes`, nurse, {
      kind: 'procedure',
      note: 'Cannula changed.',
      notedAt: ago(30),
    }).expect(201);

    // Handed over to the night nurse, who acknowledges it.
    const handover = await emr('post', `admissions/${husband}/notes`, nurse, {
      kind: 'handover',
      note: 'IV ceftriaxone due at 22:00. Watch the urine output.',
      handedTo: nightNurse.id,
    }).expect(201);
    const pending = await emr('get', 'handovers/pending', nightNurse.token).expect(200);
    expect(pending.body.items).toEqual([
      expect.objectContaining({ id: handover.body.id, patientName: 'Karim Uddin', writerName: 'nurse' }),
    ]);
    expect((await emr('post', `notes/${handover.body.id}/acknowledge`, nurse)).body.code).toBe('not_your_handover');
    await emr('post', `notes/${handover.body.id}/acknowledge`, nightNurse.token).expect(204);
    expect((await emr('get', 'handovers/pending', nightNurse.token).expect(200)).body.items).toEqual([]);

    // Only its writer corrects a note.
    const fix = { version: 1, note: 'Cannula changed to the left hand.' };
    expect((await emr('put', `notes/${procedure.body.id}`, doctor, fix)).body.code).toBe('not_your_note');
    expect((await emr('put', `notes/${procedure.body.id}`, nurse, fix).expect(200)).body.version).toBe(2);

    const notes = await emr('get', `admissions/${husband}/notes`, registrar).expect(200);
    expect(
      notes.body.items.map((entry: { kind: string; doctorName: string | null }) => [entry.kind, entry.doctorName]),
    ).toEqual([
      ['round', 'Dr. Nusrat Jahan'],
      ['procedure', null],
      ['handover', null],
    ]);
    expect(notes.body.items[2]).toMatchObject({ handedToName: 'night', acknowledgedAt: expect.any(String) });
    expect((await emr('get', `admissions/${husband}/notes?kind=round`, nurse).expect(200)).body.items).toHaveLength(1);

    // Templates a note starts from are shared lists.
    expect(
      (await emr('post', 'note-templates', nurse, { name: 'Endoscopy', kind: 'procedure', body: 'x' })).status,
    ).toBe(403);
    await create(
      'clinical/note-templates',
      { name: 'Upper GI endoscopy', kind: 'procedure', body: 'Oesophagus:\nStomach:\nDuodenum:\nImpression:' },
      manager,
    );
    expect((await emr('get', 'note-templates?kind=procedure', manager).expect(200)).body).toHaveLength(1);

    expect((await pdf('clinical.case-notes', { admissionId: husband })).status).toBe(200);
  });

  it('records a death and births with their certificates, and voids one recorded in error', async () => {
    const death = {
      doctorId,
      diedAt: ago(20),
      cause: 'Cardiac arrest',
      antecedentCause: 'Acute myocardial infarction',
      guardianName: 'Rahim Uddin',
      guardianRelation: 'Son',
      familyContactNo: '01911000000',
    };
    expect((await emr('post', `admissions/${husband}/death-record`, nurse, death)).status).toBe(403);
    const recorded = await emr('post', `admissions/${husband}/death-record`, registrar, death).expect(201);
    expect(recorded.body.number).toBe(`DTH-${year}-00001`);
    expect((await emr('post', `admissions/${husband}/death-record`, registrar, death)).body.code).toBe(
      'death_recorded',
    );
    expect((await pdf('clinical.death-certificate', { deathRecordId: recorded.body.id })).status).toBe(200);

    await emr('post', `death-records/${recorded.body.id}/void`, registrar, {
      version: 1,
      reason: 'Wrong patient',
    }).expect(204);
    expect((await pdf('clinical.death-certificate', { deathRecordId: recorded.body.id })).body.code).toBe(
      'record_void',
    );
    const again = await emr('post', `admissions/${husband}/death-record`, registrar, death).expect(201);
    expect(again.body.number).toBe(`DTH-${year}-00002`);

    // Twins born to Rahima; none to Karim.
    const baby = {
      doctorId,
      childSex: 'female',
      bornAt: ago(90),
      deliveryMode: 'caesarean',
      birthWeightKg: 2.45,
      fatherName: 'Abdul Hamid',
    };
    expect((await emr('post', `admissions/${husband}/birth-records`, registrar, baby)).body.code).toBe('not_a_mother');
    expect(
      (await emr('post', `admissions/${mother}/birth-records`, registrar, { ...baby, birthWeightKg: 9 })).body.code,
    ).toBe('invalid_weight');
    const first = await emr('post', `admissions/${mother}/birth-records`, registrar, baby).expect(201);
    await emr('post', `admissions/${mother}/birth-records`, registrar, {
      ...baby,
      childSex: 'male',
      bornAt: ago(88),
      birthWeightKg: 2.3,
    }).expect(201);
    expect(first.body.number).toBe(`BRT-${year}-00001`);
    const records = await emr('get', `admissions/${mother}/records`, nurse).expect(200);
    expect(records.body.death).toBeNull();
    expect(records.body.births.map((entry: { childSex: string }) => entry.childSex)).toEqual(['female', 'male']);
    expect((await pdf('clinical.birth-certificate', { birthRecordId: first.body.id })).status).toBe(200);
  });
});
