import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let ids: Record<
  'department' | 'icu' | 'ward' | 'designation' | 'morning' | 'night' | 'jane' | 'karim' | 'wardStaff',
  string
>;
let janeToken: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const month = () => ({ departmentId: ids.department, subDepartmentId: ids.icu, year: 2026, month: 11 });

async function login(identifier: string, password: string): Promise<string> {
  const response = await request(http)
    .post('/api/v1/auth/login')
    .set('X-Refresh-Token-Delivery', 'body')
    .send({ identifier, password })
    .expect(200);
  return response.body.accessToken as string;
}

async function create(path: string, body: Record<string, unknown>): Promise<string> {
  const response = await request(http).post(`/api/v1/${path}`).set(bearer(admin)).send(body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
  return response.body.id as string;
}

const staff = (employeeNo: string, subDepartmentId: string, userId?: string) =>
  create('hr/staff', {
    employeeNo,
    fullName: employeeNo,
    departmentId: ids.department,
    subDepartmentId,
    designationId: ids.designation,
    joiningDate: '2020-01-01',
    serviceNature: 'Permanent',
    salaryStatus: 'Regular',
    ...(userId ? { userId } : {}),
  });

const save = (entries: Array<Record<string, unknown>>, token = admin) =>
  request(http)
    .put('/api/v1/hr/roster/entries')
    .set(bearer(token))
    .send({ ...month(), entries });

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  const division = await create('hr/divisions', { name: 'Clinical' });
  ids = {} as typeof ids;
  ids.department = await create('hr/departments', { divisionId: division, name: 'Nursing' });
  ids.icu = await create('hr/sub-departments', { departmentId: ids.department, name: 'ICU' });
  ids.ward = await create('hr/sub-departments', { departmentId: ids.department, name: 'Ward' });
  ids.designation = await create('hr/designations', { name: 'Staff Nurse' });
  ids.morning = await create('hr/roster/shift-types', {
    departmentId: ids.department,
    code: 'M',
    name: 'Morning',
    startTime: '08:00',
    endTime: '14:00',
  });
  ids.night = await create('hr/roster/shift-types', {
    departmentId: ids.department,
    code: 'N',
    name: 'Night',
    startTime: '20:00',
    endTime: '09:00',
  });
  const user = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: 'jane@example.com', password: PASSWORD, displayName: 'Jane' })
    .expect(201);
  ids.jane = await staff('N-001', ids.icu, user.body.id as string);
  ids.karim = await staff('N-002', ids.icu);
  ids.wardStaff = await staff('N-003', ids.ward);
  janeToken = await login('jane@example.com', PASSWORD);
});

describe('duty roster', () => {
  it('saves cells, reports each one and protects against stale edits', async () => {
    const first = await save([
      { staffId: ids.jane, date: '2026-11-10', shifts: [{ shiftTypeId: ids.night }], expectedVersion: '' },
      { staffId: ids.karim, date: '2026-11-10', dayOff: true, dayOffRemarks: 'Weekly off', expectedVersion: '' },
      // Overlaps Jane's night shift, which runs until 09:00 on the 11th.
      { staffId: ids.jane, date: '2026-11-11', shifts: [{ shiftTypeId: ids.morning }], expectedVersion: '' },
      // Belongs to another sub-department.
      { staffId: ids.wardStaff, date: '2026-11-10', shifts: [{ shiftTypeId: ids.morning }], expectedVersion: '' },
    ]).expect(200);
    expect(first.body).toMatchObject({ saved: 2, failed: 2 });
    const byCell = new Map(
      first.body.results.map((result: { staffId: string; date: string }) => [
        `${result.staffId}|${result.date}`,
        result,
      ]),
    );
    expect(byCell.get(`${ids.jane}|2026-11-11`)).toMatchObject({
      status: 'invalid',
      errors: ['Shift M overlaps shift N on 2026-11-10'],
    });
    expect(byCell.get(`${ids.wardStaff}|2026-11-10`)).toMatchObject({ status: 'invalid' });
    const janeCell = byCell.get(`${ids.jane}|2026-11-10`) as {
      current: { version: string; shifts: Array<{ startAt: string }> };
    };
    expect(janeCell.current.shifts[0]!.startAt).toBe('2026-11-10T14:00:00.000Z');

    const stale = await save([{ staffId: ids.jane, date: '2026-11-10', dayOff: true, expectedVersion: '' }]).expect(
      200,
    );
    expect(stale.body.results[0]).toMatchObject({ status: 'conflict' });
    const unchanged = await save([
      {
        staffId: ids.jane,
        date: '2026-11-10',
        shifts: [{ shiftTypeId: ids.night }],
        expectedVersion: janeCell.current.version,
      },
    ]).expect(200);
    expect(unchanged.body.results[0]).toMatchObject({ status: 'unchanged' });

    const view = await request(http).get('/api/v1/hr/roster/month').query(month()).set(bearer(janeToken)).expect(200);
    expect(view.body.staff.map((member: { employeeNo: string }) => member.employeeNo)).toEqual(['N-001', 'N-002']);
    expect(
      view.body.shiftTypes.map((type: { code: string; startTime: string }) => [type.code, type.startTime]),
    ).toEqual([
      ['M', '08:00'],
      ['N', '20:00'],
    ]);
    expect(view.body.days).toHaveLength(2);

    const mine = await request(http)
      .get('/api/v1/hr/roster/me?from=2026-11-01&to=2026-11-30')
      .set(bearer(janeToken))
      .expect(200);
    expect(mine.body).toEqual([expect.objectContaining({ date: '2026-11-10', dayOff: false })]);

    await save([{ staffId: ids.jane, date: '2026-11-12', dayOff: true, expectedVersion: '' }], janeToken).expect(403);
  });

  it('validates shift types and renders the roster report', async () => {
    const same = await request(http)
      .post('/api/v1/hr/roster/shift-types')
      .set(bearer(admin))
      .send({ departmentId: ids.department, code: 'Z', name: 'Zero', startTime: '08:00', endTime: '08:00' })
      .expect(400);
    expect(same.body.code).toBe('validation_failed');
    await create('hr/govt-holidays', { holidayDate: '2026-11-15', name: 'Test holiday' });
    await save([
      { staffId: ids.jane, date: '2026-11-10', shifts: [{ shiftTypeId: ids.morning }], expectedVersion: '' },
    ]).expect(200);
    for (const format of ['pdf', 'xlsx']) {
      const response = await request(http)
        .post('/api/v1/reports/hr.duty-roster/render')
        .set(bearer(admin))
        .send({ format, params: month() });
      expect(response.status, format).toBe(200);
    }
    const exchange = await request(http)
      .post('/api/v1/hr/roster/duty-exchanges')
      .set(bearer(admin))
      .send({ staffId: ids.jane, exchangeWithStaffId: ids.jane, dateFrom: '2026-11-10', dateTo: '2026-11-10' })
      .expect(422);
    expect(exchange.body.code).toBe('invalid_duty_exchange');
  });
});
