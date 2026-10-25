import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;

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

async function createUser(email: string, roleId: string): Promise<string> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email, password: PASSWORD, displayName: email.split('@')[0] })
    .expect(201);
  await request(http).post(`/api/v1/users/${created.body.id}/roles`).set(bearer(admin)).send({ roleId }).expect(204);
  return login(email, PASSWORD);
}

async function createRole(name: string, permissions: string[] = []): Promise<string> {
  const response = await request(http).post('/api/v1/roles').set(bearer(admin)).send({ name, permissions }).expect(201);
  return response.body.id as string;
}

async function createMenu(body: Record<string, unknown>): Promise<string> {
  const response = await request(http).post('/api/v1/menus').set(bearer(admin)).send(body).expect(201);
  return response.body.id as string;
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

describe('menus', () => {
  it('manages the menu tree and lists it in tree order', async () => {
    const pharmacy = await createMenu({ name: 'Pharmacy', displayOrder: 2 });
    const hr = await createMenu({ name: 'HR', displayOrder: 1 });
    const sales = await createMenu({ name: 'Sales', parentId: pharmacy, path: 'Pharmacy/Sales/' });

    const created = await request(http).get(`/api/v1/menus/${sales}`).set(bearer(admin)).expect(200);
    expect(created.body).toMatchObject({ path: '/pharmacy/sales', depth: 1, effectivelyActive: true });

    await request(http).patch(`/api/v1/menus/${pharmacy}`).set(bearer(admin)).send({ isActive: false }).expect(200);
    const list = await request(http).get('/api/v1/menus').set(bearer(admin)).expect(200);
    expect(
      list.body.map((menu: { name: string; effectivelyActive: boolean }) => [menu.name, menu.effectivelyActive]),
    ).toEqual([
      ['HR', true],
      ['Pharmacy', false],
      ['Sales', false],
    ]);

    const conflict = await request(http).delete(`/api/v1/menus/${pharmacy}`).set(bearer(admin)).expect(409);
    expect(conflict.body.code).toBe('menu_has_children');
    const cycle = await request(http)
      .patch(`/api/v1/menus/${pharmacy}`)
      .set(bearer(admin))
      .send({ parentId: sales })
      .expect(422);
    expect(cycle.body.code).toBe('menu_cycle');

    await request(http).delete(`/api/v1/menus/${sales}`).set(bearer(admin)).expect(204);
    await request(http).delete(`/api/v1/menus/${hr}`).set(bearer(admin)).expect(204);
    await request(http).get(`/api/v1/menus/${hr}`).set(bearer(admin)).expect(404);
  });

  it('will not let the menu administration page be switched off', async () => {
    const settings = await createMenu({ name: 'Settings' });
    await createMenu({ name: 'Menus', parentId: settings, path: '/administrator/project-menu' });
    const refused = await request(http)
      .patch(`/api/v1/menus/${settings}`)
      .set(bearer(admin))
      .send({ isActive: false })
      .expect(422);
    expect(refused.body.code).toBe('menu_admin_lockout');
  });

  it('validates input strictly', async () => {
    const bad = await request(http)
      .post('/api/v1/menus')
      .set(bearer(admin))
      .send({ name: 'x', IsActive: 1 })
      .expect(400);
    expect(bad.body.code).toBe('validation_failed');
  });
});

describe('role menus and navigation', () => {
  it('builds a user navigation from role grants', async () => {
    const pharmacy = await createMenu({ name: 'Pharmacy' });
    const sales = await createMenu({ name: 'Sales', parentId: pharmacy, path: '/pharmacy/sales' });
    await createMenu({ name: 'Returns', parentId: pharmacy, path: '/pharmacy/returns' });
    const cashier = await createRole('cashier');

    const granted = await request(http)
      .put(`/api/v1/roles/${cashier}/menus`)
      .set(bearer(admin))
      .send({ menuIds: [sales] })
      .expect(200);
    expect(granted.body.menuIds.sort()).toEqual([pharmacy, sales].sort());

    const jane = await createUser('jane@example.com', cashier);
    const mine = await request(http).get('/api/v1/menus/me').set(bearer(jane)).expect(200);
    expect(mine.body.map((menu: { name: string }) => menu.name)).toEqual(['Pharmacy', 'Sales']);

    const trail = await request(http).get('/api/v1/menus/resolve?path=/Pharmacy/Sales').set(bearer(jane)).expect(200);
    expect(trail.body.menu.id).toBe(sales);
    expect(trail.body.ancestors.map((menu: { id: string }) => menu.id)).toEqual([pharmacy]);
    await request(http).get('/api/v1/menus/resolve?path=/pharmacy/returns').set(bearer(jane)).expect(404);

    // Not a menu administrator.
    await request(http).get('/api/v1/menus').set(bearer(jane)).expect(403);
    const roleMenus = await request(http).get(`/api/v1/roles/${cashier}/menus`).set(bearer(admin)).expect(200);
    expect(roleMenus.body.menuIds.sort()).toEqual([pharmacy, sales].sort());
  });

  it('stops menu assigners from granting menus they cannot use', async () => {
    const mine = await createMenu({ name: 'Mine', path: '/mine' });
    const theirs = await createMenu({ name: 'Theirs', path: '/theirs' });
    const manager = await createRole('menu-manager', ['menus:assign', 'menus:read']);
    await request(http)
      .put(`/api/v1/roles/${manager}/menus`)
      .set(bearer(admin))
      .send({ menuIds: [mine] })
      .expect(200);
    const clerk = await createRole('clerk');
    const token = await createUser('manager@example.com', manager);

    await request(http)
      .put(`/api/v1/roles/${clerk}/menus`)
      .set(bearer(token))
      .send({ menuIds: [mine] })
      .expect(200);
    const refused = await request(http)
      .put(`/api/v1/roles/${clerk}/menus`)
      .set(bearer(token))
      .send({ menuIds: [theirs] })
      .expect(403);
    expect(refused.body.code).toBe('privilege_escalation');
    await request(http)
      .put('/api/v1/roles/00000000-0000-4000-8000-000000000000/menus')
      .set(bearer(admin))
      .send({ menuIds: [] })
      .expect(404);
  });

  it('removes grants when a role is deleted', async () => {
    const menu = await createMenu({ name: 'Solo', path: '/solo' });
    const temp = await createRole('temp');
    await request(http)
      .put(`/api/v1/roles/${temp}/menus`)
      .set(bearer(admin))
      .send({ menuIds: [menu] })
      .expect(200);
    await request(http).delete(`/api/v1/roles/${temp}`).set(bearer(admin)).expect(204);
    await request(http).delete(`/api/v1/menus/${menu}`).set(bearer(admin)).expect(204);
  });
});
