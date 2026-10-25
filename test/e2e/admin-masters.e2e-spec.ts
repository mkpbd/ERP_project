import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

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

describe('locations', () => {
  it('manages divisions and districts with filters and integrity errors', async () => {
    const dhaka = await create('locations/divisions', { name: 'Dhaka' });
    const khulna = await create('locations/divisions', { name: 'Khulna' });
    const gazipur = await create('locations/districts', { divisionId: dhaka, name: 'Gazipur', nameBn: 'গাজীপুর' });
    await create('locations/districts', { divisionId: khulna, name: 'Jessore' });

    const filtered = await request(http)
      .get(`/api/v1/locations/districts?divisionId=${dhaka}`)
      .set(bearer(admin))
      .expect(200);
    expect(filtered.body).toEqual([
      expect.objectContaining({ id: gazipur, divisionId: dhaka, name: 'Gazipur', nameBn: 'গাজীপুর' }),
    ]);

    const duplicate = await request(http)
      .post('/api/v1/locations/districts')
      .set(bearer(admin))
      .send({ divisionId: dhaka, name: 'GAZIPUR' })
      .expect(409);
    expect(duplicate.body.code).toBe('district_name_taken');

    const missing = await request(http)
      .post('/api/v1/locations/districts')
      .set(bearer(admin))
      .send({ divisionId: '00000000-0000-4000-8000-000000000000', name: 'Nowhere' })
      .expect(404);
    expect(missing.body.code).toBe('division_not_found');

    const inUse = await request(http).delete(`/api/v1/locations/divisions/${dhaka}`).set(bearer(admin)).expect(409);
    expect(inUse.body.code).toBe('division_in_use');

    await request(http)
      .patch(`/api/v1/locations/districts/${gazipur}`)
      .set(bearer(admin))
      .send({ nameBn: null })
      .expect(200);
    await request(http).delete(`/api/v1/locations/districts/${gazipur}`).set(bearer(admin)).expect(204);
    await request(http).delete(`/api/v1/locations/divisions/${dhaka}`).set(bearer(admin)).expect(204);
    await request(http).get(`/api/v1/locations/divisions/${dhaka}`).set(bearer(admin)).expect(404);
  });

  it('validates bodies strictly and requires a change on PATCH', async () => {
    const country = await create('locations/countries', {
      name: 'Bangladesh',
      nationality: 'Bangladeshi',
      shortCode: 'BD',
    });
    await request(http).post('/api/v1/locations/countries').set(bearer(admin)).send({ CountryName: 'X' }).expect(400);
    await request(http).patch(`/api/v1/locations/countries/${country}`).set(bearer(admin)).send({}).expect(400);
    const code = await request(http)
      .post('/api/v1/locations/countries')
      .set(bearer(admin))
      .send({ name: 'Other', shortCode: 'bd' })
      .expect(409);
    expect(code.body.code).toBe('country_code_taken');
  });
});

describe('admin masters', () => {
  it('links service units and discount categories to departments', async () => {
    const lab = await create('admin/departments', { name: 'Diagnostic' });
    const unit = await create('admin/service-units', { departmentId: lab, name: 'Pathology' });
    const discount = await request(http)
      .post('/api/v1/admin/discount-categories')
      .set(bearer(admin))
      .send({ departmentId: lab, name: 'Staff', discountPercent: 12.5 })
      .expect(201);
    expect(discount.body).toMatchObject({ discountPercent: 12.5, departmentId: lab });
    await request(http)
      .post('/api/v1/admin/discount-categories')
      .set(bearer(admin))
      .send({ departmentId: lab, name: 'Too much', discountPercent: 120 })
      .expect(400);

    const units = await request(http)
      .get(`/api/v1/admin/service-units?departmentId=${lab}`)
      .set(bearer(admin))
      .expect(200);
    expect(units.body.map((row: { id: string }) => row.id)).toEqual([unit]);
    await request(http).delete(`/api/v1/admin/departments/${lab}`).set(bearer(admin)).expect(409);
  });

  it('lets any signed-in user read masters but only masters:manage change them', async () => {
    const mode = await create('admin/payment-modes', { name: 'Cash' });
    await create('admin/payment-channels', { paymentModeId: mode, name: 'Counter' });
    await request(http)
      .post('/api/v1/users')
      .set(bearer(admin))
      .send({ email: 'clerk@example.com', password: PASSWORD, displayName: 'Clerk' })
      .expect(201);
    const clerk = await login('clerk@example.com', PASSWORD);

    const channels = await request(http)
      .get(`/api/v1/admin/payment-channels?paymentModeId=${mode}`)
      .set(bearer(clerk))
      .expect(200);
    expect(channels.body).toHaveLength(1);
    await request(http).post('/api/v1/admin/payment-modes').set(bearer(clerk)).send({ name: 'Card' }).expect(403);
    await request(http).get('/api/v1/admin/payment-modes').expect(401);
  });
});

describe('tenants', () => {
  it('stores tenant details and serves logos that match their type', async () => {
    const division = await create('locations/divisions', { name: 'Chattogram' });
    const district = await create('locations/districts', { divisionId: division, name: "Cox's Bazar" });
    const tenant = await create('admin/tenants', {
      name: 'Fouad Al Khateeb Hospital',
      shortName: 'FAK',
      districtId: district,
    });

    await request(http)
      .put(`/api/v1/admin/tenants/${tenant}/logos/primary`)
      .set(bearer(admin))
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(204);
    const logo = await request(http)
      .get(`/api/v1/admin/tenants/${tenant}/logos/primary`)
      .set(bearer(admin))
      .expect(200);
    expect(logo.headers['content-type']).toBe('image/png');
    expect(Buffer.from(logo.body as Buffer)).toEqual(PNG);

    const mismatch = await request(http)
      .put(`/api/v1/admin/tenants/${tenant}/logos/secondary`)
      .set(bearer(admin))
      .set('Content-Type', 'image/jpeg')
      .send(PNG)
      .expect(422);
    expect(mismatch.body.code).toBe('invalid_logo');
    await request(http)
      .put(`/api/v1/admin/tenants/${tenant}/logos/secondary`)
      .set(bearer(admin))
      .set('Content-Type', 'application/json')
      .send({ not: 'an image' })
      .expect(400);
    await request(http)
      .put(`/api/v1/admin/tenants/${tenant}/logos/primary`)
      .set(bearer(admin))
      .set('Content-Type', 'image/png')
      .send(Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))
      .expect(413);
    await request(http).get(`/api/v1/admin/tenants/${tenant}/logos/secondary`).set(bearer(admin)).expect(404);

    await request(http).delete(`/api/v1/locations/districts/${district}`).set(bearer(admin)).expect(409);
    await request(http).delete(`/api/v1/admin/tenants/${tenant}`).set(bearer(admin)).expect(204);
    await request(http).get(`/api/v1/admin/tenants/${tenant}/logos/primary`).set(bearer(admin)).expect(404);
  });
});

describe('settings', () => {
  it('returns defaults, merges partial updates and validates them', async () => {
    const defaults = await request(http).get('/api/v1/admin/settings/general').set(bearer(admin)).expect(200);
    expect(defaults.body).toMatchObject({ visitingCardRate: 0, integratedAccountsEnabled: false });

    const updated = await request(http)
      .patch('/api/v1/admin/settings/general')
      .set(bearer(admin))
      .send({ visitingCardRate: 300, menuBackgroundColor: '#123abc' })
      .expect(200);
    expect(updated.body).toMatchObject({
      visitingCardRate: 300,
      menuBackgroundColor: '#123abc',
      dailyFoodBillInWard: 0,
    });
    await request(http)
      .patch('/api/v1/admin/settings/general')
      .set(bearer(admin))
      .send({ dailyFoodBillInWard: 120 })
      .expect(200);
    const merged = await request(http).get('/api/v1/admin/settings/general').set(bearer(admin)).expect(200);
    expect(merged.body).toMatchObject({ visitingCardRate: 300, dailyFoodBillInWard: 120 });

    await request(http)
      .patch('/api/v1/admin/settings/general')
      .set(bearer(admin))
      .send({ menuBackgroundColor: 'red' })
      .expect(400);
    await request(http)
      .patch('/api/v1/admin/settings/editor-margins')
      .set(bearer(admin))
      .send({ top: '10mm' })
      .expect(200);
    const margins = await request(http).get('/api/v1/admin/settings/editor-margins').set(bearer(admin)).expect(200);
    expect(margins.body).toEqual({ left: '', right: '', top: '10mm', bottom: '' });
  });

  it('answers oversized and malformed bodies with 4xx problem details, not 500', async () => {
    const tooBig = await request(http)
      .patch('/api/v1/admin/settings/editor-margins')
      .set(bearer(admin))
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ top: 'x'.repeat(200 * 1024) }))
      .expect(413);
    expect(tooBig.body.code).toBe('payload_too_large');
    const malformed = await request(http)
      .patch('/api/v1/admin/settings/editor-margins')
      .set(bearer(admin))
      .set('Content-Type', 'application/json')
      .send('{"top": ')
      .expect(400);
    expect(malformed.body.code).toBe('bad_request');
  });

  it('documents the new routes', async () => {
    const docs = await request(http).get('/api/docs/openapi.json').expect(200);
    for (const path of [
      '/api/v1/locations/districts',
      '/api/v1/locations/districts/{id}',
      '/api/v1/admin/service-units',
      '/api/v1/admin/tenants/{id}/logos/{slot}',
      '/api/v1/admin/settings/general',
    ]) {
      expect(docs.body.paths[path], path).toBeDefined();
    }
    expect(docs.body.components.schemas.CreateServiceUnitDto.required).toEqual(['departmentId', 'name']);
  });
});
