import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

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

/** Reads a binary response body into a Buffer. */
function binary(res: request.Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

async function render(token: string, key: string, body: Record<string, unknown>) {
  return request(http).post(`/api/v1/reports/${key}/render`).set(bearer(token)).send(body).buffer(true).parse(binary);
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
});

describe('reports', () => {
  it('renders the HTML/Chromium report to PDF and Excel, with Bangla data', async () => {
    const tenant = await create('admin/tenants', { name: 'Fouad Al Khateeb Hospital', address: "Cox's Bazar" });
    await request(http)
      .put(`/api/v1/admin/tenants/${tenant}/logos/primary`)
      .set(bearer(admin))
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(204);
    const dhaka = await create('locations/divisions', { name: 'Dhaka' });
    await create('locations/districts', { divisionId: dhaka, name: 'Gazipur', nameBn: 'গাজীপুর' });

    const pdf = await render(admin, 'location.districts', { format: 'pdf', params: { divisionId: dhaka } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toMatch(
      /^attachment; filename="districts-by-division-\d{4}-\d{2}-\d{2}\.pdf"$/,
    );
    const pdfBytes = pdf.body as Buffer;
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');

    const xlsx = await render(admin, 'location.districts', { format: 'xlsx' });
    expect(xlsx.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    // exceljs types its input as ArrayBuffer.
    await workbook.xlsx.load(Uint8Array.from(xlsx.body as Buffer).buffer);
    const sheet = workbook.worksheets[0]!;
    const values = sheet
      .getSheetValues()
      .flat()
      .filter((value) => typeof value === 'string');
    expect(values).toEqual(
      expect.arrayContaining(['Fouad Al Khateeb Hospital', 'Districts by division', 'Dhaka', 'Gazipur', 'গাজীপুর']),
    );

    const audit = await request(http).get('/api/v1/audit-logs?action=report.rendered').set(bearer(admin)).expect(200);
    expect(audit.body.items.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the pdfmake report', async () => {
    const lab = await create('admin/departments', { name: 'Diagnostic' });
    await create('admin/service-units', { departmentId: lab, name: 'Pathology' });
    const pdf = await render(admin, 'admin.service-units', { params: {} });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('validates the request and the report parameters', async () => {
    const badParams = await request(http)
      .post('/api/v1/reports/location.districts/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { divisionId: 'not-a-uuid', extra: 1 } })
      .expect(400);
    expect(badParams.body.errors.map((error: { path: string }) => error.path)).toEqual(
      expect.arrayContaining(['body.params.divisionId']),
    );
    await request(http)
      .post('/api/v1/reports/location.districts/render')
      .set(bearer(admin))
      .send({ format: 'docx' })
      .expect(400);
    await request(http).post('/api/v1/reports/nothing.here/render').set(bearer(admin)).send({}).expect(404);
    await request(http).get('/api/v1/reports/NotAKey').set(bearer(admin)).expect(400);

    const detail = await request(http).get('/api/v1/reports/location.districts').set(bearer(admin)).expect(200);
    expect(detail.body).toMatchObject({ formats: ['pdf', 'xlsx'], parameters: { type: 'object' } });
    expect(detail.body.parameters.properties.divisionId).toBeDefined();
  });

  it('shows and runs only reports granted to the caller', async () => {
    await request(http)
      .post('/api/v1/users')
      .set(bearer(admin))
      .send({ email: 'clerk@example.com', password: PASSWORD, displayName: 'Clerk' })
      .expect(201)
      .then(async (created) => {
        const role = await request(http).post('/api/v1/roles').set(bearer(admin)).send({ name: 'clerk' }).expect(201);
        await request(http)
          .post(`/api/v1/users/${created.body.id}/roles`)
          .set(bearer(admin))
          .send({ roleId: role.body.id })
          .expect(204);
        const clerk = await login('clerk@example.com', PASSWORD);

        expect((await request(http).get('/api/v1/reports').set(bearer(clerk)).expect(200)).body).toEqual([]);
        await request(http).get('/api/v1/reports/catalog').set(bearer(clerk)).expect(403);
        const refused = await request(http)
          .post('/api/v1/reports/location.districts/render')
          .set(bearer(clerk))
          .send({})
          .expect(403);
        expect(refused.body.code).toBe('report_not_granted');

        await request(http)
          .put(`/api/v1/roles/${role.body.id}/reports`)
          .set(bearer(admin))
          .send({ reportKeys: ['location.districts'] })
          .expect(200);
        const mine = await request(http).get('/api/v1/reports').set(bearer(clerk)).expect(200);
        expect(mine.body.map((report: { key: string }) => report.key)).toEqual(['location.districts']);
        expect((await render(clerk, 'location.districts', { format: 'xlsx' })).status).toBe(200);

        const grants = await request(http).get(`/api/v1/roles/${role.body.id}/reports`).set(bearer(admin)).expect(200);
        expect(grants.body.reportKeys).toEqual(['location.districts']);
      });
  });
});
