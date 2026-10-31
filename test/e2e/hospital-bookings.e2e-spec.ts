import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SmsSender } from '../../src/modules/portal/application/portal.ports.js';
import type { LogSmsSender } from '../../src/modules/portal/infrastructure/security/portal-security.js';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let manager: string;
let clerk: string;
let biller: string;
let karim: { id: string; uhid: number };
let rahima: { id: string; uhid: number };
let pathology: string;
let cbc: string;
let lipid: string;
let xray: string;
let visitCharge: string;
let morning: string;
let allDay: string;

const PASSWORD = 'quite long passphrase 42';
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
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
const weekday = (isoDay: string) => WEEKDAYS[new Date(`${isoDay}T00:00:00Z`).getUTCDay()]!;
const tomorrow = inDays(1);
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

async function patient(body: Record<string, unknown>) {
  const id = await create('hospital/patients', { sex: 'male', dateOfBirth: '1980-05-17', ...body });
  const found = await request(http).get(`/api/v1/hospital/patients/${id}`).set(bearer(admin)).expect(200);
  return { id, uhid: found.body.uhid as number };
}

const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/hospital/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const portal = (method: 'get' | 'post', path: string, token?: string, body?: object) => {
  const call = request(http)[method](`/api/v1/portal/${path}`);
  if (token) call.set(bearer(token));
  return body ? call.send(body) : call;
};
const refused = async (response: request.Test | Promise<request.Response>, status: number, code: string) => {
  const done = await response;
  expect([done.status, done.body.code], JSON.stringify(done.body)).toEqual([status, code]);
};
const render = (key: string, params: Record<string, unknown>) =>
  request(http).post(`/api/v1/reports/${key}/render`).set(bearer(admin)).send({ format: 'pdf', params }).expect(200);

async function signIn(who: { uhid: number }, mobile: string): Promise<string> {
  const sent = await portal('post', 'otp', undefined, { uhid: who.uhid, contact: mobile }).expect(202);
  const texts = t.app.get<SmsSender, LogSmsSender>(SmsSender).sent;
  const code = /\b(\d{6})\b/.exec(texts.at(-1)!.text)![1]!;
  const session = await portal('post', 'session', undefined, { challengeId: sent.body.challengeId, code }).expect(200);
  return session.body.accessToken as string;
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
  manager = (await user('manager', ['diag:read', 'diag:manage'])).token;
  clerk = (await user('clerk', ['diag:read', 'diag:book'])).token;
  biller = (await user('biller', ['diag:read', 'diag:bill'])).token;

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [nature, balance, code, name, role] of [
    ['1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['1', 'debit', '1250', 'Diagnostic receivable', 'diagnostic_receivable'],
    ['4', 'credit', '4401', 'Diagnostic income', 'diagnostic_income'],
  ] as const) {
    await create('accounts/gl-roles', { role, glAccountId: await glAccount(nature, balance, code, name) });
  }

  pathology = await create('hospital/diagnostic-departments', { name: 'Pathology' }, manager);
  const radiology = await create('hospital/diagnostic-departments', { name: 'Radiology', kind: 'imaging' }, manager);
  const services = await create('hospital/diagnostic-departments', { name: 'Services', kind: 'other' }, manager);
  cbc = await create(
    'hospital/diagnostic-tests',
    { name: 'Complete blood count', departmentId: pathology, rate: 400 },
    manager,
  );
  lipid = await create(
    'hospital/diagnostic-tests',
    { name: 'Lipid profile', departmentId: pathology, rate: 900 },
    manager,
  );
  xray = await create(
    'hospital/diagnostic-tests',
    { name: 'X-ray chest PA', departmentId: radiology, rate: 600 },
    manager,
  );
  visitCharge = await create(
    'hospital/diagnostic-tests',
    { name: 'Home collection charge', departmentId: services, rate: 0, discountAllowed: false },
    manager,
  );
  morning = await create(
    'hospital/test-appointment-windows',
    { label: 'Morning lab', startTime: '08:00', endTime: '10:00', capacity: 2, departmentId: pathology },
    manager,
  );
  allDay = await create(
    'hospital/test-appointment-windows',
    { label: 'All day', startTime: '00:00', endTime: '23:59', capacity: 10, displayOrder: 1 },
    manager,
  );

  karim = await patient({ fullName: 'Abdul Karim', mobileNo: '01711000000' });
  rahima = await patient({ fullName: 'Rahima Begum', sex: 'female', mobileNo: '01811000000' });
});

describe('test appointments', () => {
  it('keeps windows per department, books places within them, and counts them on the board', async () => {
    await refused(
      api('post', 'test-appointment-windows', manager, {
        label: 'morning LAB',
        startTime: '07:00',
        departmentId: pathology,
      }),
      409,
      'window_label_taken',
    );
    await refused(
      api('post', 'test-appointment-windows', manager, { label: 'Evening', startTime: '18:00', endTime: '17:00' }),
      422,
      'invalid_hospital_test_appointment_window',
    );
    await refused(api('post', 'test-appointment-windows', clerk, { label: 'X', startTime: '18:00' }), 403, 'forbidden');

    const walkIn = { patientName: 'Nasir Uddin', mobileNo: '+880 1911-000000' };
    const book = (body: Record<string, unknown>) =>
      api('post', 'test-appointments', clerk, {
        appointmentDate: tomorrow,
        windowId: morning,
        testIds: [cbc],
        ...body,
      });
    const first = await book(walkIn).expect(201);
    expect(first.body).toMatchObject({ serial: 1, number: expect.stringMatching(/^TA-/) });
    await refused(book(walkIn), 409, 'already_booked');
    await refused(book({ patientId: karim.id, testIds: [xray] }), 422, 'wrong_window');
    await refused(book({ patientId: karim.id, testIds: [visitCharge] }), 422, 'not_bookable_test');
    await refused(book({ patientId: karim.id, appointmentDate: inDays(-1) }), 422, 'invalid_date');
    await refused(book({ patientName: 'No Mobile' }), 422, 'patient_needed');
    const second = await book({ patientId: karim.id, testIds: [cbc, lipid] }).expect(201);
    expect(second.body.serial).toBe(2);
    await refused(book({ patientId: rahima.id }), 422, 'fully_booked');
    // X-ray goes in the window of any department.
    await book({ patientId: rahima.id, windowId: allDay, testIds: [xray, cbc] }).expect(201);

    const day = await api(
      'get',
      `test-appointment-availability?date=${tomorrow}&departmentId=${pathology}`,
      clerk,
    ).expect(200);
    expect(
      day.body.items.map((w: { label: string; booked: number; left: number }) => [w.label, w.booked, w.left]),
    ).toEqual([
      ['Morning lab', 2, 0],
      ['All day', 1, 9],
    ]);

    // A cancelled booking frees its place; a booking for tomorrow is not missed today.
    const view = await api('get', `test-appointments/${first.body.id}`, clerk).expect(200);
    expect(view.body).toMatchObject({
      patientName: 'Nasir Uddin',
      mobileNo: '01911000000',
      amount: 400,
      bookedVia: 'desk',
    });
    await refused(
      api('post', `test-appointments/${first.body.id}/no-show`, clerk, { version: 1 }),
      422,
      'invalid_date',
    );
    await refused(
      api('post', `test-appointments/${first.body.id}/cancel`, clerk, { version: 9, reason: 'x' }),
      409,
      'stale_booking',
    );
    await api('post', `test-appointments/${first.body.id}/cancel`, clerk, { version: 1, reason: 'Travelling' }).expect(
      204,
    );
    expect((await book({ patientId: rahima.id }).expect(201)).body.serial).toBe(1);

    const board = await api('get', `test-appointments?from=${tomorrow}&to=${tomorrow}`, clerk).expect(200);
    expect(board.body.summary).toMatchObject({ total: 4, booked: 3, cancelled: 1, amount: 2700 });
    expect(board.body.summary.byDepartment).toEqual([
      { key: 'Pathology', live: 3, cancelled: 1 },
      { key: 'Radiology', live: 1, cancelled: 0 },
    ]);
    const radiologyOnly = await api(
      'get',
      `test-appointments?from=${tomorrow}&departmentId=${pathology}&status=cancelled`,
      clerk,
    );
    expect(radiologyOnly.body.items).toHaveLength(1);
    await refused(api('get', `test-appointments?from=${tomorrow}&to=${today}`, clerk), 422, 'invalid_period');
    await refused(api('get', `test-appointments?from=${today}&to=${inDays(40)}`, clerk), 422, 'period_too_long');

    await render('hospital.test-appointment-slip', { id: second.body.id });
  });

  it('is billed on its day with the bill, once, and to its own patient', async () => {
    const booked = await api('post', 'test-appointments', clerk, {
      patientName: 'Karim (by phone)',
      mobileNo: '01711000000',
      appointmentDate: today,
      windowId: allDay,
      testIds: [cbc],
    }).expect(201);
    const later = await api('post', 'test-appointments', clerk, {
      patientId: rahima.id,
      appointmentDate: tomorrow,
      windowId: allDay,
      testIds: [cbc],
    }).expect(201);
    const bill = (body: Record<string, unknown>) =>
      api('post', 'diagnostic-bills', biller, { patientId: karim.id, testIds: [cbc], ...body });

    await refused(bill({ testAppointmentId: later.body.id, patientId: rahima.id }), 422, 'invalid_date');
    await refused(bill({ testAppointmentId: booked.body.id, homeCollectionId: later.body.id }), 422, 'invalid_booking');
    const made = await bill({ testAppointmentId: booked.body.id, payment: { amount: 400 } }).expect(201);
    const view = await api('get', `test-appointments/${booked.body.id}`, clerk).expect(200);
    expect(view.body).toMatchObject({
      status: 'billed',
      billId: made.body.id,
      billNumber: made.body.number,
      patientId: karim.id,
      patientName: 'Abdul Karim',
      uhid: karim.uhid,
    });
    await refused(bill({ testAppointmentId: booked.body.id }), 422, 'booking_state');

    const rahimaToday = await api('post', 'test-appointments', clerk, {
      patientId: rahima.id,
      appointmentDate: today,
      windowId: allDay,
      testIds: [cbc],
    }).expect(201);
    await refused(bill({ testAppointmentId: rahimaToday.body.id }), 422, 'booking_patient_mismatch');
    // The refused bill left nothing behind.
    expect((await api('get', `diagnostic-bills?patientId=${karim.id}`, biller)).body.total).toBe(1);
  });
});

describe('home collections', () => {
  let kolatoli: string;
  let early: string;

  beforeEach(async () => {
    kolatoli = await create(
      'hospital/home-collection-areas',
      { name: 'Kolatoli', charge: 200, minimumOrder: 1000, days: [weekday(tomorrow)] },
      manager,
    );
    early = await create('hospital/home-collection-windows', { label: '08:00 AM - 10:00 AM' }, manager);
  });

  it('books by area, gives a collector, records the samples and bills the visit as the service', async () => {
    await refused(
      api('post', 'home-collection-areas', manager, { name: 'Sugandha', charge: 100, days: ['funday'] }),
      400,
      'validation_failed',
    );
    const collectorA = await user('collector-a', ['diag:collect']);
    const collectorB = await user('collector-b', ['diag:collect']);
    const reader = await user('reader', ['diag:read']);
    const collectors = await api('get', 'home-collectors', clerk).expect(200);
    expect(collectors.body.items.map((c: { displayName: string }) => c.displayName)).toEqual([
      'collector-a',
      'collector-b',
    ]);
    const book = (body: Record<string, unknown>) =>
      api('post', 'home-collections', clerk, {
        patientId: karim.id,
        collectionDate: tomorrow,
        windowId: early,
        areaId: kolatoli,
        address: 'House 12, Road 3, Kolatoli',
        testIds: [cbc, lipid],
        ...body,
      });
    await refused(book({ testIds: [cbc] }), 422, 'below_minimum');
    await refused(book({ testIds: [cbc, xray] }), 422, 'not_home_test');
    await refused(book({ collectionDate: inDays(2) }), 422, 'area_closed');
    const visit = await book({ landmark: 'Near the mosque', note: 'Fasting from 10 pm' }).expect(201);
    await refused(book({}), 409, 'already_booked');

    const id = visit.body.id as string;
    await refused(
      api('post', `home-collections/${id}/assign`, clerk, { version: 1, collectorId: reader.id }),
      422,
      'not_a_collector',
    );
    await api('post', `home-collections/${id}/assign`, clerk, { version: 1, collectorId: collectorA.id }).expect(204);

    // A collector sees only their own, and records only their own.
    const mine = await api('get', `home-collections?from=${tomorrow}`, collectorA.token).expect(200);
    expect(mine.body.items).toHaveLength(1);
    expect(mine.body.items[0]).toMatchObject({
      collectorName: 'collector-a',
      total: 1500,
      landmark: 'Near the mosque',
    });
    expect((await api('get', `home-collections?from=${tomorrow}`, collectorB.token)).body.items).toHaveLength(0);
    expect((await api('get', `home-collections/${id}`, collectorB.token)).status).toBe(404);
    await refused(
      api('post', `home-collections/${id}/collected`, collectorB.token, { version: 2 }),
      403,
      'not_your_collection',
    );
    await refused(api('post', `home-collections/${id}/collected`, reader.token, { version: 2 }), 403, 'forbidden');

    // Billed before the visit: the service must be named first, and be a service.
    const bill = () =>
      api('post', 'diagnostic-bills', biller, {
        patientId: karim.id,
        testIds: [cbc, lipid],
        homeCollectionId: id,
        payment: { amount: 1500 },
      });
    await refused(bill(), 422, 'home_collection_service_unset');
    const policy = { counterDiscountPercent: 10, defaultReferralPercent: 0 };
    await refused(
      api('put', 'diagnostic-policy', manager, { ...policy, homeCollectionTestId: cbc }),
      422,
      'not_a_service',
    );
    await api('put', 'diagnostic-policy', manager, { ...policy, homeCollectionTestId: visitCharge }).expect(204);
    const made = await bill().expect(201);
    expect(made.body).toMatchObject({ net: 1500, due: 0 });
    const lines = (await api('get', `diagnostic-bills/${made.body.id}`, biller).expect(200)).body.lines;
    expect(lines.map((line: { testName: string; rate: number }) => [line.testName, line.rate])).toEqual([
      ['Complete blood count', 400],
      ['Lipid profile', 900],
      ['Home collection charge', 200],
    ]);
    await refused(bill(), 422, 'booking_billed');
    await refused(
      api('post', `home-collections/${id}/cancel`, clerk, { version: 3, reason: 'x' }),
      422,
      'booking_billed',
    );

    await api('post', `home-collections/${id}/collected`, collectorA.token, { version: 3, note: 'Two tubes' }).expect(
      204,
    );
    const done = await api('get', `home-collections/${id}`, clerk).expect(200);
    expect(done.body).toMatchObject({
      status: 'collected',
      collectedByName: 'collector-a',
      collectionNote: 'Two tubes',
      billNumber: made.body.number,
      billDue: 0,
    });
    const board = await api('get', `home-collections?from=${tomorrow}&collectorId=${collectorA.id}`, clerk).expect(200);
    expect(board.body.summary).toMatchObject({ total: 1, collected: 1, unbilled: 0, amount: 1500 });
    expect(board.body.summary.byCollector).toEqual([{ key: 'collector-a', live: 1, cancelled: 0 }]);

    await render('hospital.home-collection-sheet', { date: tomorrow });
    await render('hospital.home-collection-sheet', { date: tomorrow, collectorId: collectorA.id });
  });

  it('cancels a visit not billed, and refuses a closed area or window', async () => {
    const visit = await api('post', 'home-collections', clerk, {
      patientName: 'Nasir Uddin',
      mobileNo: '01911000000',
      collectionDate: tomorrow,
      windowId: early,
      areaId: kolatoli,
      address: 'Hotel Sea Crown',
      testIds: [cbc, lipid],
    }).expect(201);
    await api('post', `home-collections/${visit.body.id}/patient`, clerk, { version: 1, patientId: rahima.id }).expect(
      204,
    );
    await api('post', `home-collections/${visit.body.id}/cancel`, clerk, { version: 2, reason: 'Not at home' }).expect(
      204,
    );
    const view = await api('get', `home-collections/${visit.body.id}`, clerk).expect(200);
    expect(view.body).toMatchObject({ status: 'cancelled', statusReason: 'Not at home', patientName: 'Rahima Begum' });

    await api('patch', `home-collection-areas/${kolatoli}`, manager, { isActive: false }).expect(200);
    await refused(
      api('post', 'home-collections', clerk, {
        patientId: karim.id,
        collectionDate: tomorrow,
        windowId: early,
        areaId: kolatoli,
        address: 'House 12',
        testIds: [cbc, lipid],
      }),
      422,
      'area_closed',
    );
    // A window in use is not deleted.
    await refused(
      api('delete', `home-collection-windows/${early}`, manager),
      409,
      'hospital_home_collection_window_in_use',
    );
  });
});

describe('bookings on the portal', () => {
  it('offers tests, windows and areas without sign-in, and lets a patient book, see and cancel their own', async () => {
    await create(
      'hospital/home-collection-areas',
      { name: 'Kolatoli', charge: 150, minimumOrder: 0, days: [] },
      manager,
    );
    const window = await create('hospital/home-collection-windows', { label: 'Evening' }, manager);
    const tests = await portal('get', 'tests?q=blood').expect(200);
    expect(tests.body.items).toEqual([
      expect.objectContaining({ name: 'Complete blood count', rate: 400, departmentKind: 'lab' }),
    ]);
    const all = await portal('get', 'tests').expect(200);
    expect(all.body.items.map((test: { name: string }) => test.name)).not.toContain('Home collection charge');
    const windows = await portal('get', `test-appointment-windows?date=${tomorrow}`).expect(200);
    expect(windows.body.items).toHaveLength(2);
    const offer = await portal('get', 'home-collection-offer').expect(200);
    expect(offer.body).toMatchObject({
      areas: [{ name: 'Kolatoli', charge: 150, days: [] }],
      windows: [{ label: 'Evening' }],
    });

    await refused(portal('post', 'test-appointments', undefined, {}), 401, 'authentication_required');
    const token = await signIn(karim, '01711000000');
    const booked = await portal('post', 'test-appointments', token, {
      appointmentDate: tomorrow,
      windowId: morning,
      testIds: [cbc],
    }).expect(201);
    for (const days of [2, 3]) {
      await portal('post', 'test-appointments', token, {
        appointmentDate: inDays(days),
        windowId: morning,
        testIds: [cbc],
      }).expect(201);
    }
    await refused(
      portal('post', 'test-appointments', token, { appointmentDate: inDays(4), windowId: morning, testIds: [cbc] }),
      409,
      'booking_limit',
    );
    const home = await portal('post', 'home-collections', token, {
      collectionDate: tomorrow,
      windowId: window,
      areaId: offer.body.areas[0].id,
      address: 'House 12, Road 3',
      testIds: [lipid],
    }).expect(201);

    const mine = await portal('get', 'bookings', token).expect(200);
    expect(mine.body.appointments).toHaveLength(3);
    expect(mine.body.homeCollections).toEqual([
      expect.objectContaining({ number: home.body.number, amount: 900, charge: 150, status: 'booked' }),
    ]);
    const desk = await api('get', `test-appointments/${booked.body.id}`, clerk).expect(200);
    expect(desk.body).toMatchObject({ bookedVia: 'portal', bookedByName: null, patientId: karim.id });

    // Another patient's booking is not found.
    const other = await signIn(rahima, '01811000000');
    expect((await portal('post', `test-appointments/${booked.body.id}/cancel`, other)).status).toBe(404);
    await portal('post', `test-appointments/${booked.body.id}/cancel`, token).expect(204);
    await portal('post', `home-collections/${home.body.id}/cancel`, token).expect(204);
    const after = await portal('get', 'bookings', token).expect(200);
    expect(after.body.homeCollections[0]).toMatchObject({
      status: 'cancelled',
      statusReason: 'Cancelled by the patient',
    });
    // A place freed is a place to book again.
    await portal('post', 'test-appointments', token, {
      appointmentDate: inDays(4),
      windowId: morning,
      testIds: [cbc],
    }).expect(201);
  });
});
