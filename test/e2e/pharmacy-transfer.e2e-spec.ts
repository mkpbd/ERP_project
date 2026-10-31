import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let keeper: string;
let seller: string;
let central: string;
let outdoor: string;
let napa: string;
let seclo: string;

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

async function create(path: string, body: Record<string, unknown>, token = admin): Promise<string> {
  const response = await request(http).post(`/api/v1/${path}`).set(bearer(token)).send(body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
  return response.body.id as string;
}

async function user(name: string): Promise<{ id: string; token: string }> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  const role = await create('roles', { name: `role-${name}`, permissions: ['pharmacy:read', 'pharmacy:transfer'] });
  await request(http)
    .post(`/api/v1/users/${created.body.id}/roles`)
    .set(bearer(admin))
    .send({ roleId: role })
    .expect(204);
  return { id: created.body.id as string, token: await login(`${name}@example.com`, PASSWORD) };
}

const ph = (method: 'get' | 'post' | 'patch', path: string, token: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/pharmacy/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const stockOf = async (outletId: string) =>
  ((await ph('get', `stock?outletId=${outletId}&productId=${napa}`, admin).expect(200)).body.items[0] ?? {
    qty: 0,
    value: 0,
    lots: [],
  }) as { qty: number; value: number; lots: { lotId: string; batchNo: string; qty: number }[] };

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  const keeperUser = await user('keeper');
  const sellerUser = await user('seller');
  keeper = keeperUser.token;
  seller = sellerUser.token;

  const maker = await create('pharmacy/manufacturers', { name: 'Beximco' });
  const tablet = await create('pharmacy/formations', { name: 'Tablet', shortName: 'Tab.' });
  napa = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Napa', manufacturerId: maker }),
    genericId: await create('pharmacy/generics', { name: 'Paracetamol' }),
    formationId: tablet,
  });
  seclo = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Seclo', manufacturerId: maker }),
    genericId: await create('pharmacy/generics', { name: 'Omeprazole' }),
    formationId: tablet,
  });
  central = await create('pharmacy/outlets', { name: 'Central pharmacy store' });
  outdoor = await create('pharmacy/outlets', { name: 'Outdoor pharmacy' });
  await create('pharmacy/outlet-users', { outletId: central, userId: keeperUser.id });
  await create('pharmacy/outlet-users', { outletId: outdoor, userId: sellerUser.id });
  await create('pharmacy/opening-stock', {
    outletId: central,
    openedOn: '2026-01-01',
    lines: [
      { productId: napa, qty: 50, unitCost: 0.8, saleRate: 1.2, batchNo: 'A', expiryDate: '2026-03-31' },
      { productId: napa, qty: 100, unitCost: 0.85, saleRate: 1.2, batchNo: 'B', expiryDate: '2026-12-31' },
      { productId: napa, qty: 200, unitCost: 0.9, saleRate: 1.2, batchNo: 'C', expiryDate: '2027-06-30' },
    ],
  });
});

describe('outlet indents and transfers', () => {
  it('sends against an indent first expiring first, accepts into the same lots, rejects back and closes', async () => {
    const indent = await ph('post', 'outlet-indents', seller, {
      requestingOutletId: outdoor,
      supplyingOutletId: central,
      indentDate: '2026-04-09',
      urgent: true,
      lines: [
        { productId: napa, qty: 250 },
        { productId: seclo, qty: 10 },
      ],
    }).expect(201);
    expect(indent.body.number).toBe('OI-2026-00001');
    const viewed = await ph('get', `outlet-indents/${indent.body.id}`, keeper).expect(200);
    // Lot A has expired by now: it is not counted as available.
    expect(viewed.body.lines.map((line: { qty: number; available: number }) => [line.qty, line.available])).toEqual([
      [250, 300],
      [10, 0],
    ]);

    const send = (qty: number, token = keeper, extra: Record<string, unknown> = {}) =>
      ph('post', 'transfers', token, {
        fromOutletId: central,
        toOutletId: outdoor,
        indentId: indent.body.id,
        transferDate: '2026-04-10',
        lines: [{ productId: napa, qty }],
        ...extra,
      });
    expect((await send(150, seller)).body.code).toBe('no_outlet_access');
    const sent = await send(150).expect(201);
    expect(sent.body.number).toBe('TT-2026-00001');
    const transfer = await ph('get', `transfers/${sent.body.id}`, keeper).expect(200);
    expect(transfer.body).toMatchObject({ status: 'in_transit', indentNumber: 'OI-2026-00001', value: 130 });
    expect(transfer.body.lines.map((line: { batchNo: string; qty: number }) => [line.batchNo, line.qty])).toEqual([
      ['B', 100],
      ['C', 50],
    ]);
    // Out of the store, not yet at the outdoor pharmacy.
    expect((await stockOf(central)).qty).toBe(200);
    expect((await stockOf(outdoor)).qty).toBe(0);
    expect((await send(101)).body.code).toBe('over_transfer');
    expect((await send(1, keeper, { lines: [{ productId: seclo, qty: 1 }] })).body.code).toBe('insufficient_stock');

    expect(
      (
        await ph('post', `transfers/${sent.body.id}/decision`, keeper, {
          version: 1,
          decision: 'accept',
          on: '2026-04-11',
        })
      ).body.code,
    ).toBe('no_outlet_access');
    await ph('post', `transfers/${sent.body.id}/decision`, seller, {
      version: 1,
      decision: 'accept',
      on: '2026-04-11',
    }).expect(204);
    const outdoorStock = await stockOf(outdoor);
    expect(outdoorStock).toMatchObject({ qty: 150, value: 130 });
    expect(outdoorStock.lots.map((lot) => [lot.batchNo, lot.qty])).toEqual([
      ['B', 100],
      ['C', 50],
    ]);
    expect(
      (
        await ph('post', `transfers/${sent.body.id}/decision`, seller, {
          version: 2,
          decision: 'reject',
          on: '2026-04-11',
        })
      ).body.code,
    ).toBe('transfer_state');

    const second = await send(100).expect(201);
    expect((await stockOf(central)).qty).toBe(100);
    await ph('post', `transfers/${second.body.id}/decision`, seller, {
      version: 1,
      decision: 'reject',
      on: '2026-04-11',
    }).expect(422);
    await ph('post', `transfers/${second.body.id}/decision`, seller, {
      version: 1,
      decision: 'reject',
      on: '2026-04-11',
      reason: 'Not ordered by the ward',
    }).expect(204);
    expect((await stockOf(central)).qty).toBe(200);
    const after = await ph('get', `outlet-indents/${indent.body.id}`, seller).expect(200);
    expect(after.body).toMatchObject({
      status: 'partly_transferred',
      lines: [{ transferredQty: 150 }, { transferredQty: 0 }],
    });

    expect(
      (
        await ph('post', `outlet-indents/${indent.body.id}/cancel`, seller, {
          version: after.body.version,
          reason: 'x',
        })
      ).body.code,
    ).toBe('outlet_indent_state');
    await ph('post', `outlet-indents/${indent.body.id}/close`, seller, {
      version: after.body.version,
      reason: 'Rest bought locally',
    }).expect(204);
    expect((await send(1)).body.code).toBe('outlet_indent_state');

    const card = await ph(
      'get',
      `stock/card?outletId=${central}&productId=${napa}&from=2026-04-01&to=2026-04-30`,
      admin,
    ).expect(200);
    expect(card.body).toMatchObject({ opening: 350, closing: 200, totalOut: 250, totalIn: 100 });

    await request(http)
      .post('/api/v1/reports/pharmacy.transfer/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: sent.body.id } })
      .expect(200);
  });

  it('sends without an indent from a named lot, and lists what is in transit', async () => {
    const { lots } = await stockOf(central);
    const lotC = lots.find((lot) => lot.batchNo === 'C')!.lotId;
    const direct = await ph('post', 'transfers', keeper, {
      fromOutletId: central,
      toOutletId: outdoor,
      transferDate: '2026-04-10',
      lines: [{ productId: napa, qty: 10, lotId: lotC }],
    }).expect(201);
    expect((await ph('get', `transfers/${direct.body.id}`, keeper).expect(200)).body.lines).toMatchObject([
      { batchNo: 'C', qty: 10, unitCost: 0.9 },
    ]);
    const expired = lots.find((lot) => lot.batchNo === 'A')!.lotId;
    const refused = await ph('post', 'transfers', keeper, {
      fromOutletId: central,
      toOutletId: outdoor,
      transferDate: '2026-04-10',
      lines: [{ productId: napa, qty: 1, lotId: expired }],
    });
    expect(refused.body.code).toBe('insufficient_stock');
    const transit = await ph('get', `transfers?toOutletId=${outdoor}&status=in_transit`, seller).expect(200);
    expect(transit.body.items.map((item: { number: string }) => item.number)).toEqual([direct.body.number]);

    // Two lots sent; the second line is sent back, the first kept.
    const lotB = lots.find((lot) => lot.batchNo === 'B')!.lotId;
    const mixed = await ph('post', 'transfers', keeper, {
      fromOutletId: central,
      toOutletId: outdoor,
      transferDate: '2026-04-10',
      lines: [
        { productId: napa, qty: 20, lotId: lotB },
        { productId: napa, qty: 30, lotId: lotC },
      ],
    }).expect(201);
    expect((await stockOf(central)).qty).toBe(290);
    await ph('post', `transfers/${mixed.body.id}/decision`, seller, {
      version: 1,
      decision: 'accept',
      on: '2026-04-11',
      rejectLines: [2],
      reason: 'Short dated for this ward',
    }).expect(204);
    expect((await stockOf(outdoor)).lots.map((lot) => [lot.batchNo, lot.qty])).toEqual([['B', 20]]);
    expect((await stockOf(central)).qty).toBe(320);
    const decided = await ph('get', `transfers/${mixed.body.id}`, seller).expect(200);
    expect(decided.body).toMatchObject({
      status: 'accepted',
      rejectReason: 'Short dated for this ward',
      lines: [{ rejected: false }, { rejected: true }],
    });
    const self = await ph('post', 'outlet-indents', seller, {
      requestingOutletId: outdoor,
      supplyingOutletId: outdoor,
      indentDate: '2026-04-09',
      lines: [{ productId: napa, qty: 1 }],
    });
    expect(self.body.code).toBe('same_outlet');
  });
});

describe('lot corrections', () => {
  it('moves a lot entered wrong to the lot it should have been, at every outlet, at its cost', async () => {
    type Lot = { lotId: string; batchNo: string; expiryDate: string; saleRate: number; qty: number; value: number };
    const lotsAt = async (outletId: string) => (await stockOf(outletId)).lots as unknown as Lot[];
    const before = await stockOf(central);
    const lotA = (await lotsAt(central)).find((lot) => lot.batchNo === 'A')!;
    const fix = (lotId: string, body: Record<string, unknown>, token = admin) =>
      ph('post', `lots/${lotId}/correct`, token, {
        batchNo: 'A',
        expiryDate: '2027-03-31',
        saleRate: 1.2,
        reason: 'The year of the expiry was typed wrong',
        correctedOn: '2026-04-01',
        ...body,
      });

    expect((await fix(lotA.lotId, {}, keeper)).status).toBe(403);
    const same = await fix(lotA.lotId, { expiryDate: lotA.expiryDate });
    expect([same.status, same.body.code]).toEqual([422, 'lot_unchanged']);

    // The lot printed 2027 was entered as 2026 and had expired: it moves, and can be sent again.
    const fixed = await fix(lotA.lotId, {}).expect(201);
    expect(fixed.body).toMatchObject({ number: expect.stringMatching(/^LC-2026-/), units: 50 });
    const after = await stockOf(central);
    expect([after.qty, after.value]).toEqual([before.qty, before.value]);
    expect(after.lots.find((lot) => lot.lotId === lotA.lotId)).toBeUndefined();
    expect((await lotsAt(central)).find((lot) => lot.lotId === fixed.body.toLotId)).toMatchObject({
      batchNo: 'A',
      expiryDate: '2027-03-31',
      qty: 50,
      value: 40,
    });
    const empty = await fix(lotA.lotId, { saleRate: 1.5 });
    expect([empty.status, empty.body.code]).toEqual([422, 'lot_not_in_stock']);
    await ph('post', 'transfers', keeper, {
      fromOutletId: central,
      toOutletId: outdoor,
      transferDate: '2026-04-10',
      lines: [{ productId: napa, qty: 5, lotId: fixed.body.toLotId }],
    }).expect(201);

    // A lot corrected into one that exists already joins it.
    const lots = await lotsAt(central);
    const lotB = lots.find((lot) => lot.batchNo === 'B')!;
    const lotC = lots.find((lot) => lot.batchNo === 'C')!;
    const merged = await fix(lotC.lotId, { batchNo: 'B', expiryDate: '2026-12-31', reason: 'Strip says B' }).expect(
      201,
    );
    expect(merged.body.toLotId).toBe(lotB.lotId);
    expect((await lotsAt(central)).find((lot) => lot.lotId === lotB.lotId)).toMatchObject({ qty: 300, value: 265 });
  });
});
