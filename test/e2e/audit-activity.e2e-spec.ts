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
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const signIn = (identifier: string, password: string) =>
  request(http).post('/api/v1/auth/login').set('X-Refresh-Token-Delivery', 'body').send({ identifier, password });

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
  const token = (await signIn(`${name}@example.com`, PASSWORD).expect(200)).body.accessToken as string;
  return { id: created.body.id as string, token };
}

function render(key: string, format: 'pdf' | 'xlsx', params: Record<string, unknown>) {
  return request(http)
    .post(`/api/v1/reports/${key}/render`)
    .set(bearer(admin))
    .send({ format, params })
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });
}

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = (await signIn(ADMIN.email, ADMIN.password).expect(200)).body.accessToken as string;
});

describe('activity log', () => {
  it('summarises the day, lists sign-ins and shows a user’s sessions', async () => {
    const auditor = await user('auditor', ['audit:read', 'users:read']);
    const mitu = await user('mitu', []);
    await signIn('mitu@example.com', 'wrong passphrase 1').expect(401);
    await signIn('mitu@example.com', PASSWORD).expect(200);

    const summary = await request(http)
      .get(`/api/v1/audit-logs/summary?from=${today}&to=${today}`)
      .set(bearer(auditor.token))
      .expect(200);
    expect(summary.body.totals.total).toBeGreaterThan(5);
    expect(summary.body.totals.failures).toBeGreaterThanOrEqual(1);
    expect(summary.body.byDay).toEqual([expect.objectContaining({ day: today })]);
    expect(summary.body.byModule.map((entry: { module: string }) => entry.module)).toEqual(
      expect.arrayContaining(['auth', 'user']),
    );
    expect(summary.body.topActions).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'auth.login', failures: 1 })]),
    );
    expect(
      (await request(http).get(`/api/v1/audit-logs/summary?from=${today}&to=${today}`).set(bearer(mitu.token))).status,
    ).toBe(403);
    const backwards = await request(http)
      .get(`/api/v1/audit-logs/summary?from=${today}&to=2020-01-01`)
      .set(bearer(auditor.token));
    expect(backwards.body.code).toBe('invalid_period');

    // Mitu's sign-ins: the auditor sees them, and so does she; nobody else's.
    const path = `/api/v1/audit-logs/sign-ins?userId=${mitu.id}&from=${today}&to=${today}`;
    const signIns = await request(http).get(path).set(bearer(auditor.token)).expect(200);
    expect(
      signIns.body.items.map((entry: { outcome: string; reason: string | null }) => [entry.outcome, entry.reason]),
    ).toEqual([
      ['success', null],
      ['failure', 'invalid_password'],
      ['success', null],
    ]);
    expect((await request(http).get(path).set(bearer(mitu.token))).status).toBe(200);
    const others = `/api/v1/audit-logs/sign-ins?userId=${auditor.id}&from=${today}&to=${today}`;
    expect((await request(http).get(others).set(bearer(mitu.token))).status).toBe(403);

    // Her sessions, seen by the administrator.
    const sessions = await request(http)
      .get(`/api/v1/users/${mitu.id}/sessions`)
      .set(bearer(auditor.token))
      .expect(200);
    expect(sessions.body).toHaveLength(2);
    expect((await request(http).get(`/api/v1/users/${auditor.id}/sessions`).set(bearer(mitu.token))).status).toBe(403);

    // The prints.
    const sheet = await render('audit.log', 'xlsx', { from: today, to: today, action: 'auth.login' }).expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(sheet.body as Buffer).buffer);
    const rows = (workbook.worksheets[0]!.getSheetValues() as unknown[][])
      .filter(Boolean)
      .map((row) => Array.from(row).slice(1));
    const body = rows.slice(rows.findIndex((row) => row[0] === 'When') + 1);
    expect(body.filter((row) => row[1] === 'mitu').map((row) => row[4])).toEqual(['success', 'failure', 'success']);
    for (const [key, params] of [
      ['audit.activity', { from: today, to: today }],
      ['audit.sign-ins', { userId: mitu.id, from: today, to: today }],
      ['audit.log', { from: today, to: today }],
    ] as const) {
      expect((await render(key, 'pdf', params)).status, key).toBe(200);
    }
  });
});
