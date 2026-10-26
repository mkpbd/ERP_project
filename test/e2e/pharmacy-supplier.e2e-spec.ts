import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let keeper: string;
let accountant: string;
let central: string;
let supplier: string;
let napa: string;
let seclo: string;
const receives: string[] = [];
const gl: Record<string, string> = {};

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
  return { id: created.body.id as string, token: await login(`${name}@example.com`, PASSWORD) };
}

async function glAccount(nature: string, normalBalance: string, code: string, name: string, extra = {}) {
  const existing = await request(http).get('/api/v1/accounts/natures').set(bearer(admin));
  const natureId =
    (existing.body as { id: string; code: string }[]).find((entry) => entry.code === nature)?.id ??
    (await create('accounts/natures', {
      code: nature,
      name: `Nature ${nature}`,
      statement: 'balance_sheet',
      normalBalance,
    }));
  const category = await create('accounts/categories', { natureId, code: `${code}C`, name: `${name} group` });
  const sub = await create('accounts/sub-categories', { categoryId: category, name: 'General' });
  const head4 = await create('accounts/level4-heads', { subCategoryId: sub, name: 'General' });
  const head5 = await create('accounts/level5-heads', { level4HeadId: head4, name: 'General' });
  return create('accounts/gl-accounts', { level5HeadId: head5, code, name, ...extra });
}

const ph = (
  method: 'get' | 'post' | 'patch' | 'delete',
  path: string,
  token: string,
  body?: Record<string, unknown>,
) => {
  const call = request(http)[method](`/api/v1/pharmacy/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const closing = async (account: string) =>
  (
    await request(http)
      .get(`/api/v1/accounts/books/ledger?glAccountId=${gl[account]}&from=2026-01-01&to=2026-06-30`)
      .set(bearer(admin))
      .expect(200)
  ).body.closing as number;
const napaStock = async () =>
  ((await ph('get', `stock?outletId=${central}&productId=${napa}`, admin).expect(200)).body.items[0]?.qty as
    number | undefined) ?? 0;
const dues = async () =>
  (await ph('get', `supplier-dues?supplierId=${supplier}`, accountant).expect(200)).body.items as {
    receiveId: string;
    number: string;
    due: number;
  }[];

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  const keeperUser = await user('keeper', ['pharmacy:read', 'pharmacy:receive']);
  keeper = keeperUser.token;
  accountant = (await user('accountant', ['pharmacy:read', 'pharmacy:payment'])).token;

  await create('accounts/fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  gl.inventory = await glAccount('1', 'debit', '1350', 'Medicine inventory');
  gl.cash = await glAccount('1', 'debit', '1001', 'Cash in hand');
  gl.bank = await glAccount('1', 'debit', '1101', 'Sonali Bank current account');
  gl.payable = await glAccount('2', 'credit', '2101', 'Payable to suppliers', { isControlAccount: true });
  await create('accounts/gl-roles', { role: 'pharmacy_inventory', glAccountId: gl.inventory });
  await create('accounts/gl-roles', { role: 'supplier_payable', glAccountId: gl.payable });
  await create('accounts/gl-roles', { role: 'cash_in_hand', glAccountId: gl.cash });
  const partyType = await create('accounts/sub-ledger-types', { name: 'Suppliers' });
  const party = await create('accounts/sub-ledgers', { typeId: partyType, name: 'Beximco Pharma' });
  const local = await create('scm/supplier-types', { name: 'Local' });
  supplier = await create('scm/suppliers', { typeId: local, name: 'Beximco Pharma', subLedgerId: party });

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
  await create('pharmacy/outlet-users', { outletId: central, userId: keeperUser.id });

  receives.length = 0;
  for (const [invoice, productId, qty, purchaseRate] of [
    ['BX-1', napa, 600, 0.9],
    ['BX-2', seclo, 200, 4.5],
  ] as const) {
    const draft = await ph('post', 'receives', keeper, {
      outletId: central,
      supplierId: supplier,
      receivedOn: '2026-03-05',
      supplierInvoiceNo: invoice,
      lines: [{ productId, qty, purchaseRate, saleRate: 1.2, batchNo: 'B1', expiryDate: '2027-06-30' }],
    }).expect(201);
    await ph('post', `receives/${draft.body.id}/post`, keeper, { version: 1 }).expect(200);
    receives.push(draft.body.id as string);
  }
});

describe('pharmacy suppliers', () => {
  it('pays receives in cash and from the bank, never above what is due', async () => {
    expect((await dues()).map((due) => [due.number, due.due])).toEqual([
      ['GR-2026-00001', 540],
      ['GR-2026-00002', 900],
    ]);
    const lines = [
      { receiveId: receives[0], amount: 300 },
      { receiveId: receives[1], amount: 900 },
    ];
    const pay = (body: Record<string, unknown>, token = accountant) =>
      ph('post', 'supplier-payments', token, {
        supplierId: supplier,
        paidOn: '2026-03-20',
        method: 'cash',
        lines,
        ...body,
      });
    expect((await pay({}, keeper)).status).toBe(403);
    const paid = await pay({ reference: 'Cash memo 17' }).expect(201);
    expect(paid.body).toMatchObject({ number: 'SP-2026-00001', voucherNumber: expect.stringMatching(/^JV-/) });
    expect(await closing('payable')).toBe(-240);
    expect(await closing('cash')).toBe(-1_200);
    expect((await dues()).map((due) => [due.number, due.due])).toEqual([['GR-2026-00001', 240]]);

    const over = await pay({ lines: [{ receiveId: receives[0], amount: 240.01 }] });
    expect([over.status, over.body.code]).toEqual([422, 'overpayment']);
    expect((await pay({ method: 'bank', lines: [{ receiveId: receives[0], amount: 240 }] })).body.code).toBe(
      'invalid_payment',
    );
    expect((await pay({ lines: [{ receiveId: receives[1], amount: 1 }] })).body.code).toBe('overpayment');
    const draft = await ph('post', 'receives', keeper, {
      outletId: central,
      supplierId: supplier,
      receivedOn: '2026-03-06',
      lines: [{ productId: napa, qty: 10, purchaseRate: 1, saleRate: 1.2, expiryDate: '2027-06-30' }],
    }).expect(201);
    expect((await pay({ lines: [{ receiveId: draft.body.id, amount: 1 }] })).body.code).toBe('not_payable');

    await pay({ method: 'bank', bankAccountId: gl.bank, lines: [{ receiveId: receives[0], amount: 240 }] }).expect(201);
    expect(await closing('bank')).toBe(-240);
    expect(await closing('payable')).toBe(0);
    expect(await dues()).toEqual([]);

    const receipt = await ph('get', `supplier-payments/${paid.body.id}`, accountant).expect(200);
    expect(receipt.body).toMatchObject({
      supplierName: 'Beximco Pharma',
      method: 'cash',
      total: 1_200,
      lines: [
        { receiveNumber: 'GR-2026-00001', dueBefore: 540, amount: 300, dueAfter: 240 },
        { receiveNumber: 'GR-2026-00002', dueBefore: 900, amount: 900, dueAfter: 0 },
      ],
    });
    expect((await ph('get', `supplier-payments?supplierId=${supplier}`, accountant).expect(200)).body.total).toBe(2);
    await request(http)
      .post('/api/v1/reports/pharmacy.supplier-payment/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: paid.body.id } })
      .expect(200);
  });

  it('returns lots to the supplier at cost and takes replacements up to their value', async () => {
    const lot = (await ph('get', `stock?outletId=${central}&productId=${napa}`, admin).expect(200)).body.items[0]
      .lots[0].lotId as string;
    const created = await ph('post', 'supplier-returns', keeper, {
      outletId: central,
      supplierId: supplier,
      returnDate: '2026-03-25',
      reason: 'Short expiry',
      lines: [{ lotId: lot, qty: 700 }],
    }).expect(201);
    expect(created.body.number).toBe('RT-2026-00001');
    const short = await ph('post', `supplier-returns/${created.body.id}/send`, keeper, { version: 1 });
    expect([short.status, short.body.code]).toEqual([422, 'insufficient_stock']);
    await ph('patch', `supplier-returns/${created.body.id}`, keeper, {
      version: 1,
      lines: [{ lotId: lot, qty: 100 }],
    }).expect(204);
    const sent = await ph('post', `supplier-returns/${created.body.id}/send`, keeper, { version: 2 }).expect(200);
    expect(sent.body).toMatchObject({ value: 90, voucherNumber: expect.stringMatching(/^JV-/) });
    expect(await napaStock()).toBe(500);
    // 1,440 owed for the receives, less 90 the supplier now owes back.
    expect(await closing('payable')).toBe(-1_350);
    expect(await closing('inventory')).toBe(1_350);
    expect(
      (await ph('patch', `supplier-returns/${created.body.id}`, keeper, { version: 3, reason: 'x' })).body.code,
    ).toBe('supplier_return_state');

    const replace = (version: number, qty: number) =>
      ph('post', `supplier-returns/${created.body.id}/settle`, keeper, {
        version,
        on: '2026-04-02',
        lines: [{ productId: napa, qty, purchaseRate: 0.9, saleRate: 1.2, batchNo: 'R1', expiryDate: '2028-01-31' }],
      });
    expect((await replace(3, 50).expect(200)).body).toMatchObject({ status: 'partly_settled' });
    expect(await napaStock()).toBe(550);
    expect(await closing('payable')).toBe(-1_395);
    const over = await replace(4, 60);
    expect([over.status, over.body.code]).toEqual([422, 'over_settlement']);
    await ph('post', `supplier-returns/${created.body.id}/close`, keeper, {
      version: 4,
      reason: 'Rest set off',
    }).expect(204);

    const view = await ph('get', `supplier-returns/${created.body.id}`, keeper).expect(200);
    expect(view.body).toMatchObject({
      status: 'closed',
      value: 90,
      settledValue: 45,
      lines: [{ displayName: 'Tab. Napa', batchNo: 'B1', qty: 100, unitCost: 0.9, value: 90 }],
      settlements: [{ displayName: 'Tab. Napa', batchNo: 'R1', qty: 50, value: 45 }],
    });
    const card = await ph(
      'get',
      `stock/card?outletId=${central}&productId=${napa}&from=2026-03-01&to=2026-04-30`,
      admin,
    ).expect(200);
    expect(card.body.rows.map((row: { kind: string; balance: number }) => [row.kind, row.balance])).toEqual([
      ['receive', 600],
      ['supplier_return', 500],
      ['replacement', 550],
    ]);
    await request(http)
      .post('/api/v1/reports/pharmacy.supplier-return/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { id: created.body.id } })
      .expect(200);

    const other = await ph('post', 'supplier-returns', keeper, {
      outletId: central,
      supplierId: supplier,
      returnDate: '2026-03-26',
      reason: 'Damaged',
      lines: [{ lotId: lot, qty: 1 }],
    }).expect(201);
    await ph('delete', `supplier-returns/${other.body.id}?version=1`, keeper).expect(204);
    expect((await ph('get', `supplier-returns?supplierId=${supplier}`, keeper).expect(200)).body.total).toBe(1);
  });
});
