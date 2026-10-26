import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let clerk: string;
let reader: string;
let coxsBazar: string;

const PASSWORD = 'quite long passphrase 42';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const yy = Number(today.slice(2, 4));
const uhid = (serial: number) => yy * 1_000_000 + serial;

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

const hp = (method: 'get' | 'post' | 'put' | 'delete', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/hospital/patients${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const karim = {
  title: 'Mr',
  fullName: 'Abdul Karim',
  sex: 'male',
  dateOfBirth: '1980-05-17',
  bloodGroup: 'B+',
  mobileNo: '+880 1711-000000',
  village: 'Kolatoli',
  area: "Cox's Bazar Sadar",
  contactName: 'Rahima Begum',
  contactRelation: 'Wife',
  contactMobileNo: '01811000000',
};

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  clerk = await user('clerk', ['patient:read', 'patient:register']);
  reader = await user('reader', ['patient:read']);
  const chattogram = await create('locations/divisions', { name: 'Chattogram' });
  coxsBazar = await create('locations/districts', { divisionId: chattogram, name: "Cox's Bazar" });
});

describe('hospital patients', () => {
  it('registers patients with UHIDs, refuses likely duplicates unless confirmed, and finds them again', async () => {
    expect((await hp('post', '', reader, karim)).status).toBe(403);
    const first = await hp('post', '', clerk, { ...karim, districtId: coxsBazar }).expect(201);
    expect(first.body.uhid).toBe(uhid(1));

    // The same mobile and name again: refused, unless the counter confirms it is someone else.
    const again = await hp('post', '', clerk, { ...karim, dateOfBirth: '1981-01-01' });
    expect([again.status, again.body.code]).toEqual([409, 'possible_duplicate']);
    expect(again.body.detail).toContain(String(uhid(1)));
    const matches = await hp('get', `/matches?mobileNo=01711000000&fullName=abdul%20karim`, reader).expect(200);
    expect(matches.body.map((match: { uhid: number }) => match.uhid)).toEqual([uhid(1)]);
    const son = await hp('post', '', clerk, {
      ...karim,
      fullName: 'Abdul Karim',
      dateOfBirth: null,
      age: { years: 3, months: 2, days: 0 },
      allowDuplicate: true,
    }).expect(201);
    expect(son.body.uhid).toBe(uhid(2));

    // Several counters at once never get the same UHID.
    const many = await Promise.all(
      [0, 1, 2, 3, 4].map((index) =>
        hp('post', '', clerk, { ...karim, fullName: `Patient ${index}`, mobileNo: `0191100000${index}` }),
      ),
    );
    expect(many.map((response) => response.status)).toEqual([201, 201, 201, 201, 201]);
    expect(new Set(many.map((response) => response.body.uhid)).size).toBe(5);

    const bad = await hp('post', '', clerk, { ...karim, mobileNo: 'abc' });
    expect([bad.status, bad.body.code]).toEqual([422, 'invalid_mobile']);
    expect((await hp('post', '', clerk, { ...karim, mobileNo: '01711999999', districtId: randomUUID() })).status).toBe(
      404,
    );
    await hp('post', '', clerk, { ...karim, mobileNo: '01711999998', idType: 'nid', idNo: '1234567890' }).expect(201);
    const sameNid = await hp('post', '', clerk, {
      ...karim,
      fullName: 'Someone Else',
      mobileNo: '01711999997',
      idType: 'nid',
      idNo: '1234567890',
    });
    expect([sameNid.status, sameNid.body.code]).toEqual([409, 'duplicate_id_document']);

    const view = await hp('get', `/uhid/FKH${uhid(1)}`, reader).expect(200);
    expect(view.body).toMatchObject({
      id: first.body.id,
      fullName: 'Abdul Karim',
      mobileNo: '01711000000',
      districtName: "Cox's Bazar",
      birthEstimated: false,
      hasPhoto: false,
      version: 1,
      age: { years: expect.any(Number) },
    });
    const estimated = await hp('get', `/${son.body.id}`, reader).expect(200);
    expect(estimated.body).toMatchObject({ birthEstimated: true, age: { years: 3, months: 2 } });

    const byUhid = await hp('get', `?q=FKH${uhid(1)}`, reader).expect(200);
    expect(byUhid.body.items[0].id).toBe(first.body.id);
    // Karim, his son and the patient with the NID.
    expect((await hp('get', '?q=01711', reader).expect(200)).body.total).toBe(3);
    expect((await hp('get', '?q=karim', reader).expect(200)).body.total).toBe(3);
    expect((await hp('get', `?from=${today}&to=${today}`, reader).expect(200)).body.total).toBe(8);
    expect((await hp('get', '/uhid/12', reader)).status).toBe(404);
  });

  it('prints the UHID with the organization prefix and registers a newborn on the contact mobile', async () => {
    const mother = await hp('post', '', clerk, {
      ...karim,
      title: 'Mrs',
      fullName: 'Rahima Begum',
      sex: 'female',
      mobileNo: '01811000000',
    }).expect(201);
    expect((await hp('get', `/${mother.body.id}`, reader).expect(200)).body.uhidLabel).toBe(String(uhid(1)));
    await request(http)
      .patch('/api/v1/admin/settings/general')
      .set(bearer(admin))
      .send({ uhidPrefix: 'FKH' })
      .expect(200);
    expect((await hp('get', `/${mother.body.id}`, reader).expect(200)).body.uhidLabel).toBe(`FKH${uhid(1)}`);
    expect((await hp('get', '?q=rahima', reader).expect(200)).body.items[0].uhidLabel).toBe(`FKH${uhid(1)}`);

    // A newborn has no mobile: the mother's number as the contact is enough; neither is refused.
    const newborn = {
      ...karim,
      title: null,
      fullName: 'Baby of Rahima',
      dateOfBirth: today,
      mobileNo: null,
      contactName: 'Rahima Begum',
      contactRelation: 'Mother',
      contactMobileNo: '01811000000',
    };
    const none = await hp('post', '', clerk, { ...newborn, contactMobileNo: null });
    expect([none.status, none.body.code]).toEqual([422, 'mobile_needed']);
    const baby = await hp('post', '', clerk, newborn).expect(201);
    expect((await hp('get', `/${baby.body.id}`, reader).expect(200)).body).toMatchObject({
      mobileNo: null,
      contactMobileNo: '01811000000',
      uhidLabel: `FKH${uhid(2)}`,
    });
    // The same baby again on the same phone is a likely duplicate; the contact number finds both.
    expect((await hp('post', '', clerk, newborn)).body.code).toBe('possible_duplicate');
    expect((await hp('get', '?q=01811000000', reader).expect(200)).body.total).toBe(2);

    await request(http)
      .post('/api/v1/reports/hospital.patient-card/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: baby.body.id } })
      .expect(200);
  });

  it('changes details by version, takes a record out of use and back, and keeps a photo', async () => {
    const first = await hp('post', '', clerk, karim).expect(201);
    const id = first.body.id as string;
    await hp('put', `/${id}`, clerk, { ...karim, fullName: 'Abdul Karim Chowdhury', version: 1 }).expect(204);
    const stale = await hp('put', `/${id}`, clerk, { ...karim, version: 1 });
    expect([stale.status, stale.body.code]).toEqual([409, 'stale_patient']);

    expect((await hp('post', `/${id}/deactivate`, clerk, { version: 2, reason: 'Registered twice' })).status).toBe(403);
    await hp('post', `/${id}/deactivate`, admin, { version: 2, reason: 'Registered twice' }).expect(204);
    expect((await hp('get', '?q=karim', reader).expect(200)).body.total).toBe(0);
    expect((await hp('get', '?q=karim&status=inactive', reader).expect(200)).body.total).toBe(1);
    const locked = await hp('put', `/${id}`, clerk, { ...karim, version: 3 });
    expect([locked.status, locked.body.code]).toEqual([422, 'patient_state']);
    await hp('post', `/${id}/reactivate`, admin, { version: 3 }).expect(204);

    await request(http)
      .put(`/api/v1/hospital/patients/${id}/photo`)
      .set(bearer(clerk))
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(204);
    const photo = await hp('get', `/${id}/photo`, reader).expect(200);
    expect(photo.headers['content-type']).toBe('image/png');
    expect((await hp('get', `/${id}`, reader).expect(200)).body).toMatchObject({
      hasPhoto: true,
      fullName: 'Abdul Karim Chowdhury',
      version: 4,
    });

    await request(http)
      .post('/api/v1/reports/hospital.patient-card/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id } })
      .expect(200);
    await hp('delete', `/${id}/photo`, clerk).expect(204);
    expect((await hp('get', `/${id}/photo`, reader)).status).toBe(404);

    const register = await request(http)
      .post('/api/v1/reports/hospital.patient-register/render')
      .set(bearer(admin))
      .send({ format: 'xlsx', params: { from: today, to: today } })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(register.body as Buffer).buffer);
    expect(workbook.worksheets[0]!.getSheetValues().flat()).toContain('Abdul Karim Chowdhury');
  });
});
