import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let buyer: string;
let storekeeper: string;
let central: string;
let outdoor: string;
let supplier: string;
let napa: string;
let seclo: string;
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
const stockAt = async (outletId: string, extra = '') =>
  (await ph('get', `stock?outletId=${outletId}${extra}`, admin).expect(200)).body.items as {
    productId: string;
    displayName: string;
    qty: number;
    value: number;
    saleValue: number;
    belowReorder: boolean;
    lots: { lotId: string; batchNo: string; saleRate: number; qty: number }[];
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
  buyer = (await user('buyer', ['pharmacy:read', 'pharmacy:purchase'])).token;
  const keeper = await user('keeper', ['pharmacy:read', 'pharmacy:receive']);
  storekeeper = keeper.token;

  await create('accounts/fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  gl.inventory = await glAccount('1', 'debit', '1350', 'Medicine inventory');
  gl.payable = await glAccount('2', 'credit', '2101', 'Payable to suppliers', { isControlAccount: true });
  await create('accounts/gl-roles', { role: 'pharmacy_inventory', glAccountId: gl.inventory });
  await create('accounts/gl-roles', { role: 'supplier_payable', glAccountId: gl.payable });
  const partyType = await create('accounts/sub-ledger-types', { name: 'Suppliers' });
  const party = await create('accounts/sub-ledgers', { typeId: partyType, name: 'Beximco Pharma' });
  const local = await create('scm/supplier-types', { name: 'Local' });
  supplier = await create('scm/suppliers', { typeId: local, name: 'Beximco Pharma', subLedgerId: party });

  const paracetamol = await create('pharmacy/generics', { name: 'Paracetamol' });
  const omeprazole = await create('pharmacy/generics', { name: 'Omeprazole' });
  const tablet = await create('pharmacy/formations', { name: 'Tablet', shortName: 'Tab.' });
  const capsule = await create('pharmacy/formations', { name: 'Capsule', shortName: 'Cap.' });
  const maker = await create('pharmacy/manufacturers', { name: 'Beximco' });
  napa = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Napa', manufacturerId: maker }),
    genericId: paracetamol,
    formationId: tablet,
  });
  seclo = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Seclo', manufacturerId: maker }),
    genericId: omeprazole,
    formationId: capsule,
  });
  central = await create('pharmacy/outlets', { name: 'Central pharmacy store' });
  outdoor = await create('pharmacy/outlets', { name: 'Outdoor pharmacy' });
  await create('pharmacy/outlet-users', { outletId: central, userId: keeper.id });
});

const napaLine = {
  productId: '',
  qty: 600,
  purchaseRate: 0.9,
  saleRate: 1.2,
  discountPercent: 5,
  batchNo: 'B1',
  expiryDate: '2027-06-30',
};

describe('pharmacy purchase and stock', () => {
  it('orders, receives into stock by lot, posts to the supplier ledger and closes the order', async () => {
    const order = await ph('post', 'purchase-orders', buyer, {
      supplierId: supplier,
      outletId: central,
      orderDate: '2026-03-01',
      lines: [
        { productId: napa, qty: 1000 },
        { productId: seclo, qty: 200 },
      ],
    }).expect(201);
    expect(order.body.number).toBe('PO-2026-00001');
    await ph('patch', `purchase-orders/${order.body.id}`, buyer, { version: 1, note: 'Urgent' }).expect(204);

    const header = {
      outletId: central,
      supplierId: supplier,
      purchaseOrderId: order.body.id,
      receivedOn: '2026-03-05',
      supplierInvoiceNo: 'BX-7781',
    };
    const lines = [
      { ...napaLine, productId: napa, bonusQty: 60 },
      {
        productId: seclo,
        qty: 200,
        purchaseRate: 4.5,
        saleRate: 6,
        vatPercent: 2,
        batchNo: 'S9',
        expiryDate: '2027-01-31',
      },
    ];
    const elsewhere = await ph('post', 'receives', storekeeper, {
      ...header,
      outletId: outdoor,
      purchaseOrderId: null,
      lines,
    });
    expect([elsewhere.status, elsewhere.body.code]).toEqual([403, 'no_outlet_access']);
    expect((await ph('post', 'receives', buyer, { ...header, lines })).status).toBe(403);
    const mismatch = await ph('post', 'receives', admin, { ...header, outletId: outdoor, lines });
    expect(mismatch.body.code).toBe('order_mismatch');

    const receive = await ph('post', 'receives', storekeeper, { ...header, lines }).expect(201);
    expect(receive.body.number).toBe('GR-2026-00001');
    const draft = await ph('get', `receives/${receive.body.id}`, storekeeper).expect(200);
    // 540 less 5 % = 513; 900 plus 2 % VAT = 918.
    expect(draft.body).toMatchObject({ amount: 1_440, discount: 27, vat: 18, total: 1_431, status: 'draft' });
    expect(draft.body.lines[0]).toMatchObject({ displayName: 'Tab. Napa', total: 513 });
    expect(await stockAt(central)).toEqual([]);

    const posted = await ph('post', `receives/${receive.body.id}/post`, storekeeper, { version: 1 }).expect(200);
    expect(posted.body.voucherNumber).toMatch(/^JV-/);
    expect(await closing('inventory')).toBe(1_431);
    expect(await closing('payable')).toBe(-1_431);
    expect(
      (await ph('patch', `receives/${receive.body.id}`, storekeeper, { version: 2, remarks: 'x' })).body.code,
    ).toBe('pharmacy_receive_state');

    const stock = await stockAt(central);
    expect(stock.map((row) => [row.displayName, row.qty, row.value, row.saleValue])).toEqual([
      // 60 bonus units come in free: 513 over 660 units is 0.7773 a unit (4 decimals), so 513.02 at cost.
      ['Tab. Napa', 660, 513.02, 792],
      ['Cap. Seclo', 200, 918, 1_200],
    ]);
    const product = await ph('get', `products/${napa}`, admin).expect(200);
    expect(product.body).toMatchObject({ purchasePrice: 0.9, salePrice: 1.2 });

    const ordered = await ph('get', `purchase-orders/${order.body.id}`, buyer).expect(200);
    expect(ordered.body).toMatchObject({
      status: 'partly_received',
      note: 'Urgent',
      lines: [
        { displayName: 'Tab. Napa', qty: 1000, receivedQty: 600 },
        { displayName: 'Cap. Seclo', qty: 200, receivedQty: 200 },
      ],
    });
    const over = await ph('post', 'receives', storekeeper, {
      ...header,
      supplierInvoiceNo: 'BX-7790',
      lines: [{ ...napaLine, productId: napa, qty: 401 }],
    }).expect(201);
    expect((await ph('post', `receives/${over.body.id}/post`, storekeeper, { version: 1 })).body.code).toBe(
      'over_receipt',
    );
    await ph('delete', `receives/${over.body.id}?version=1`, storekeeper).expect(204);

    const sameInvoice = await ph('post', 'receives', storekeeper, {
      ...header,
      purchaseOrderId: null,
      supplierInvoiceNo: 'bx-7781',
      lines,
    });
    expect([sameInvoice.status, sameInvoice.body.code]).toEqual([409, 'supplier_invoice_taken']);

    expect(
      (await ph('post', `purchase-orders/${order.body.id}/cancel`, buyer, { version: 3, reason: 'x' })).body.code,
    ).toBe('purchase_order_state');
    await ph('post', `purchase-orders/${order.body.id}/close`, buyer, {
      version: 3,
      reason: 'Rest not available',
    }).expect(204);
    const late = await ph('post', 'receives', storekeeper, { ...header, supplierInvoiceNo: 'BX-7800', lines });
    expect(late.body.code).toBe('purchase_order_state');

    for (const [key, params] of [
      ['pharmacy.purchase-order', { id: order.body.id }],
      ['pharmacy.receive', { id: receive.body.id }],
      ['pharmacy.stock', { outletId: central }],
    ] as const) {
      for (const format of key === 'pharmacy.stock' ? ['pdf', 'xlsx'] : ['pdf']) {
        await request(http)
          .post(`/api/v1/reports/${key}/render`)
          .set(bearer(admin))
          .send({ format, params })
          .expect(200);
      }
    }
  });

  it('keeps lots by batch, expiry and sale rate; enters opening stock; shows the card and what to reorder', async () => {
    const receive = async (invoice: string, extra: Record<string, unknown>, receivedOn = '2026-03-05') => {
      const draft = await ph('post', 'receives', storekeeper, {
        outletId: central,
        supplierId: supplier,
        receivedOn,
        supplierInvoiceNo: invoice,
        lines: [{ ...napaLine, productId: napa, ...extra }],
      }).expect(201);
      return ph('post', `receives/${draft.body.id}/post`, storekeeper, { version: 1 });
    };
    expect((await receive('A-1', {})).status).toBe(200);
    expect((await receive('A-2', { qty: 100, batchNo: 'b1' })).status).toBe(200);
    expect((await receive('A-3', { qty: 50, saleRate: 1.5 })).status).toBe(200);
    expect((await receive('A-4', { expiryDate: '2026-03-01' })).body.code).toBe('expired_lot');

    const [row] = await stockAt(central);
    // B1 at 1.20 twice (batch case ignored), then B1 at 1.50 is a lot of its own.
    expect(row!.qty).toBe(750);
    expect(row!.lots.map((lot) => [lot.batchNo, lot.saleRate, lot.qty])).toEqual([
      ['B1', 1.2, 700],
      ['B1', 1.5, 50],
    ]);
    expect(row!.saleValue).toBe(915);

    const opening = await ph('post', 'opening-stock', admin, {
      outletId: outdoor,
      openedOn: '2026-01-01',
      lines: [{ productId: napa, qty: 50, unitCost: 0.85, saleRate: 1.2, batchNo: 'B1', expiryDate: '2027-06-30' }],
    }).expect(201);
    expect(opening.body.number).toBe('OP-2026-00001');
    const [outdoorRow] = await stockAt(outdoor);
    expect(outdoorRow).toMatchObject({ qty: 50, value: 42.5 });
    expect(outdoorRow!.lots[0]!.lotId).toBe(row!.lots[0]!.lotId);
    expect(
      (await ph('post', 'opening-stock', storekeeper, { outletId: outdoor, openedOn: '2026-01-01', lines: [] })).status,
    ).toBe(403);

    const card = await ph(
      'get',
      `stock/card?outletId=${central}&productId=${napa}&from=2026-03-01&to=2026-03-31`,
      admin,
    ).expect(200);
    expect(card.body).toMatchObject({ displayName: 'Tab. Napa', opening: 0, totalIn: 750, closing: 750 });
    expect(card.body.rows.map((entry: { kind: string; balance: number }) => [entry.kind, entry.balance])).toEqual([
      ['receive', 600],
      ['receive', 700],
      ['receive', 750],
    ]);

    await create('pharmacy/reorder-levels', { outletId: central, productId: seclo, level: 100 });
    await create('pharmacy/reorder-levels', { outletId: central, productId: napa, level: 100 });
    const reorder = await stockAt(central, '&belowReorderOnly=true');
    expect(reorder.map((entry) => [entry.displayName, entry.qty])).toEqual([['Cap. Seclo', 0]]);
  });
});
