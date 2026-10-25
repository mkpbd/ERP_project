import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let org: { department: string; icu: string; designation: string; morning: string };
let people: Record<'jane' | 'clerk' | 'boss' | 'device', { userId: string; staffId?: string; token: string }>;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

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

async function user(name: string, permissions: string[], staff?: { employeeNo: string; biometric?: number }) {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  const userId = created.body.id as string;
  if (permissions.length > 0) {
    const role = await create('roles', { name: `role-${name}`, permissions });
    await request(http).post(`/api/v1/users/${userId}/roles`).set(bearer(admin)).send({ roleId: role }).expect(204);
  }
  const staffId = staff
    ? await create('hr/staff', {
        employeeNo: staff.employeeNo,
        fullName: name,
        departmentId: org.department,
        subDepartmentId: org.icu,
        designationId: org.designation,
        joiningDate: '2020-01-01',
        serviceNature: 'Permanent',
        salaryStatus: 'Regular',
        biometricEnrollmentNo: staff.biometric ?? null,
        userId,
      })
    : undefined;
  return { userId, staffId, token: await login(`${name}@example.com`, PASSWORD) };
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
  const division = await create('hr/divisions', { name: 'Clinical' });
  const department = await create('hr/departments', { divisionId: division, name: 'Nursing' });
  org = {
    department,
    icu: await create('hr/sub-departments', { departmentId: department, name: 'ICU' }),
    designation: await create('hr/designations', { name: 'Staff Nurse' }),
    morning: await create('hr/roster/shift-types', {
      departmentId: department,
      code: 'M',
      name: 'Morning',
      startTime: '08:00',
      endTime: '14:00',
    }),
  };
  people = {
    jane: await user('jane', [], { employeeNo: 'N-001', biometric: 101 }),
    clerk: await user('clerk', ['attendance:enter', 'attendance:read'], { employeeNo: 'N-002' }),
    boss: await user('boss', ['attendance:approve', 'attendance:read'], { employeeNo: 'N-003' }),
    device: await user('device', ['attendance:ingest']),
  };
  await request(http)
    .put('/api/v1/hr/leave/policies/2026')
    .set(bearer(admin))
    .send({ lateGraceMinutes: 10, entitlements: [] })
    .expect(204);
  await request(http)
    .put('/api/v1/hr/roster/entries')
    .set(bearer(admin))
    .send({
      departmentId: org.department,
      subDepartmentId: org.icu,
      year: 2026,
      month: 3,
      entries: ['2026-03-10', '2026-03-11', '2026-03-12'].map((date) => ({
        staffId: people.jane.staffId,
        date,
        shifts: [{ shiftTypeId: org.morning }],
        expectedVersion: '',
      })),
    })
    .expect(200);
});

describe('device punches and daily status', () => {
  it('ingests punches idempotently and works out the day', async () => {
    const punches = [
      { biometricNo: 101, machineNo: 1, punchedAt: '2026-03-10T08:05:00+06:00' },
      { biometricNo: 101, machineNo: 1, punchedAt: '2026-03-10T14:20:00+06:00' },
      { biometricNo: 101, machineNo: 1, punchedAt: '2026-03-11T08:40:00+06:00' },
      { biometricNo: 999, machineNo: 2, punchedAt: '2026-03-10T09:00:00+06:00' },
    ];
    const first = await request(http)
      .post('/api/v1/hr/attendance/punches')
      .set(bearer(people.device.token))
      .send({ punches })
      .expect(200);
    expect(first.body).toEqual({ received: 4, accepted: 4, duplicates: 0, unmatchedBiometricNos: [999] });
    const again = await request(http)
      .post('/api/v1/hr/attendance/punches')
      .set(bearer(people.device.token))
      .send({ punches })
      .expect(200);
    expect(again.body).toMatchObject({ accepted: 0, duplicates: 4 });
    await request(http)
      .post('/api/v1/hr/attendance/punches')
      .set(bearer(people.clerk.token))
      .send({ punches })
      .expect(403);

    const days = await request(http)
      .get(`/api/v1/hr/attendance/staff/${people.jane.staffId}?from=2026-03-10&to=2026-03-13`)
      .set(bearer(people.boss.token))
      .expect(200);
    expect(
      days.body.map((row: { date: string; status: string; lateMinutes: number }) => [
        row.date,
        row.status,
        row.lateMinutes,
      ]),
    ).toEqual([
      ['2026-03-10', 'present', 5],
      ['2026-03-11', 'late', 40],
      ['2026-03-12', 'absent', 0],
      ['2026-03-13', 'absent', 0],
    ]);
    expect(days.body[0]).toMatchObject({ shift: 'M', workMinutes: 375, overtimeMinutes: 15, source: 'device' });

    // Assigning biometric 999 later links the punch that was already received.
    await request(http)
      .patch(`/api/v1/hr/staff/${people.clerk.staffId}`)
      .set(bearer(admin))
      .send({ biometricEnrollmentNo: 999 })
      .expect(200);
    const clerkDay = await request(http)
      .get(`/api/v1/hr/attendance/staff/${people.clerk.staffId}/punches?from=2026-03-10&to=2026-03-10`)
      .set(bearer(people.boss.token))
      .expect(200);
    expect(clerkDay.body).toHaveLength(1);

    const own = await request(http)
      .get('/api/v1/hr/attendance/me?from=2026-03-10&to=2026-03-10')
      .set(bearer(people.jane.token))
      .expect(200);
    expect(own.body[0].status).toBe('present');
    await request(http)
      .get(`/api/v1/hr/attendance/staff/${people.boss.staffId}?from=2026-03-10&to=2026-03-10`)
      .set(bearer(people.jane.token))
      .expect(403);
    const daily = await request(http)
      .get(`/api/v1/hr/attendance/daily?date=2026-03-10&departmentId=${org.department}`)
      .set(bearer(people.boss.token))
      .expect(200);
    expect(daily.body).toHaveLength(3);
  });
});

describe('manual attendance', () => {
  it('runs the entry → approval workflow with the old checks', async () => {
    const context = await request(http)
      .get(
        `/api/v1/hr/attendance/manual/context?staffId=${people.jane.staffId}&date=2026-03-12&inTime=08:00&outTime=14:00`,
      )
      .set(bearer(people.clerk.token))
      .expect(200);
    expect(context.body).toEqual({ errors: [], warnings: [], preview: 'present' });

    const draft = await request(http)
      .post('/api/v1/hr/attendance/manual')
      .set(bearer(people.clerk.token))
      .send({
        staffId: people.jane.staffId,
        date: '2026-03-12',
        inTime: '08:00',
        outTime: '14:00',
        reason: 'Device was down',
      })
      .expect(201);
    expect(draft.body).toMatchObject({ status: 'draft', version: 1 });
    const id = draft.body.id as string;

    const duplicate = await request(http)
      .post('/api/v1/hr/attendance/manual')
      .set(bearer(people.clerk.token))
      .send({ staffId: people.jane.staffId, date: '2026-03-12', inTime: '09:00', reason: 'Again' })
      .expect(422);
    expect(duplicate.body.code).toBe('manual_attendance_not_allowed');

    const submitted = await request(http)
      .post(`/api/v1/hr/attendance/manual/${id}/submit`)
      .set(bearer(people.clerk.token))
      .send({ version: 1 })
      .expect(200);
    expect(submitted.body.status).toBe('pending');
    const stale = await request(http)
      .post(`/api/v1/hr/attendance/manual/${id}/approve`)
      .set(bearer(people.boss.token))
      .send({ version: 1 })
      .expect(409);
    expect(stale.body.code).toBe('stale_manual_attendance');
    await request(http)
      .post(`/api/v1/hr/attendance/manual/${id}/approve`)
      .set(bearer(people.clerk.token))
      .send({ version: 2 })
      .expect(403);
    const approved = await request(http)
      .post(`/api/v1/hr/attendance/manual/${id}/approve`)
      .set(bearer(people.boss.token))
      .send({ version: 2, remarks: 'Confirmed by ward in-charge' })
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', decisionRemarks: 'Confirmed by ward in-charge' });

    const dayAfter = await request(http)
      .get(`/api/v1/hr/attendance/staff/${people.jane.staffId}?from=2026-03-12&to=2026-03-12`)
      .set(bearer(people.boss.token))
      .expect(200);
    expect(dayAfter.body[0]).toMatchObject({ status: 'present', source: 'manual', workMinutes: 360 });

    await request(http)
      .post(`/api/v1/hr/attendance/manual/${id}/cancel`)
      .set(bearer(people.clerk.token))
      .send({ version: 3, remarks: 'x' })
      .expect(403);
    await request(http)
      .post(`/api/v1/hr/attendance/manual/${id}/cancel`)
      .set(bearer(people.boss.token))
      .send({ version: 3, remarks: 'Entered for the wrong day' })
      .expect(200);
    const revoked = await request(http)
      .get(`/api/v1/hr/attendance/staff/${people.jane.staffId}?from=2026-03-12&to=2026-03-12`)
      .set(bearer(people.boss.token))
      .expect(200);
    expect(revoked.body[0].status).toBe('absent');

    const history = await request(http)
      .get(`/api/v1/audit-logs?resourceType=manual_attendance`)
      .set(bearer(admin))
      .expect(200);
    expect(history.body.items.map((row: { action: string }) => row.action)).toEqual(
      expect.arrayContaining([
        'manual_attendance.created',
        'manual_attendance.submitted',
        'manual_attendance.approved',
        'manual_attendance.cancelled',
      ]),
    );
  });

  it('refuses future days, days on leave and self-review', async () => {
    const future = await request(http)
      .post('/api/v1/hr/attendance/manual')
      .set(bearer(people.clerk.token))
      .send({ staffId: people.jane.staffId, date: '2099-01-01', inTime: '08:00', reason: 'x' })
      .expect(422);
    expect(future.body.detail).toMatch(/today or earlier/);

    const leaveType = await create('hr/leave/types', { code: 'CL', name: 'Casual leave' });
    await create('hr/leave/records', {
      staffId: people.jane.staffId,
      leaveTypeId: leaveType,
      startDate: '2026-03-11',
      endDate: '2026-03-11',
    });
    const onLeave = await request(http)
      .post('/api/v1/hr/attendance/manual')
      .set(bearer(people.clerk.token))
      .send({ staffId: people.jane.staffId, date: '2026-03-11', inTime: '08:00', reason: 'x' })
      .expect(422);
    expect(onLeave.body.detail).toMatch(/Approved leave \(Casual leave\)/);

    const both = await request(http)
      .post('/api/v1/hr/attendance/manual')
      .set(bearer(people.boss.token))
      .send({ staffId: people.jane.staffId, date: '2026-03-10', inTime: '08:00', reason: 'x', submit: true })
      .expect(403);
    expect(both.body).toBeDefined();
  });
});

describe('attendance reports', () => {
  it('renders daily, monthly and individual reports', async () => {
    await request(http)
      .post('/api/v1/hr/attendance/punches')
      .set(bearer(people.device.token))
      .send({ punches: [{ biometricNo: 101, punchedAt: '2026-03-10T08:05:00+06:00' }] })
      .expect(200);
    for (const [key, params] of [
      ['hr.attendance-daily', { date: '2026-03-10' }],
      ['hr.attendance-monthly', { year: 2026, month: 3 }],
      ['hr.attendance-individual', { staffId: people.jane.staffId, from: '2026-03-01', to: '2026-03-31' }],
    ] as const) {
      for (const format of ['pdf', 'xlsx']) {
        const response = await request(http)
          .post(`/api/v1/reports/${key}/render`)
          .set(bearer(admin))
          .send({ format, params });
        expect(response.status, `${key} ${format}: ${JSON.stringify(response.body).slice(0, 200)}`).toBe(200);
      }
    }
  });
});
