import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let surgeonToken: string;
let surgeon: string;
let anaesthetist: string;
let assistant: string;
let room1: string;
let room2: string;
let lscs: string;
let major: string;
let spinal: string;
let surgeonFee: string;
let assistantFee: string;
let rahimaStay: string;
let karimStay: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
const year = Number(today.slice(0, 4));
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

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

const api = (method: 'get' | 'post' | 'put', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/hospital/${path}`).set(bearer(token));
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
  const surgeonUser = await user('surgeon', ['ot:read', 'ot:note']);
  surgeonToken = surgeonUser.token;
  surgeon = await create('hospital/doctors', { name: 'Dr. Nusrat Jahan', isConsultant: true, userId: surgeonUser.id });
  anaesthetist = await create('hospital/doctors', { name: 'Dr. Kamal Uddin' });
  assistant = await create('hospital/doctors', { name: 'Dr. Mita Das' });

  room1 = await create('hospital/ot-rooms', { name: 'OT-1', floor: '3rd floor' });
  room2 = await create('hospital/ot-rooms', { name: 'OT-2' });
  lscs = await create('hospital/operations', { name: 'Caesarean section (LSCS)' });
  major = await create('hospital/ot-types', { name: 'Major' });
  spinal = await create('hospital/anaesthesia-types', { name: 'Spinal' });
  await create('hospital/surgery-procedures', { title: 'LSCS', area: 'Obstetrics', description: 'Pfannenstiel…' });

  const group = await create('hospital/service-groups', { name: 'OT' });
  surgeonFee = await create('hospital/services', {
    name: 'Surgeon fee',
    groupId: group,
    rate: 20_000,
    sharePercent: 60,
    isOpd: false,
    isIpd: true,
  });
  assistantFee = await create('hospital/services', {
    name: 'Assistant fee',
    groupId: group,
    rate: 3_000,
    sharePercent: 100,
    isOpd: false,
    isIpd: true,
  });
  const ward = await create('hospital/wards', { name: 'Gynae ward' });
  const general = await create('hospital/bed-categories', { name: 'General', admissionFee: 500, dailyRate: 1200 });
  const admit = async (fullName: string, mobileNo: string, code: string) => {
    const patient = await create('hospital/patients', { fullName, sex: 'female', dateOfBirth: '1990-01-01', mobileNo });
    const bed = await create('hospital/beds', { code, wardId: ward, categoryId: general });
    return create('hospital/admissions', { patientId: patient, bedId: bed, doctorId: surgeon });
  };
  rahimaStay = await admit('Rahima Begum', '01811000000', 'G-1');
  karimStay = await admit('Salma Akter', '01711000000', 'G-2');
});

describe('operation theatre', () => {
  it('asks for, schedules without clashes, operates on, charges and notes an operation', async () => {
    const clinical = {
      operationId: lscs,
      otTypeId: major,
      anaesthesiaTypeId: spinal,
      surgeonId: surgeon,
      anaesthetistId: anaesthetist,
      indication: 'Obstructed labour',
      team: [{ doctorId: assistant, role: 'assistant' }],
    };
    const first = await api('post', 'ot-cases', admin, {
      admissionId: rahimaStay,
      requestedFor: today,
      ...clinical,
    }).expect(201);
    expect(first.body.number).toBe(`OT-${year}-00001`);
    const second = await api('post', 'ot-cases', admin, {
      admissionId: karimStay,
      requestedFor: today,
      ...clinical,
      team: [],
    }).expect(201);
    const one = first.body.id as string;
    const two = second.body.id as string;
    // The anaesthetist is not also in the team; nothing is asked for a day gone.
    expect(
      (
        await api('post', 'ot-cases', admin, {
          admissionId: rahimaStay,
          requestedFor: today,
          ...clinical,
          team: [{ doctorId: anaesthetist, role: 'assistant' }],
        })
      ).body.code,
    ).toBe('invalid_team');
    expect(
      (await api('post', 'ot-cases', admin, { admissionId: rahimaStay, requestedFor: '2020-01-01', ...clinical })).body
        .code,
    ).toBe('invalid_date');

    let board = (await api('get', `ot-board?day=${today}`, admin).expect(200)).body;
    expect(board.waiting.map((entry: { id: string }) => entry.id).sort()).toEqual([one, two].sort());

    // A room and a time; another operation overlapping it in the same room is refused, next to it is not.
    await api('post', `ot-cases/${one}/schedule`, admin, {
      version: 1,
      roomId: room1,
      from: inHours(1),
      to: inHours(3),
    }).expect(201);
    const clash = await api('post', `ot-cases/${two}/schedule`, admin, {
      version: 1,
      roomId: room1,
      from: inHours(2),
      to: inHours(4),
    });
    expect([clash.status, clash.body.code]).toEqual([409, 'room_taken']);
    await api('post', `ot-cases/${two}/schedule`, admin, {
      version: 1,
      roomId: room2,
      from: inHours(2),
      to: inHours(4),
    }).expect(201);
    board = (await api('get', `ot-board?day=${today}`, admin).expect(200)).body;
    expect(board.waiting).toEqual([]);
    expect(board.rooms.map((room: { name: string; cases: unknown[] }) => [room.name, room.cases.length])).toEqual([
      ['OT-1', 1],
      ['OT-2', 1],
    ]);

    // Under way: not cancelled, but noted; charged for its team on the stay's bill.
    await api('post', `ot-cases/${one}/start`, admin, { version: 2 }).expect(201);
    expect((await api('post', `ot-cases/${one}/cancel`, admin, { version: 3, reason: 'No' })).body.code).toBe(
      'ot_under_way',
    );
    await api('put', `ot-cases/${one}/note`, surgeonToken, {
      version: 3,
      incision: 'Pfannenstiel',
      findings: 'Live baby.\nPlacenta complete.',
      procedureDone: 'LSCS done under spinal.',
      specimen: null,
      postOpOrders: 'NPO 6 hours',
    }).expect(200);
    await api('post', `admissions/${rahimaStay}/charges`, admin, {
      serviceId: surgeonFee,
      doctorId: surgeon,
      otCaseId: one,
    }).expect(201);
    await api('post', `admissions/${rahimaStay}/charges`, admin, {
      serviceId: assistantFee,
      doctorId: assistant,
      otCaseId: one,
    }).expect(201);
    expect(
      (
        await api('post', `admissions/${rahimaStay}/charges`, admin, {
          serviceId: surgeonFee,
          doctorId: surgeon,
          otCaseId: two,
        })
      ).body.code,
    ).toBe('invalid_ot_case');

    // Done; signed by the surgeon only, and closed to changes after.
    await api('post', `ot-cases/${one}/finish`, admin, { version: 4 }).expect(201);
    const notTheSurgeon = await api('post', `ot-cases/${one}/note/sign`, admin, { version: 5 });
    expect([notTheSurgeon.status, notTheSurgeon.body.code]).toEqual([403, 'not_the_surgeon']);
    await api('post', `ot-cases/${one}/note/sign`, surgeonToken, { version: 5 }).expect(201);
    expect(
      (
        await api('put', `ot-cases/${one}/note`, surgeonToken, {
          version: 6,
          incision: null,
          findings: null,
          procedureDone: 'x',
          specimen: null,
          postOpOrders: null,
        })
      ).body.code,
    ).toBe('note_signed');
    expect((await api('put', `ot-cases/${one}`, admin, { version: 1, ...clinical })).body.code).toBe('stale_ot_case');

    const done = (await api('get', `ot-cases/${one}`, surgeonToken).expect(200)).body;
    expect(done).toMatchObject({
      status: 'done',
      operationName: 'Caesarean section (LSCS)',
      surgeonName: 'Dr. Nusrat Jahan',
      anaesthetistName: 'Dr. Kamal Uddin',
      otRoomName: 'OT-1',
      findings: 'Live baby.\nPlacenta complete.',
      noteSignedByName: 'surgeon',
      chargedTotal: 23_000,
      team: [{ doctorName: 'Dr. Mita Das', role: 'assistant' }],
    });
    expect(done.charges.map((charge: { serviceName: string }) => charge.serviceName)).toEqual([
      'Surgeon fee',
      'Assistant fee',
    ]);
    // The charges are the stay's: on its account, with the doctors' shares.
    const account = (await api('get', `admissions/${rahimaStay}/account`, admin).expect(200)).body;
    expect(account.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: 'Surgeon fee', amount: 20_000, shareAmount: 12_000 }),
        expect.objectContaining({ description: 'Assistant fee', amount: 3_000, shareAmount: 3_000 }),
      ]),
    );

    // The other is cancelled with a reason, and its room is free again.
    await api('post', `ot-cases/${two}/cancel`, admin, { version: 2, reason: 'Delivered normally' }).expect(201);
    board = (await api('get', `ot-board?day=${today}`, admin).expect(200)).body;
    expect(board.rooms.map((room: { cases: unknown[] }) => room.cases.length)).toEqual([1, 0]);
    expect((await api('get', `ot-cases?status=done`, admin).expect(200)).body.total).toBe(1);

    expect((await pdf('hospital.ot-register', { from: today, to: today })).status).toBe(200);
    expect((await pdf('hospital.ot-note', { id: one })).status).toBe(200);
    expect((await pdf('hospital.ot-consent', { id: one })).status).toBe(200);
    expect((await pdf('hospital.ot-consent', { id: two })).body.code).toBe('ot_closed');

    // Without the permission, nothing is asked for; the surgeon reads but does not schedule.
    expect(
      (await api('post', 'ot-cases', surgeonToken, { admissionId: rahimaStay, requestedFor: today, ...clinical }))
        .status,
    ).toBe(403);
    expect(
      (
        await api('post', `ot-cases/${two}/schedule`, surgeonToken, {
          version: 3,
          roomId: room1,
          from: inHours(5),
          to: inHours(6),
        })
      ).status,
    ).toBe(403);
  });

  it('keeps pre- and post-operative notes in the EMR, naming the doctor', async () => {
    const note = (body: object) =>
      request(http).post(`/api/v1/clinical/admissions/${rahimaStay}/notes`).set(bearer(admin)).send(body);
    expect((await note({ kind: 'pre_op', note: 'Fit for spinal anaesthesia.' })).body.code).toBe('doctor_needed');
    await note({ kind: 'pre_op', doctorId: anaesthetist, note: 'Fit for spinal anaesthesia.' }).expect(201);
    await note({ kind: 'post_op', doctorId: surgeon, note: 'Stable. Start oral fluids in 6 hours.' }).expect(201);
    const notes = await request(http)
      .get(`/api/v1/clinical/admissions/${rahimaStay}/notes`)
      .set(bearer(admin))
      .expect(200);
    expect(notes.body.items.map((entry: { kind: string }) => entry.kind)).toEqual(['pre_op', 'post_op']);
  });
});
