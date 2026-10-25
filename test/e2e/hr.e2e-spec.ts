import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let org: { division: string; department: string; subDepartment: string; otherSub: string; designation: string };

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
const PDF = Buffer.from('%PDF-1.4\n% minimal test document\n');

async function login(identifier: string, password: string): Promise<string> {
  const response = await request(http)
    .post('/api/v1/auth/login')
    .set('X-Refresh-Token-Delivery', 'body')
    .send({ identifier, password })
    .expect(200);
  return response.body.accessToken as string;
}

async function create(path: string, body: Record<string, unknown>): Promise<string> {
  const response = await request(http).post(`/api/v1/${path}`).set(bearer(admin)).send(body).expect(201);
  return response.body.id as string;
}

async function userWith(email: string, permissions: string[]): Promise<{ id: string; token: string }> {
  const user = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email, password: PASSWORD, displayName: email.split('@')[0] })
    .expect(201);
  if (permissions.length > 0) {
    const role = await request(http)
      .post('/api/v1/roles')
      .set(bearer(admin))
      .send({ name: `role-${email.split('@')[0]}`, permissions })
      .expect(201);
    await request(http)
      .post(`/api/v1/users/${user.body.id}/roles`)
      .set(bearer(admin))
      .send({ roleId: role.body.id })
      .expect(204);
  }
  return { id: user.body.id as string, token: await login(email, PASSWORD) };
}

const staffBody = (overrides: Record<string, unknown> = {}) => ({
  employeeNo: 'FAK-0001',
  fullName: 'Rahima Akter',
  departmentId: org.department,
  subDepartmentId: org.subDepartment,
  designationId: org.designation,
  joiningDate: '2020-01-15',
  serviceNature: 'Permanent',
  salaryStatus: 'Regular',
  dateOfBirth: '1990-05-01',
  sex: 'female',
  mobileNo: '01700000000',
  ...overrides,
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
  const division = await create('hr/divisions', { name: 'Clinical' });
  const department = await create('hr/departments', { divisionId: division, name: 'Nursing' });
  const otherDepartment = await create('hr/departments', { divisionId: division, name: 'Pharmacy' });
  org = {
    division,
    department,
    subDepartment: await create('hr/sub-departments', { departmentId: department, name: 'ICU' }),
    otherSub: await create('hr/sub-departments', { departmentId: otherDepartment, name: 'Store' }),
    designation: await create('hr/designations', { name: 'Staff Nurse', joiningSalary: 25000 }),
  };
});

describe('HR masters', () => {
  it('filters holidays by date range and rejects duplicates', async () => {
    await create('hr/govt-holidays', { holidayDate: '2026-02-21', name: 'Language Martyrs Day', category: 'National' });
    await create('hr/govt-holidays', { holidayDate: '2026-03-26', name: 'Independence Day' });
    const february = await request(http)
      .get('/api/v1/hr/govt-holidays?from=2026-02-01&to=2026-02-28')
      .set(bearer(admin))
      .expect(200);
    expect(february.body.map((holiday: { name: string }) => holiday.name)).toEqual(['Language Martyrs Day']);
    const duplicate = await request(http)
      .post('/api/v1/hr/govt-holidays')
      .set(bearer(admin))
      .send({ holidayDate: '2026-03-26', name: 'independence day' })
      .expect(409);
    expect(duplicate.body.code).toBe('govt_holiday_taken');
  });

  it('maps database rule violations on records to 422', async () => {
    const staff = await create('hr/staff', staffBody());
    const refused = await request(http)
      .post('/api/v1/hr/department-incharges')
      .set(bearer(admin))
      .send({ departmentId: org.department, staffId: staff, appointmentDate: '2026-05-01', releaseDate: '2026-04-01' })
      .expect(422);
    expect(refused.body.code).toBe('invalid_department_incharge');
  });
});

describe('staff records', () => {
  it('hires, edits, deactivates and separates staff', async () => {
    const hired = await request(http).post('/api/v1/hr/staff').set(bearer(admin)).send(staffBody()).expect(201);
    expect(hired.body).toMatchObject({
      employeeNo: 'FAK-0001',
      status: 'active',
      departmentName: 'Nursing',
      subDepartmentName: 'ICU',
      designationName: 'Staff Nurse',
      hasPhoto: false,
      firstName: null,
      isHeadOfDepartment: false,
    });
    const id = hired.body.id as string;

    const duplicate = await request(http)
      .post('/api/v1/hr/staff')
      .set(bearer(admin))
      .send(staffBody({ employeeNo: 'fak-0001' }))
      .expect(409);
    expect(duplicate.body.code).toBe('employee_no_taken');

    const mismatch = await request(http)
      .patch(`/api/v1/hr/staff/${id}`)
      .set(bearer(admin))
      .send({ subDepartmentId: org.otherSub })
      .expect(422);
    expect(mismatch.body.code).toBe('sub_department_mismatch');

    const edited = await request(http)
      .patch(`/api/v1/hr/staff/${id}`)
      .set(bearer(admin))
      .send({ mobileNo: '01811111111', bloodGroup: 'B+' })
      .expect(200);
    expect(edited.body).toMatchObject({ mobileNo: '01811111111', bloodGroup: 'B+', fullName: 'Rahima Akter' });

    await request(http)
      .post(`/api/v1/hr/staff/${id}/deactivate`)
      .set(bearer(admin))
      .send({ reason: 'Long leave' })
      .expect(204);
    const inactive = await request(http).get('/api/v1/hr/staff?status=inactive').set(bearer(admin)).expect(200);
    expect(inactive.body).toMatchObject({ total: 1, items: [{ id, status: 'inactive' }] });

    await request(http)
      .post(`/api/v1/hr/staff/${id}/separate`)
      .set(bearer(admin))
      .send({ separationDate: '2026-09-30', reason: 'Resigned' })
      .expect(204);
    const locked = await request(http)
      .patch(`/api/v1/hr/staff/${id}`)
      .set(bearer(admin))
      .send({ remarks: 'x' })
      .expect(422);
    expect(locked.body.code).toBe('staff_separated');
  });

  it('keeps education, contacts, festivals, photo and documents with the record', async () => {
    const id = await create('hr/staff', staffBody());
    const eid = await create('hr/festivals', { name: 'Eid ul-Fitr' });
    await request(http)
      .put(`/api/v1/hr/staff/${id}/education`)
      .set(bearer(admin))
      .send({
        entries: [
          { examName: 'SSC', passingYear: 2006 },
          { examName: 'Diploma in Nursing', board: 'BNMC' },
        ],
      })
      .expect(204);
    await request(http)
      .put(`/api/v1/hr/staff/${id}/emergency-contacts`)
      .set(bearer(admin))
      .send({ entries: [{ name: 'Karim', contact: '01900000000', relation: 'Brother' }] })
      .expect(204);
    await request(http)
      .put(`/api/v1/hr/staff/${id}/festivals`)
      .set(bearer(admin))
      .send({ festivalIds: [eid] })
      .expect(204);
    await request(http)
      .put(`/api/v1/hr/staff/${id}/photo`)
      .set(bearer(admin))
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(204);
    const doc = await request(http)
      .post(
        `/api/v1/hr/staff/${id}/documents?fileName=${encodeURIComponent('নিয়োগপত্র.pdf')}&category=incharge-appointment`,
      )
      .set(bearer(admin))
      .set('Content-Type', 'application/pdf')
      .send(PDF)
      .expect(201);
    await request(http)
      .post(`/api/v1/hr/staff/${id}/documents?fileName=evil.pdf`)
      .set(bearer(admin))
      .set('Content-Type', 'application/pdf')
      .send(PNG)
      .expect(422);

    const detail = await request(http).get(`/api/v1/hr/staff/${id}`).set(bearer(admin)).expect(200);
    expect(detail.body).toMatchObject({
      hasPhoto: true,
      festivalIds: [eid],
      education: [
        { examName: 'SSC', passingYear: 2006 },
        { examName: 'Diploma in Nursing', board: 'BNMC' },
      ],
      emergencyContacts: [{ name: 'Karim', relation: 'Brother' }],
      documents: [
        { id: doc.body.id, category: 'incharge-appointment', fileName: 'নিয়োগপত্র.pdf', sizeBytes: PDF.length },
      ],
    });

    const download = await request(http)
      .get(`/api/v1/hr/staff/${id}/documents/${doc.body.id}`)
      .set(bearer(admin))
      .expect(200);
    expect(download.headers['content-type']).toBe('application/pdf');
    expect(download.headers['content-disposition']).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent('নিয়োগপত্র.pdf')}`,
    );
    await request(http).delete(`/api/v1/hr/festivals/${eid}`).set(bearer(admin)).expect(409);
  });

  it('protects personal data: hr:read, or your own linked record', async () => {
    const jane = await userWith('jane@example.com', []);
    const clerk = await userWith('clerk@example.com', ['hr:read']);
    const id = await create('hr/staff', staffBody({ userId: jane.id }));
    const other = await create('hr/staff', staffBody({ employeeNo: 'FAK-0002', fullName: 'Someone Else' }));

    await request(http).get('/api/v1/hr/staff').set(bearer(jane.token)).expect(403);
    expect((await request(http).get('/api/v1/hr/staff/me').set(bearer(jane.token)).expect(200)).body.id).toBe(id);
    await request(http).get(`/api/v1/hr/staff/${id}`).set(bearer(jane.token)).expect(200);
    await request(http).get(`/api/v1/hr/staff/${other}`).set(bearer(jane.token)).expect(403);
    await request(http)
      .get('/api/v1/hr/staff/00000000-0000-4000-8000-000000000000')
      .set(bearer(jane.token))
      .expect(403);
    await request(http).patch(`/api/v1/hr/staff/${id}`).set(bearer(jane.token)).send({ remarks: 'x' }).expect(403);
    await request(http).get('/api/v1/hr/staff/me').set(bearer(clerk.token)).expect(404);
    await request(http).get(`/api/v1/hr/staff/${other}`).set(bearer(clerk.token)).expect(200);

    const relinked = await request(http)
      .patch(`/api/v1/hr/staff/${other}`)
      .set(bearer(admin))
      .send({ userId: jane.id })
      .expect(409);
    expect(relinked.body.code).toBe('user_already_linked');
  });

  it('searches staff by name, number or mobile', async () => {
    await create('hr/staff', staffBody());
    await create('hr/staff', staffBody({ employeeNo: 'FAK-0002', fullName: 'Abdul Karim', mobileNo: '01999999999' }));
    const byName = await request(http).get('/api/v1/hr/staff?search=karim').set(bearer(admin)).expect(200);
    expect(byName.body.items.map((staff: { employeeNo: string }) => staff.employeeNo)).toEqual(['FAK-0002']);
    const byMobile = await request(http).get('/api/v1/hr/staff?search=0170').set(bearer(admin)).expect(200);
    expect(byMobile.body.total).toBe(1);
    const percent = await request(http).get('/api/v1/hr/staff?search=%25').set(bearer(admin)).expect(200);
    expect(percent.body.total).toBe(0);
  });
});

describe('HR reports', () => {
  it('renders the employee list, new employees and the profile', async () => {
    const id = await create('hr/staff', staffBody());
    await request(http)
      .put(`/api/v1/hr/staff/${id}/photo`)
      .set(bearer(admin))
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(204);
    for (const [key, params] of [
      ['hr.employee-list', { status: 'all' }],
      ['hr.new-employees', { from: '2020-01-01', to: '2020-12-31' }],
      ['hr.employee-cv', { staffId: id }],
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
    await request(http)
      .post('/api/v1/reports/hr.new-employees/render')
      .set(bearer(admin))
      .send({ params: { from: '2021-01-01', to: '2020-01-01' } })
      .expect(400);
  });
});
