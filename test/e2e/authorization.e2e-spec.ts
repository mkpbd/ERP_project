import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let adminId: string;

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

async function createUser(email: string): Promise<{ id: string; token: string }> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email, password: PASSWORD, displayName: email.split('@')[0] })
    .expect(201);
  return { id: created.body.id as string, token: await login(email, PASSWORD) };
}

async function createRole(name: string, permissions: string[]): Promise<string> {
  const response = await request(http).post('/api/v1/roles').set(bearer(admin)).send({ name, permissions }).expect(201);
  return response.body.id as string;
}

async function roleId(name: string): Promise<string> {
  const roles = await request(http).get('/api/v1/roles').set(bearer(admin)).expect(200);
  return (roles.body as Array<{ id: string; name: string }>).find((role) => role.name === name)!.id;
}

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  adminId = await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
});

describe('public and protected routes', () => {
  it('serves health checks and API docs without authentication', async () => {
    await request(http).get('/api/v1/health/live').expect(200, { status: 'ok' });
    const ready = await request(http).get('/api/v1/health/ready').expect(200);
    expect(ready.body).toEqual({ status: 'ok', checks: { database: 'up' } });
    const docs = await request(http).get('/api/docs/openapi.json').expect(200);
    expect(docs.body.paths['/api/v1/auth/login'].post).toBeDefined();
    expect(docs.body.components.schemas.LoginDto.required).toEqual(['identifier', 'password']);
  });

  it('denies by default and returns problem details for unknown routes', async () => {
    for (const path of ['/api/v1/users', '/api/v1/roles', '/api/v1/permissions', '/api/v1/audit-logs']) {
      await request(http).get(path).expect(401);
    }
    const missing = await request(http).get('/api/v1/nope').set(bearer(admin)).expect(404);
    expect(missing.body.code).toBe('route_not_found');
  });
});

describe('RBAC and permissions', () => {
  it('gives the bootstrapped super-admin every catalog permission explicitly', async () => {
    const me = await request(http).get('/api/v1/users/me').set(bearer(admin)).expect(200);
    expect(me.body.roles).toEqual(['super-admin']);
    const catalog = await request(http).get('/api/v1/permissions').set(bearer(admin)).expect(200);
    expect(me.body.permissions).toEqual(catalog.body.map((permission: { key: string }) => permission.key));
  });

  it('enforces permissions on administrative endpoints (vertical escalation)', async () => {
    const member = await createUser('member@example.com');
    const denied = await request(http).get('/api/v1/users').set(bearer(member.token)).expect(403);
    expect(denied.body.code).toBe('forbidden');
    await request(http).post('/api/v1/roles').set(bearer(member.token)).send({ name: 'mine' }).expect(403);
    await request(http).get('/api/v1/audit-logs').set(bearer(member.token)).expect(403);

    const readers = await createRole('readers', ['users:read']);
    await request(http)
      .post(`/api/v1/users/${member.id}/roles`)
      .set(bearer(admin))
      .send({ roleId: readers })
      .expect(204);
    const list = await request(http)
      .get('/api/v1/users?pageSize=5&sort=email&order=asc')
      .set(bearer(member.token))
      .expect(200);
    expect(list.body).toMatchObject({ page: 1, pageSize: 5, total: 2 });
    expect(list.body.items.map((user: { email: string }) => user.email)).toEqual(['member@example.com', ADMIN.email]);

    // Revocation takes effect immediately.
    await request(http).delete(`/api/v1/users/${member.id}/roles/${readers}`).set(bearer(admin)).expect(204);
    await request(http).get('/api/v1/users').set(bearer(member.token)).expect(403);
  });

  it('enforces resource ownership (horizontal escalation)', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    await request(http).get(`/api/v1/users/${alice.id}`).set(bearer(alice.token)).expect(200);
    await request(http).get(`/api/v1/users/${bob.id}`).set(bearer(alice.token)).expect(403);
    await request(http)
      .patch(`/api/v1/users/${bob.id}`)
      .set(bearer(alice.token))
      .send({ displayName: 'Pwned' })
      .expect(403);
    await request(http)
      .patch('/api/v1/users/me')
      .set(bearer(alice.token))
      .send({ displayName: 'Alice A.' })
      .expect(204);
    await request(http).get(`/api/v1/users/${bob.id}/permissions`).set(bearer(alice.token)).expect(403);
    const own = await request(http).get(`/api/v1/users/${alice.id}/permissions`).set(bearer(alice.token)).expect(200);
    expect(own.body).toEqual({ userId: alice.id, roles: [], permissions: [] });
  });

  it('blocks privilege escalation through delegation', async () => {
    const delegator = await createUser('delegator@example.com');
    const delegate = await createRole('delegate', ['permissions:assign', 'roles:read']);
    await request(http)
      .post(`/api/v1/users/${delegator.id}/roles`)
      .set(bearer(admin))
      .send({ roleId: delegate })
      .expect(204);

    const superAdmin = await roleId('super-admin');
    const selfPromotion = await request(http)
      .post(`/api/v1/users/${delegator.id}/roles`)
      .set(bearer(delegator.token))
      .send({ roleId: superAdmin })
      .expect(403);
    expect(selfPromotion.body.code).toBe('privilege_escalation');

    const grantMore = await request(http)
      .post(`/api/v1/roles/${delegate}/permissions`)
      .set(bearer(delegator.token))
      .send({ permissions: ['users:deactivate'] })
      .expect(403);
    expect(grantMore.body.code).toBe('privilege_escalation');

    // Demoting someone more privileged is also delegation.
    await request(http).delete(`/api/v1/users/${adminId}/roles/${superAdmin}`).set(bearer(delegator.token)).expect(403);
  });

  it('keeps system roles immutable and refuses to delete roles in use', async () => {
    const superAdmin = await roleId('super-admin');
    const immutable = await request(http)
      .patch(`/api/v1/roles/${superAdmin}`)
      .set(bearer(admin))
      .send({ name: 'renamed' })
      .expect(422);
    expect(immutable.body.code).toBe('system_role_immutable');

    const member = await createUser('holder@example.com');
    const custom = await createRole('custom', ['users:read']);
    await request(http)
      .post(`/api/v1/users/${member.id}/roles`)
      .set(bearer(admin))
      .send({ roleId: custom })
      .expect(204);
    await request(http).delete(`/api/v1/roles/${custom}`).set(bearer(admin)).expect(409);
    await request(http).delete(`/api/v1/users/${member.id}/roles/${custom}`).set(bearer(admin)).expect(204);
    await request(http).delete(`/api/v1/roles/${custom}`).set(bearer(admin)).expect(204);
  });

  it('never removes or deactivates the last active super-admin', async () => {
    const superAdmin = await roleId('super-admin');
    const demote = await request(http)
      .delete(`/api/v1/users/${adminId}/roles/${superAdmin}`)
      .set(bearer(admin))
      .expect(422);
    expect(demote.body.code).toBe('last_super_admin');
    const self = await request(http).post(`/api/v1/users/${adminId}/deactivate`).set(bearer(admin)).expect(422);
    expect(self.body.code).toBe('cannot_deactivate_self');
  });
});

describe('account administration', () => {
  it('deactivation revokes access immediately and is reversible', async () => {
    const member = await createUser('leaver@example.com');
    await request(http).post(`/api/v1/users/${member.id}/deactivate`).set(bearer(admin)).expect(204);
    await request(http).get('/api/v1/users/me').set(bearer(member.token)).expect(401);
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ identifier: 'leaver@example.com', password: PASSWORD })
      .expect(401);
    expect(login.body.code).toBe('account_disabled');

    await request(http).post(`/api/v1/users/${member.id}/activate`).set(bearer(admin)).expect(204);
    await request(http)
      .post('/api/v1/auth/login')
      .send({ identifier: 'leaver@example.com', password: PASSWORD })
      .expect(200);
  });

  it('lets an administrator revoke all sessions of a user', async () => {
    const member = await createUser('revoked@example.com');
    const result = await request(http).delete(`/api/v1/users/${member.id}/sessions`).set(bearer(admin)).expect(200);
    expect(result.body).toEqual({ revoked: 1 });
    await request(http).get('/api/v1/users/me').set(bearer(member.token)).expect(401);
  });

  it('records an audit trail without secrets', async () => {
    const member = await createUser('audited@example.com');
    await request(http).get('/api/v1/users').set(bearer(member.token)).expect(403);

    const logs = await request(http)
      .get('/api/v1/audit-logs?pageSize=50')
      .set(bearer(admin))
      .set('X-Correlation-Id', 'trace-abc-123')
      .expect(200);
    const actions = logs.body.items.map(
      (entry: { action: string; outcome: string }) => `${entry.action}:${entry.outcome}`,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        'admin.bootstrapped:success',
        'user.created:success',
        'auth.login:success',
        'authz.denied:denied',
      ]),
    );
    const denial = logs.body.items.find((entry: { action: string }) => entry.action === 'authz.denied');
    expect(denial).toMatchObject({
      actorUserId: member.id,
      resourceId: 'GET /api/v1/users',
      requestId: expect.any(String),
    });
    expect(JSON.stringify(logs.body)).not.toMatch(/passphrase|argon2|Bearer/);

    const filtered = await request(http)
      .get(`/api/v1/audit-logs?actorUserId=${member.id}&outcome=denied`)
      .set(bearer(admin))
      .expect(200);
    expect(filtered.body.total).toBe(1);
  });

  it('validates path and query parameters', async () => {
    const badId = await request(http).get('/api/v1/users/not-a-uuid').set(bearer(admin)).expect(400);
    expect(badId.body.errors[0].path).toBe('param.id');
    await request(http).get('/api/v1/users?pageSize=1000').set(bearer(admin)).expect(400);
    await request(http).get('/api/v1/users?sort=password_hash').set(bearer(admin)).expect(400);
  });
});
