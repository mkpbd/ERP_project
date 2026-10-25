import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let clerk: string;
let viewer: string;
let plain: string;

const PASSWORD = 'quite long passphrase 42';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const PDF = Buffer.from('%PDF-1.4\n% minimal CV\n');
const WORD = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('[Content_Types].xml _rels/.rels word/document.xml'),
]);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** Collects the response body as bytes (supertest only buffers text and JSON). */
const asBytes = (test: request.Test) =>
  test.buffer(true).parse((res, callback) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  });

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
  if (permissions.length > 0) {
    const role = await create('roles', { name: `role-${name}`, permissions });
    await request(http)
      .post(`/api/v1/users/${created.body.id}/roles`)
      .set(bearer(admin))
      .send({ roleId: role })
      .expect(204);
  }
  return login(`${name}@example.com`, PASSWORD);
}

const upload = (applicationId: string, fileName: string, type: string, data: Buffer, token = clerk) =>
  request(http)
    .post(`/api/v1/hr/recruitment/applications/${applicationId}/files?fileName=${encodeURIComponent(fileName)}`)
    .set(bearer(token))
    .set('Content-Type', type)
    .send(data);

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  clerk = await user('clerk', ['recruitment:read', 'recruitment:manage']);
  viewer = await user('viewer', ['recruitment:read']);
  plain = await user('plain', []);
});

describe('job circulars and applicants', () => {
  it('records circulars, applicants and status changes', async () => {
    const designation = await create('hr/designations', { name: 'Staff Nurse' });
    const circular = await create(
      'hr/recruitment/circulars',
      { circularNo: 'FAK/HR/2026/07', title: 'Staff nurses for ICU', designationId: designation, vacancies: 6 },
      clerk,
    );
    const taken = await request(http)
      .post('/api/v1/hr/recruitment/circulars')
      .set(bearer(clerk))
      .send({ circularNo: 'fak/hr/2026/07', title: 'Again' })
      .expect(409);
    expect(taken.body.code).toBe('circular_no_taken');
    await request(http)
      .post('/api/v1/hr/recruitment/circulars')
      .set(bearer(clerk))
      .send({ circularNo: 'X-1', title: 'Backwards', publishedOn: '2026-07-10', closesOn: '2026-07-01' })
      .expect(400);
    await request(http)
      .post('/api/v1/hr/recruitment/circulars')
      .set(bearer(viewer))
      .send({ circularNo: 'X-2', title: 'Not allowed' })
      .expect(403);
    await request(http).get('/api/v1/hr/recruitment/circulars').set(bearer(plain)).expect(403);

    const rahima = await create(
      'hr/recruitment/applications',
      { circularId: circular, applicantName: 'রহিমা আক্তার', mobileNo: '+8801711000000', appliedFor: 'ICU' },
      clerk,
    );
    const again = await request(http)
      .post('/api/v1/hr/recruitment/applications')
      .set(bearer(clerk))
      .send({ circularId: circular, applicantName: 'Rahima', mobileNo: '+8801711000000' })
      .expect(409);
    expect(again.body.code).toBe('application_exists');
    await create(
      'hr/recruitment/applications',
      { circularId: circular, applicantName: 'Karim', mobileNo: '01819-000000', email: 'karim@example.com' },
      clerk,
    );
    await request(http)
      .patch(`/api/v1/hr/recruitment/applications/${rahima}`)
      .set(bearer(clerk))
      .send({ status: 'shortlisted', remarks: 'Strong ICU experience' })
      .expect(200);

    const shortlisted = await request(http)
      .get(`/api/v1/hr/recruitment/applications?circularId=${circular}&status=shortlisted`)
      .set(bearer(viewer))
      .expect(200);
    expect(shortlisted.body).toEqual([
      expect.objectContaining({
        applicantName: 'রহিমা আক্তার',
        status: 'shortlisted',
        remarks: 'Strong ICU experience',
      }),
    ]);

    const inUse = await request(http)
      .delete(`/api/v1/hr/recruitment/circulars/${circular}`)
      .set(bearer(clerk))
      .expect(409);
    expect(inUse.body.code).toBe('job_circular_in_use');

    for (const format of ['pdf', 'xlsx']) {
      const response = await request(http)
        .post('/api/v1/reports/hr.job-applications/render')
        .set(bearer(admin))
        .send({ format, params: { circularId: circular } });
      expect(response.status, format).toBe(200);
    }
  });

  it('keeps CV files (PDF and Word) with the application', async () => {
    const circular = await create('hr/recruitment/circulars', { circularNo: 'C-1', title: 'Pharmacist' }, clerk);
    const application = await create(
      'hr/recruitment/applications',
      { circularId: circular, applicantName: 'Jane', mobileNo: '01711000001' },
      clerk,
    );
    const pdf = await upload(application, 'জেন সিভি.pdf', 'application/pdf', PDF).expect(201);
    await upload(application, 'cv.docx', DOCX, WORD).expect(201);
    const wrong = await upload(application, 'photo.pdf', 'application/pdf', PNG).expect(422);
    expect(wrong.body.code).toBe('invalid_file');
    await upload(application, 'x.png', 'image/png', PNG).expect(422);
    await upload(application, 'cv.pdf', 'application/pdf', PDF, viewer).expect(403);
    await upload('00000000-0000-4000-8000-000000000000', 'cv.pdf', 'application/pdf', PDF).expect(404);

    const files = await request(http)
      .get(`/api/v1/hr/recruitment/applications/${application}/files`)
      .set(bearer(viewer))
      .expect(200);
    expect(
      files.body.map((file: { fileName: string; contentType: string }) => [file.fileName, file.contentType]),
    ).toEqual([
      ['জেন সিভি.pdf', 'application/pdf'],
      ['cv.docx', DOCX],
    ]);
    const download = await asBytes(
      request(http).get(`/api/v1/hr/recruitment/applications/${application}/files/${pdf.body.id}`).set(bearer(viewer)),
    ).expect(200);
    expect(download.headers['content-disposition']).toContain(encodeURIComponent('জেন সিভি.pdf'));
    expect((download.body as Buffer).equals(PDF)).toBe(true);

    for (let i = 0; i < 3; i++) await upload(application, `extra-${i}.pdf`, 'application/pdf', PDF).expect(201);
    const full = await upload(application, 'sixth.pdf', 'application/pdf', PDF).expect(422);
    expect(full.body.code).toBe('too_many_files');

    await request(http)
      .delete(`/api/v1/hr/recruitment/applications/${application}/files/${pdf.body.id}`)
      .set(bearer(clerk))
      .expect(204);
    const audit = await request(http)
      .get(`/api/v1/audit-logs?resourceType=job_application&resourceId=${application}`)
      .set(bearer(admin))
      .expect(200);
    expect(audit.body.items.map((row: { action: string }) => row.action)).toEqual(
      expect.arrayContaining(['job_application.created', 'job_application.file_added', 'job_application.file_removed']),
    );

    // Deleting the application takes its files with it.
    await request(http).delete(`/api/v1/hr/recruitment/applications/${application}`).set(bearer(clerk)).expect(204);
    await request(http).get(`/api/v1/hr/recruitment/applications/${application}/files`).set(bearer(viewer)).expect(404);
  });
});

describe('staff ID cards', () => {
  it('prints chosen staff or a department as a bare A4 sheet', async () => {
    const division = await create('hr/divisions', { name: 'Clinical' });
    const department = await create('hr/departments', { divisionId: division, name: 'Nursing' });
    const icu = await create('hr/sub-departments', { departmentId: department, name: 'ICU' });
    const designation = await create('hr/designations', { name: 'Staff Nurse' });
    const staff = await create('hr/staff', {
      employeeNo: 'N-001',
      fullName: 'Rahima Akter',
      departmentId: department,
      subDepartmentId: icu,
      designationId: designation,
      joiningDate: '2020-01-01',
      serviceNature: 'Permanent',
      salaryStatus: 'Regular',
      bloodGroup: 'B+',
    });
    for (const params of [{ staffIds: [staff] }, { departmentId: department }]) {
      const response = await asBytes(
        request(http).post('/api/v1/reports/hr.id-card/render').set(bearer(admin)).send({ format: 'pdf', params }),
      );
      expect(response.status, JSON.stringify(params)).toBe(200);
      expect((response.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    }
    await request(http)
      .post('/api/v1/reports/hr.id-card/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { staffIds: [staff], departmentId: department } })
      .expect(400);
    await request(http)
      .post('/api/v1/reports/hr.id-card/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { staffIds: ['00000000-0000-4000-8000-000000000000'] } })
      .expect(404);
  });
});
