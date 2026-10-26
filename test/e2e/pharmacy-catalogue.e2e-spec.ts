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

async function login(identifier: string, password: string): Promise<string> {
  const response = await request(http)
    .post('/api/v1/auth/login')
    .set('X-Refresh-Token-Delivery', 'body')
    .send({ identifier, password })
    .expect(200);
  return response.body.accessToken as string;
}

const post = (path: string, body: Record<string, unknown>, token = admin) =>
  request(http).post(`/api/v1/pharmacy/${path}`).set(bearer(token)).send(body);

async function create(path: string, body: Record<string, unknown>): Promise<string> {
  const response = await post(path, body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
  return response.body.id as string;
}

function binary(response: request.Response, callback: (error: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
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

describe('pharmacy catalogue', () => {
  it('builds products from brands, generics, formations and strengths, and finds them by name or barcode', async () => {
    const analgesic = await create('generic-groups', { name: 'Analgesic' });
    const paracetamol = await create('generics', { name: 'Paracetamol', groupId: analgesic });
    const tablet = await create('formations', { name: 'Tablet', shortName: 'Tab.' });
    const syrup = await create('formations', { name: 'Syrup', shortName: 'Syp.' });
    const mg500 = await create('strengths', { name: '500 mg' });
    const pcs = await create('units', { name: 'Pcs' });
    const box = await create('package-units', { name: 'Box' });
    const beximco = await create('manufacturers', { name: 'Beximco Pharma' });
    const square = await create('manufacturers', { name: 'Square Pharmaceuticals' });
    const napa = await create('brands', { name: 'Napa', manufacturerId: beximco });
    const ace = await create('brands', { name: 'Ace', manufacturerId: square });
    expect((await post('brands', { name: 'NAPA', manufacturerId: beximco })).body.code).toBe('brand_name_taken');
    // Another manufacturer may use the same brand name.
    await create('brands', { name: 'Napa', manufacturerId: square });

    const napaTab = await create('products', {
      brandId: napa,
      genericId: paracetamol,
      formationId: tablet,
      strengthId: mg500,
      unitId: pcs,
      packageUnitId: box,
      unitsPerPack: 100,
      purchasePrice: 0.9,
      salePrice: 1.2,
      barcode: '8941100500018',
    });
    await create('products', { brandId: napa, genericId: paracetamol, formationId: syrup, salePrice: 35 });
    await create('products', { brandId: ace, genericId: paracetamol, formationId: tablet, strengthId: mg500 });
    const twice = await post('products', {
      brandId: napa,
      genericId: paracetamol,
      formationId: tablet,
      strengthId: mg500,
    });
    expect([twice.status, twice.body.code]).toEqual([409, 'product_exists']);
    // No strength is a strength too: the syrup cannot be entered twice.
    expect((await post('products', { brandId: napa, genericId: paracetamol, formationId: syrup })).body.code).toBe(
      'product_exists',
    );
    const barcode = await post('products', {
      brandId: ace,
      genericId: paracetamol,
      formationId: syrup,
      barcode: '8941100500018',
    });
    expect(barcode.body.code).toBe('product_barcode_taken');
    expect((await post('products', { brandId: ace, genericId: paracetamol, formationId: tablet + 'x' })).status).toBe(
      400,
    );
    const unknown = await post('products', {
      brandId: ace,
      genericId: '00000000-0000-4000-8000-000000000000',
      formationId: syrup,
    });
    expect([unknown.status, unknown.body.code]).toEqual([404, 'generic_not_found']);

    const search = async (query: string) =>
      (await request(http).get(`/api/v1/pharmacy/catalogue?${query}`).set(bearer(admin)).expect(200)).body as {
        items: { id: string; displayName: string; manufacturerName: string }[];
        total: number;
      };
    const napas = await search('q=napa');
    expect(napas.items.map((entry) => entry.displayName)).toEqual(['Syp. Napa', 'Tab. Napa 500 mg']);
    expect((await search('q=paracet')).total).toBe(3);
    expect((await search('q=8941100500018')).items).toMatchObject([
      {
        id: napaTab,
        displayName: 'Tab. Napa 500 mg',
        genericName: 'Paracetamol',
        genericGroupName: 'Analgesic',
        manufacturerName: 'Beximco Pharma',
        unitName: 'Pcs',
        packageUnitName: 'Box',
        unitsPerPack: 100,
        salePrice: 1.2,
      },
    ]);
    expect((await search(`manufacturerId=${square}`)).items.map((entry) => entry.displayName)).toEqual([
      'Tab. Ace 500 mg',
    ]);

    await request(http)
      .patch(`/api/v1/pharmacy/products/${napaTab}`)
      .set(bearer(admin))
      .send({ isActive: false })
      .expect(200);
    expect((await search('q=napa&isActive=true')).items.map((entry) => entry.displayName)).toEqual(['Syp. Napa']);
    const inUse = await request(http).delete(`/api/v1/pharmacy/generics/${paracetamol}`).set(bearer(admin));
    expect([inUse.status, inUse.body.code]).toEqual([409, 'generic_in_use']);

    const list = await request(http)
      .post('/api/v1/reports/pharmacy.price-list/render')
      .set(bearer(admin))
      .send({ format: 'xlsx', params: {} })
      .buffer(true)
      .parse(binary)
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(list.body as Buffer).buffer);
    const values = workbook.worksheets[0]!.getSheetValues().flat();
    expect(values).toContain('Tab. Ace 500 mg');
    expect(values).not.toContain('Tab. Napa 500 mg');
    await request(http)
      .post('/api/v1/reports/pharmacy.price-list/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { includeInactive: true } })
      .expect(200);
  });

  it('sets up outlets, who works there and reorder levels; only managers may change them', async () => {
    const outdoor = await create('outlets', { name: 'Outdoor pharmacy', code: 'OPD' });
    expect((await post('outlets', { name: 'Indoor pharmacy', code: 'opd' })).body.code).toBe('outlet_code_taken');
    const created = await request(http)
      .post('/api/v1/users')
      .set(bearer(admin))
      .send({ email: 'pharmacist@example.com', password: PASSWORD, displayName: 'Pharmacist' })
      .expect(201);
    const role = await request(http)
      .post('/api/v1/roles')
      .set(bearer(admin))
      .send({ name: 'pharmacists', permissions: ['pharmacy:read'] })
      .expect(201);
    await request(http)
      .post(`/api/v1/users/${created.body.id}/roles`)
      .set(bearer(admin))
      .send({ roleId: role.body.id })
      .expect(204);
    const pharmacist = await login('pharmacist@example.com', PASSWORD);
    await create('outlet-users', { outletId: outdoor, userId: created.body.id });
    expect((await post('outlet-users', { outletId: outdoor, userId: created.body.id })).body.code).toBe(
      'outlet_user_exists',
    );

    const generic = await create('generics', { name: 'Omeprazole' });
    const capsule = await create('formations', { name: 'Capsule', shortName: 'Cap.' });
    const maker = await create('manufacturers', { name: 'Incepta' });
    const brand = await create('brands', { name: 'Seclo', manufacturerId: maker });
    const seclo = await create('products', { brandId: brand, genericId: generic, formationId: capsule });
    await create('reorder-levels', { outletId: outdoor, productId: seclo, level: 200 });
    expect((await post('reorder-levels', { outletId: outdoor, productId: seclo, level: 100 })).body.code).toBe(
      'reorder_level_exists',
    );

    const levels = await request(http)
      .get(`/api/v1/pharmacy/reorder-levels?outletId=${outdoor}`)
      .set(bearer(pharmacist))
      .expect(200);
    expect(levels.body).toMatchObject([{ productId: seclo, level: 200 }]);
    expect((await post('outlets', { name: 'Ward pharmacy' }, pharmacist)).status).toBe(403);
  });
});
