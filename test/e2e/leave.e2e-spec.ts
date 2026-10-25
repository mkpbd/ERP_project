import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let ids: { department: string; sub: string; designation: string; cl: string; unpaid: string };
let people: Record<'jane' | 'hod' | 'hr' | 'clerk' | 'stranger', { userId: string; staffId: string; token: string }>;

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

async function person(name: string, employeeNo: string) {
  const user = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  const staffId = await create('hr/staff', {
    employeeNo,
    fullName: name,
    departmentId: ids.department,
    subDepartmentId: ids.sub,
    designationId: ids.designation,
    joiningDate: '2020-01-01',
    serviceNature: 'Permanent',
    salaryStatus: 'Regular',
    userId: user.body.id,
  });
  return { userId: user.body.id as string, staffId, token: await login(`${name}@example.com`, PASSWORD) };
}

const apply = (token: string, body: Record<string, unknown>) =>
  request(http)
    .post('/api/v1/hr/leave/applications')
    .set(bearer(token))
    .send({ leaveTypeId: ids.cl, reason: 'Family event', ...body });

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
  ids = {
    department,
    sub: await create('hr/sub-departments', { departmentId: department, name: 'ICU' }),
    designation: await create('hr/designations', { name: 'Staff Nurse' }),
    cl: await create('hr/leave/types', { code: 'CL', name: 'Casual leave', nameBn: 'নৈমিত্তিক ছুটি' }),
    unpaid: await create('hr/leave/types', { code: 'LWP', name: 'Leave without pay' }),
  };
  people = {
    jane: await person('jane', 'N-001'),
    hod: await person('hod', 'N-002'),
    hr: await person('hrofficer', 'N-003'),
    clerk: await person('clerk', 'N-004'),
    stranger: await person('stranger', 'N-005'),
  };
  await create('hr/leave/approval-levels', {
    departmentId: department,
    levelOrder: 1,
    name: 'Head of department',
    approverStaffId: people.hod.staffId,
  });
  await create('hr/leave/approval-levels', {
    departmentId: department,
    levelOrder: 2,
    name: 'HR',
    approverStaffId: people.hr.staffId,
  });
  await request(http)
    .put('/api/v1/hr/leave/policies/2026')
    .set(bearer(admin))
    .send({ entitlements: [{ leaveTypeId: ids.cl, days: 10 }] })
    .expect(204);
});

describe('leave applications', () => {
  it('goes through both approval levels and updates the balance', async () => {
    const submitted = await apply(people.jane.token, {
      startDate: '2026-11-02',
      endDate: '2026-11-05',
      substituteStaffId: people.clerk.staffId,
    }).expect(201);
    expect(submitted.body).toMatchObject({
      status: 'pending',
      days: 4,
      currentLevel: 1,
      levelCount: 2,
      substituteName: 'clerk',
      nextApprover: { levelName: 'Head of department', staffId: people.hod.staffId },
    });
    const id = submitted.body.id as string;

    const before = await request(http)
      .get('/api/v1/hr/leave/balance?year=2026')
      .set(bearer(people.jane.token))
      .expect(200);
    expect(before.body.find((row: { code: string }) => row.code === 'CL')).toMatchObject({
      entitled: 10,
      taken: 0,
      pending: 4,
      remaining: 6,
    });

    await request(http)
      .post(`/api/v1/hr/leave/applications/${id}/approve`)
      .set(bearer(people.hr.token))
      .send({})
      .expect(403);
    const awaiting = await request(http)
      .get('/api/v1/hr/leave/applications/awaiting-me')
      .set(bearer(people.hod.token))
      .expect(200);
    expect(awaiting.body.items.map((row: { id: string }) => row.id)).toEqual([id]);

    const first = await request(http)
      .post(`/api/v1/hr/leave/applications/${id}/approve`)
      .set(bearer(people.hod.token))
      .send({ endDate: '2026-11-04', remarks: 'Back by Wednesday' })
      .expect(200);
    expect(first.body).toMatchObject({
      status: 'pending',
      currentLevel: 2,
      approvedDays: 3,
      nextApprover: { levelName: 'HR' },
    });

    const final = await request(http)
      .post(`/api/v1/hr/leave/applications/${id}/approve`)
      .set(bearer(people.hr.token))
      .send({})
      .expect(200);
    expect(final.body).toMatchObject({ status: 'approved', approvedDays: 3, nextApprover: null });
    expect(
      final.body.approvals.map((row: { levelOrder: number; approverName: string }) => [
        row.levelOrder,
        row.approverName,
      ]),
    ).toEqual([
      [1, 'hod'],
      [2, 'hrofficer'],
    ]);

    const after = await request(http)
      .get(`/api/v1/hr/staff/${people.jane.staffId}/leave-balance?year=2026`)
      .set(bearer(admin))
      .expect(200);
    expect(after.body.find((row: { code: string }) => row.code === 'CL')).toMatchObject({
      taken: 3,
      pending: 0,
      remaining: 7,
    });
    expect(after.body.find((row: { code: string }) => row.code === 'LWP')).toMatchObject({
      entitled: null,
      remaining: null,
    });
  });

  it('refuses overlaps, overdrawn balances, missing policies and self-approval', async () => {
    await apply(people.jane.token, { startDate: '2026-03-01', endDate: '2026-03-06' }).expect(201);
    expect(
      (await apply(people.jane.token, { startDate: '2026-03-05', endDate: '2026-03-07' }).expect(422)).body.code,
    ).toBe('leave_overlaps');
    expect(
      (await apply(people.jane.token, { startDate: '2026-04-01', endDate: '2026-04-05' }).expect(422)).body.code,
    ).toBe('insufficient_leave_balance');
    await apply(people.jane.token, { leaveTypeId: ids.unpaid, startDate: '2026-05-01', endDate: '2026-05-20' }).expect(
      201,
    );
    expect(
      (await apply(people.jane.token, { startDate: '2027-01-04', endDate: '2027-01-04' }).expect(422)).body.code,
    ).toBe('no_leave_policy');
    expect(
      (await apply(people.jane.token, { startDate: '2026-12-31', endDate: '2027-01-01' }).expect(422)).body.code,
    ).toBe('leave_crosses_year');

    const own = await apply(people.hod.token, { startDate: '2026-06-01', endDate: '2026-06-01' }).expect(201);
    expect(
      (
        await request(http)
          .post(`/api/v1/hr/leave/applications/${own.body.id}/approve`)
          .set(bearer(people.hod.token))
          .send({})
          .expect(403)
      ).body.code,
    ).toBe('self_approval');
  });

  it('supports delegates, the HR override, cancellation and recorded leave', async () => {
    await request(http)
      .post(`/api/v1/hr/leave/applications`)
      .set(bearer(people.clerk.token))
      .send({
        staffId: people.jane.staffId,
        leaveTypeId: ids.cl,
        startDate: '2026-07-01',
        endDate: '2026-07-01',
        reason: 'Sick child',
      })
      .expect(403);
    await create('hr/leave/delegates', { staffId: people.clerk.staffId, onBehalfOfStaffId: people.jane.staffId });
    const byDelegate = await apply(people.clerk.token, {
      staffId: people.jane.staffId,
      startDate: '2026-07-01',
      endDate: '2026-07-02',
    }).expect(201);
    expect(byDelegate.body.staffId).toBe(people.jane.staffId);

    const overrideRole = await request(http)
      .post('/api/v1/roles')
      .set(bearer(admin))
      .send({ name: 'leave-override', permissions: ['leave:approve-any'] })
      .expect(201);
    await request(http)
      .post(`/api/v1/users/${people.stranger.userId}/roles`)
      .set(bearer(admin))
      .send({ roleId: overrideRole.body.id })
      .expect(204);
    const overridden = await request(http)
      .post(`/api/v1/hr/leave/applications/${byDelegate.body.id}/reject`)
      .set(bearer(people.stranger.token))
      .send({ reason: 'Ward short-staffed' })
      .expect(200);
    expect(overridden.body).toMatchObject({ status: 'rejected', decisionReason: 'Ward short-staffed' });

    const pending = await apply(people.jane.token, { startDate: '2026-08-03', endDate: '2026-08-03' }).expect(201);
    await request(http)
      .post(`/api/v1/hr/leave/applications/${pending.body.id}/cancel`)
      .set(bearer(people.hod.token))
      .send({ reason: 'x' })
      .expect(403);
    await request(http)
      .post(`/api/v1/hr/leave/applications/${pending.body.id}/cancel`)
      .set(bearer(people.jane.token))
      .send({ reason: 'Plans changed' })
      .expect(200);

    await create('hr/leave/records', {
      staffId: people.jane.staffId,
      leaveTypeId: ids.cl,
      startDate: '2026-01-10',
      endDate: '2026-01-14',
      purpose: 'Entered from paper register',
    });
    const balance = await request(http)
      .get('/api/v1/hr/leave/balance?year=2026')
      .set(bearer(people.jane.token))
      .expect(200);
    expect(balance.body.find((row: { code: string }) => row.code === 'CL')).toMatchObject({
      taken: 5,
      pending: 0,
      remaining: 5,
    });
    expect(
      (await apply(people.jane.token, { startDate: '2026-01-12', endDate: '2026-01-12' }).expect(422)).body.code,
    ).toBe('leave_overlaps');
    const crossYear = await request(http)
      .post('/api/v1/hr/leave/records')
      .set(bearer(admin))
      .send({ staffId: people.jane.staffId, leaveTypeId: ids.cl, startDate: '2026-12-30', endDate: '2027-01-02' })
      .expect(422);
    expect(crossYear.body.code).toBe('invalid_leave_record');
  });

  it('shows an application only to the people involved', async () => {
    await create('hr/leave/delegates', { staffId: people.clerk.staffId, onBehalfOfStaffId: people.jane.staffId });
    const { body } = await apply(people.jane.token, { startDate: '2026-09-01', endDate: '2026-09-01' }).expect(201);
    for (const who of ['jane', 'hod', 'hr', 'clerk'] as const) {
      await request(http).get(`/api/v1/hr/leave/applications/${body.id}`).set(bearer(people[who].token)).expect(200);
    }
    await request(http).get(`/api/v1/hr/leave/applications/${body.id}`).set(bearer(people.stranger.token)).expect(403);
    await request(http).get('/api/v1/hr/leave/applications').set(bearer(people.stranger.token)).expect(403);
    await request(http)
      .get(`/api/v1/hr/staff/${people.jane.staffId}/leave-balance?year=2026`)
      .set(bearer(people.stranger.token))
      .expect(403);
    const all = await request(http).get('/api/v1/hr/leave/applications?status=pending').set(bearer(admin)).expect(200);
    expect(all.body.total).toBe(1);
  });

  it('gives one person their own policy for the year', async () => {
    await request(http)
      .put(`/api/v1/hr/staff/${people.jane.staffId}/leave-policies/2026`)
      .set(bearer(admin))
      .send({ entitlements: [{ leaveTypeId: ids.cl, days: 2 }] })
      .expect(204);
    expect(
      (await apply(people.jane.token, { startDate: '2026-10-01', endDate: '2026-10-03' }).expect(422)).body.code,
    ).toBe('insufficient_leave_balance');
    await apply(people.hod.token, { startDate: '2026-10-01', endDate: '2026-10-03' }).expect(201);
    const policies = await request(http).get('/api/v1/hr/leave/policies').set(bearer(admin)).expect(200);
    expect(policies.body).toEqual([
      expect.objectContaining({ year: 2026, entitlements: [expect.objectContaining({ days: 10 })] }),
    ]);
  });
});

describe('leave reports', () => {
  it('renders applications, balances and a statement', async () => {
    await apply(people.jane.token, { startDate: '2026-11-02', endDate: '2026-11-03' }).expect(201);
    for (const [key, params] of [
      ['hr.leave-applications', { from: '2026-01-01', to: '2026-12-31' }],
      ['hr.leave-balances', { year: 2026 }],
      ['hr.leave-statement', { staffId: people.jane.staffId, year: 2026 }],
    ] as const) {
      const response = await request(http)
        .post(`/api/v1/reports/${key}/render`)
        .set(bearer(admin))
        .send({ format: 'pdf', params })
        .buffer(true)
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });
      expect(response.status, key).toBe(200);
      expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
    const xlsx = await request(http)
      .post('/api/v1/reports/hr.leave-balances/render')
      .set(bearer(admin))
      .send({ format: 'xlsx', params: { year: 2026 } });
    expect(xlsx.status).toBe(200);
  });
});
