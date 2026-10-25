import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, resetDatabase, tokenFromMail, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  t.mail.clear();
});

const PASSWORD = 'a perfectly long passphrase';
const BODY_DELIVERY = { 'X-Refresh-Token-Delivery': 'body' };

async function registerAndVerify(email: string, password = PASSWORD): Promise<void> {
  await request(http).post('/api/v1/auth/register').send({ email, password, displayName: 'Test User' }).expect(202);
  const mails = await t.flushMail();
  const mail = mails.find((candidate) => candidate.to === email && candidate.subject.includes('Verify'));
  await request(http)
    .post('/api/v1/auth/verify-email')
    .send({ token: tokenFromMail(mail!.text) })
    .expect(204);
}

async function login(email: string, password = PASSWORD) {
  const response = await request(http)
    .post('/api/v1/auth/login')
    .set(BODY_DELIVERY)
    .send({ identifier: email, password })
    .expect(200);
  return response.body as { accessToken: string; refreshToken: string };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('registration, verification and login', () => {
  it('runs the full lifecycle', async () => {
    await request(http)
      .post('/api/v1/auth/register')
      .send({ email: 'Jane@Example.com', password: PASSWORD, displayName: 'Jane' })
      .expect(202);

    // Unverified accounts cannot sign in, even with the right password.
    const blocked = await request(http)
      .post('/api/v1/auth/login')
      .send({ identifier: 'jane@example.com', password: PASSWORD })
      .expect(401);
    expect(blocked.body.code).toBe('email_not_verified');

    const [mail] = await t.flushMail();
    expect(mail!.text).toMatch(/http:\/\/localhost:5173\/verify-email#token=/);
    await request(http)
      .post('/api/v1/auth/verify-email')
      .send({ token: tokenFromMail(mail!.text) })
      .expect(204);
    // Verification tokens are single-use.
    await request(http)
      .post('/api/v1/auth/verify-email')
      .send({ token: tokenFromMail(mail!.text) })
      .expect(400);

    const { accessToken } = await login('jane@example.com');
    const me = await request(http).get('/api/v1/users/me').set(bearer(accessToken)).expect(200);
    expect(me.body).toMatchObject({ email: 'jane@example.com', emailVerified: true, roles: [], permissions: [] });
    expect(me.body).not.toHaveProperty('passwordHash');
  });

  it('responds identically for existing and new emails', async () => {
    await registerAndVerify('taken@example.com');
    const fresh = await request(http)
      .post('/api/v1/auth/register')
      .send({ email: 'free@example.com', password: PASSWORD, displayName: 'A' });
    const taken = await request(http)
      .post('/api/v1/auth/register')
      .send({ email: 'taken@example.com', password: PASSWORD, displayName: 'B' });
    expect(taken.status).toBe(fresh.status);
    expect(taken.body).toEqual(fresh.body);
    const subjects = (await t.flushMail()).map((mail) => `${mail.to}:${mail.subject}`);
    expect(subjects).toContain('taken@example.com:Sign-up attempt for your account');
  });

  it('does not reveal whether an account exists on failed login', async () => {
    await registerAndVerify('real@example.com');
    const wrongPassword = await request(http)
      .post('/api/v1/auth/login')
      .send({ identifier: 'real@example.com', password: 'not the password' })
      .expect(401);
    const unknown = await request(http)
      .post('/api/v1/auth/login')
      .send({ identifier: 'ghost@example.com', password: 'not the password' })
      .expect(401);
    const strip = ({ requestId: _r, correlationId: _c, ...rest }: Record<string, unknown>) => rest;
    expect(strip(unknown.body)).toEqual(strip(wrongPassword.body));
    expect(unknown.headers['www-authenticate']).toBe('Bearer');
  });

  it('locks the account after repeated failures', async () => {
    await registerAndVerify('lock@example.com');
    for (let i = 0; i < 3; i++) {
      await request(http)
        .post('/api/v1/auth/login')
        .send({ identifier: 'lock@example.com', password: 'wrong password!' })
        .expect(401);
    }
    await request(http)
      .post('/api/v1/auth/login')
      .send({ identifier: 'lock@example.com', password: PASSWORD })
      .expect(401);
  });

  it('validates input with problem details and rejects unknown fields', async () => {
    const response = await request(http)
      .post('/api/v1/auth/register')
      .send({ email: 'x@example.com', password: PASSWORD, displayName: 'X', role: 'super-admin' })
      .expect(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({
      code: 'validation_failed',
      status: 400,
      errors: [expect.objectContaining({ path: 'body' })],
    });

    const weak = await request(http)
      .post('/api/v1/auth/register')
      .send({ email: 'x@example.com', password: 'short', displayName: 'X' })
      .expect(422);
    expect(weak.body.code).toBe('weak_password');

    await request(http)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"broken"')
      .expect(400);
  });
});

describe('access tokens and sessions', () => {
  it('rejects missing, malformed and tampered tokens', async () => {
    await request(http).get('/api/v1/users/me').expect(401);
    await request(http).get('/api/v1/users/me').set({ Authorization: 'Bearer nope' }).expect(401);
    await registerAndVerify('tamper@example.com');
    const { accessToken } = await login('tamper@example.com');
    const [h, p] = accessToken.split('.');
    const forged = `${h}.${p}.${'A'.repeat(43)}`;
    await request(http).get('/api/v1/users/me').set(bearer(forged)).expect(401);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    await registerAndVerify('rotate@example.com');
    const first = await login('rotate@example.com');

    const second = await request(http)
      .post('/api/v1/auth/refresh')
      .set(BODY_DELIVERY)
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);
    await request(http).get('/api/v1/users/me').set(bearer(second.body.accessToken)).expect(200);

    // Replaying the old token is treated as theft: the whole session dies.
    const replay = await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    expect(replay.body.code).toBe('invalid_refresh_token');
    await request(http).get('/api/v1/users/me').set(bearer(second.body.accessToken)).expect(401);
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401);
  });

  it('uses an HttpOnly cookie plus double-submit CSRF token for browsers', async () => {
    await registerAndVerify('browser@example.com');
    const agent = request.agent(http);
    const loginResponse = await agent
      .post('/api/v1/auth/login')
      .send({ identifier: 'browser@example.com', password: PASSWORD })
      .expect(200);
    expect(loginResponse.body.refreshToken).toBeUndefined();
    const cookies = ([] as string[]).concat(loginResponse.headers['set-cookie'] ?? []);
    const refreshCookie = cookies.find((cookie) => cookie.startsWith('erp_rt='))!;
    expect(refreshCookie).toMatch(/HttpOnly/);
    expect(refreshCookie).toMatch(/SameSite=Strict/);
    expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth/);
    const csrf = /erp_csrf=([^;]+)/.exec(cookies.join(';'))![1]!;

    const noCsrf = await agent.post('/api/v1/auth/refresh').send({}).expect(401);
    expect(noCsrf.body.code).toBe('csrf_token_invalid');
    await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', 'forged').send({}).expect(401);
    const refreshed = await agent.post('/api/v1/auth/refresh').set('X-CSRF-Token', csrf).send({}).expect(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
  });

  it('enforces logout server-side', async () => {
    await registerAndVerify('logout@example.com');
    const session = await login('logout@example.com');
    await request(http).post('/api/v1/auth/logout').set(bearer(session.accessToken)).expect(204);
    await request(http).get('/api/v1/users/me').set(bearer(session.accessToken)).expect(401);
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
  });

  it('logs out everywhere and lets users revoke only their own sessions', async () => {
    await registerAndVerify('multi@example.com');
    await registerAndVerify('other@example.com');
    const laptop = await login('multi@example.com');
    const phone = await login('multi@example.com');
    const stranger = await login('other@example.com');

    const sessions = await request(http).get('/api/v1/auth/sessions').set(bearer(laptop.accessToken)).expect(200);
    expect(sessions.body).toHaveLength(2);
    const phoneSession = sessions.body.find((session: { current: boolean }) => !session.current);

    // Horizontal escalation: another user's session id is indistinguishable from a missing one.
    await request(http)
      .delete(`/api/v1/auth/sessions/${phoneSession.id}`)
      .set(bearer(stranger.accessToken))
      .expect(404);
    await request(http).delete(`/api/v1/auth/sessions/${phoneSession.id}`).set(bearer(laptop.accessToken)).expect(204);
    await request(http).get('/api/v1/users/me').set(bearer(phone.accessToken)).expect(401);

    await request(http).post('/api/v1/auth/logout-all').set(bearer(laptop.accessToken)).expect(204);
    await request(http).get('/api/v1/users/me').set(bearer(laptop.accessToken)).expect(401);
    await request(http).get('/api/v1/users/me').set(bearer(stranger.accessToken)).expect(200);
  });
});

describe('password management', () => {
  it('resets a forgotten password with a single-use token and signs out every session', async () => {
    await registerAndVerify('forgot@example.com');
    const before = await login('forgot@example.com');
    t.mail.clear();

    await request(http).post('/api/v1/auth/forgot-password').send({ email: 'forgot@example.com' }).expect(202);
    const unknown = await request(http)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(202);
    expect(unknown.body).toEqual({ message: expect.any(String) });
    const mails = await t.flushMail();
    expect(mails.map((mail) => mail.to)).toEqual(['forgot@example.com']);
    const token = tokenFromMail(mails[0]!.text);

    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'another long passphrase' })
      .expect(204);
    await request(http)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'yet another passphrase' })
      .expect(400);
    await request(http).get('/api/v1/users/me').set(bearer(before.accessToken)).expect(401);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ identifier: 'forgot@example.com', password: PASSWORD })
      .expect(401);
    await login('forgot@example.com', 'another long passphrase');
  });

  it('changes the password, keeping only the current session', async () => {
    await registerAndVerify('change@example.com');
    const current = await login('change@example.com');
    const other = await login('change@example.com');

    const wrong = await request(http)
      .post('/api/v1/auth/change-password')
      .set(bearer(current.accessToken))
      .send({ currentPassword: 'not it at all', newPassword: 'brand new passphrase' })
      .expect(422);
    expect(wrong.body.code).toBe('invalid_current_password');

    await request(http)
      .post('/api/v1/auth/change-password')
      .set(bearer(current.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'brand new passphrase' })
      .expect(204);
    await request(http).get('/api/v1/users/me').set(bearer(current.accessToken)).expect(200);
    await request(http).get('/api/v1/users/me').set(bearer(other.accessToken)).expect(401);
  });
});
