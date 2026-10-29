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
let tech: string;
let pathologist: string;
let karim: { id: string; uhid: number };
let rahima: { id: string; uhid: number };
let cbc: string;
let pathology: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dhaka',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
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

const portal = (method: 'get' | 'post', path: string, token?: string, body?: object) => {
  const call = request(http)[method](`/api/v1/portal/${path}`);
  if (token) call.set(bearer(token));
  return body ? call.send(body) : call;
};
const texts = () => t.app.get<SmsSender, LogSmsSender>(SmsSender).sent;
const codeIn = (text: string) => /\b(\d{6})\b/.exec(text)![1]!;

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  manager = await user('manager', ['diag:read', 'diag:manage', 'diag:bill', 'lab:read', 'lab:manage', 'lab:collect']);
  tech = await user('tech', ['lab:read', 'lab:result']);
  pathologist = await user('pathologist', ['lab:read', 'lab:result', 'lab:verify']);

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
  cbc = await create(
    'hospital/diagnostic-tests',
    { name: 'Complete blood count', departmentId: pathology, rate: 400 },
    manager,
  );
  await request(http)
    .put(`/api/v1/lab/tests/${cbc}/parameters`)
    .set(bearer(manager))
    .send({ parameters: [{ name: 'WBC count', unit: '/cumm', ranges: [{ low: 4000, high: 11000 }] }] })
    .expect(204);

  karim = await patient({ fullName: 'Abdul Karim', mobileNo: '01711000000', email: 'karim@example.com' });
  rahima = await patient({
    fullName: 'Rahima Begum',
    sex: 'female',
    mobileNo: '01811000000',
    email: 'rahima@example.com',
  });
});

describe('patient portal', () => {
  it('signs a patient in with a code to their mobile and shows only their own documents, holding unpaid reports', async () => {
    // Karim's CBC, 300 still owed, verified by the lab; Rahima has a receipt of her own.
    const billed = (
      await request(http)
        .post('/api/v1/hospital/diagnostic-bills')
        .set(bearer(manager))
        .send({ patientId: karim.id, testIds: [cbc], payment: { amount: 100 } })
        .expect(201)
    ).body as { id: string; number: string };
    const sample = await request(http)
      .post('/api/v1/lab/samples')
      .set(bearer(manager))
      .send({ billId: billed.id, departmentId: pathology })
      .expect(201);
    await request(http)
      .post(`/api/v1/lab/samples/${sample.body.id}/receive`)
      .set(bearer(tech))
      .send({ version: 1 })
      .expect(200);
    const result = (await request(http).get(`/api/v1/lab/samples/${sample.body.id}`).set(bearer(tech)).expect(200)).body
      .results[0] as { id: string };
    const form = await request(http).get(`/api/v1/lab/results/${result.id}`).set(bearer(tech)).expect(200);
    await request(http)
      .put(`/api/v1/lab/results/${result.id}`)
      .set(bearer(tech))
      .send({ version: 1, values: [{ parameterId: form.body.template[0].parameterId, value: '7000' }] })
      .expect(204);
    await request(http)
      .post(`/api/v1/lab/results/${result.id}/verify`)
      .set(bearer(pathologist))
      .send({ version: 2 })
      .expect(204);
    const theirs = await create(
      'hospital/diagnostic-bills',
      { patientId: rahima.id, testIds: [cbc], payment: { amount: 400 } },
      manager,
    );

    // A stranger learns nothing: the same answer and no message for a wrong UHID or contact.
    const unknown = await portal('post', 'otp', undefined, { uhid: 999_999, contact: '01711000000' }).expect(202);
    expect(unknown.body).toMatchObject({ sentTo: '017*****000', challengeId: expect.any(String) });
    const wrong = await portal('post', 'otp', undefined, { uhid: karim.uhid, contact: '01999000000' }).expect(202);
    expect(wrong.body.sentTo).toBe('019*****000');
    expect(texts()).toHaveLength(0);

    const sent = await portal('post', 'otp', undefined, { uhid: karim.uhid, contact: '+880 1711-000000' }).expect(202);
    expect(sent.body.sentTo).toBe('017*****000');
    expect(texts()).toHaveLength(1);
    const code = codeIn(texts()[0]!.text);
    await portal('post', 'otp', undefined, { uhid: karim.uhid, contact: '01711000000' }).expect(202);
    expect(texts()).toHaveLength(1);

    const bad = await portal('post', 'session', undefined, {
      challengeId: sent.body.challengeId,
      code: code === '000000' ? '111111' : '000000',
    });
    expect([bad.status, bad.body.code]).toEqual([401, 'invalid_code']);
    expect((await portal('post', 'session', undefined, { challengeId: unknown.body.challengeId, code })).status).toBe(
      401,
    );
    const session = await portal('post', 'session', undefined, { challengeId: sent.body.challengeId, code }).expect(
      200,
    );
    expect(session.body.patient).toEqual({ name: 'Abdul Karim', uhid: karim.uhid });
    const token = session.body.accessToken as string;
    expect((await portal('post', 'session', undefined, { challengeId: sent.body.challengeId, code })).status).toBe(401);

    // Patient and staff tokens are never taken for each other.
    expect((await portal('get', 'me', admin)).status).toBe(401);
    expect((await request(http).get('/api/v1/hospital/patients').set(bearer(token))).status).toBe(401);
    expect((await portal('get', 'me', token).expect(200)).body).toMatchObject({
      name: 'Abdul Karim',
      uhid: karim.uhid,
    });

    // His receipt and his lab report, held while he owes; nothing of Rahima's.
    const listed = await portal('get', 'documents', token).expect(200);
    const kinds = listed.body.items.map((entry: { kind: string; available: boolean }) => [entry.kind, entry.available]);
    expect(kinds.sort()).toEqual([
      ['diagnostic-receipt', true],
      ['lab-report', false],
    ]);
    const receipt = listed.body.items.find((entry: { kind: string }) => entry.kind === 'diagnostic-receipt');
    const report = listed.body.items.find((entry: { kind: string }) => entry.kind === 'lab-report');
    expect(receipt.number).toBe(billed.number);
    expect(report.heldReason).toMatch(/due/);
    const pdf = await portal('get', `documents/${receipt.ref}/pdf`, token).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect((await portal('get', `documents/${report.ref}/pdf`, token)).body.code).toBe('document_held');
    expect((await portal('get', `documents/diagnostic-receipt:${theirs}/pdf`, token)).status).toBe(404);

    // Paid: the report is his to read.
    await request(http)
      .post(`/api/v1/hospital/diagnostic-bills/${billed.id}/collections`)
      .set(bearer(manager))
      .send({ version: 1, amount: 300 })
      .expect(201);
    expect((await portal('get', `documents/${report.ref}/pdf`, token)).status).toBe(200);

    await portal('post', 'logout', token).expect(204);
    expect((await portal('get', 'me', token)).body.code).toBe('session_revoked');
  });

  it('sends the code by email, and five wrong codes end the challenge', async () => {
    await t.flushMail();
    const sent = await portal('post', 'otp', undefined, { uhid: rahima.uhid, contact: 'Rahima@Example.com' }).expect(
      202,
    );
    expect(sent.body.sentTo).toBe('r***@example.com');
    const mail = (await t.flushMail()).filter((entry) => entry.to === 'rahima@example.com');
    expect(mail).toHaveLength(1);
    const code = codeIn(mail[0]!.text);
    const wrongCode = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      expect(
        (await portal('post', 'session', undefined, { challengeId: sent.body.challengeId, code: wrongCode })).status,
      ).toBe(401);
    }
    const late = await portal('post', 'session', undefined, { challengeId: sent.body.challengeId, code });
    expect([late.status, late.body.code]).toEqual([401, 'invalid_code']);
    expect(texts().filter((entry) => entry.to === '01811000000')).toHaveLength(0);
  });
});
