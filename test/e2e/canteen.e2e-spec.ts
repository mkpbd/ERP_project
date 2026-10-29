import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let manager: string;
let seller: string;
let stranger: string;
let canteenStore: string;
let juiceBottle: string;
let outlet: string;
let tea: string;
let juice: string;
let member: string;
const gl: Record<string, string> = {};

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

const closing = async (account: string) =>
  (
    await request(http)
      .get(`/api/v1/accounts/books/ledger?glAccountId=${gl[account]}&from=${today}&to=${today}`)
      .set(bearer(admin))
      .expect(200)
  ).body.closing as number;
const held = async () =>
  ((
    await request(http)
      .get(`/api/v1/scm/stock?departmentId=${canteenStore}&variantId=${juiceBottle}`)
      .set(bearer(admin))
      .expect(200)
  ).body.items[0]?.qty as number | undefined) ?? 0;
const ct = (method: 'get' | 'post' | 'put', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/canteen/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  manager = (await user('manager', ['canteen:read', 'canteen:manage'])).token;
  const counter = await user('seller', ['canteen:read', 'canteen:sell']);
  seller = counter.token;
  stranger = (await user('stranger', ['canteen:read', 'canteen:sell'])).token;
  const keeper = await user('keeper', ['scm:read', 'scm:issue']);

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, role] of [
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['store', '1', 'debit', '1300', 'Store inventory', 'store_inventory'],
    ['receivable', '1', 'debit', '1280', 'Canteen member dues', 'canteen_member_receivable'],
    ['vat', '2', 'credit', '2201', 'VAT payable', 'canteen_vat_payable'],
    ['sales', '4', 'credit', '4601', 'Canteen sales', 'canteen_sales'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role, glAccountId: gl[key] });
  }

  // The canteen's store department holds three bottles of juice.
  const main = await create('scm/main-stores', { name: 'Central store' });
  const sub = await create('scm/sub-stores', { mainStoreId: main, name: 'Food store' });
  canteenStore = await create('scm/departments', { name: 'Canteen' });
  await create('scm/issue-store-users', { subStoreId: sub, userId: keeper.id });
  const group = await create('scm/item-groups', { name: 'Food' });
  const subGroup = await create('scm/item-sub-groups', { groupId: group, name: 'Drinks' });
  const category = await create('scm/item-categories', { name: 'Consumables' });
  const subCategory = await create('scm/item-sub-categories', { categoryId: category, name: 'Food' });
  const juiceItem = await create('scm/items', {
    name: 'Mango juice',
    subGroupId: subGroup,
    subCategoryId: subCategory,
    unit: 'Bottle',
  });
  juiceBottle = await create('scm/item-variants', { itemId: juiceItem, name: '250 ml' });
  await create('scm/opening-stock', {
    subStoreId: sub,
    openedOn: today,
    lines: [{ variantId: juiceBottle, qty: 5, unitCost: 30 }],
  });
  await create(
    'scm/store-issues',
    { subStoreId: sub, departmentId: canteenStore, issueDate: today, lines: [{ variantId: juiceBottle, qty: 3 }] },
    keeper.token,
  );

  // The menu, the outlet and who sells there, a member.
  const drinks = await create('canteen/groups', { name: 'Drinks' }, manager);
  expect((await ct('post', 'groups', seller, { name: 'Snacks' })).status).toBe(403);
  tea = await create(
    'canteen/items',
    { code: 'T1', name: 'Tea', groupId: drinks, unit: 'cup', rate: 20, staffRate: 15 },
    manager,
  );
  const ghost = await ct('post', 'items', manager, {
    name: 'Cola',
    groupId: drinks,
    unit: 'can',
    rate: 40,
    staffRate: 40,
    stockVariantId: '00000000-0000-4000-8000-000000000000',
  });
  expect(ghost.body.code).toBe('store_item_not_found');
  juice = await create(
    'canteen/items',
    {
      code: 'J1',
      name: 'Mango juice',
      groupId: drinks,
      unit: 'bottle',
      rate: 50,
      staffRate: 45,
      vatPercent: 5,
      stockVariantId: juiceBottle,
    },
    manager,
  );
  outlet = await create('canteen/outlets', { name: 'Main canteen', storeDepartmentId: canteenStore }, manager);
  await ct('put', `outlets/${outlet}/users`, manager, { userIds: [counter.id] }).expect(204);
  member = await create('canteen/members', { name: 'Selim Reza', mobileNo: '01711000000' }, manager);
});

describe('canteen', () => {
  it('sells at the counter and to members, uses packaged goods from the store, takes dues and cancels', async () => {
    const sale = {
      outletId: outlet,
      lines: [
        { itemId: tea, qty: 2 },
        { itemId: juice, qty: 2 },
      ],
    };
    expect((await ct('post', 'sales', stranger, { ...sale, paid: 200 })).body.code).toBe('not_your_outlet');

    // A walk-in: 2 teas and 2 juices (5 % VAT on the juice), 5 off, 200 given.
    const walkIn = await ct('post', 'sales', seller, { ...sale, discount: 5, paid: 200 }).expect(201);
    expect(walkIn.body).toMatchObject({ number: `CS-${year}-00001`, net: 140, due: 0, change: 60, stock: 'used' });
    expect(await held()).toBe(1);
    expect((await ct('post', 'sales', seller, { ...sale, paid: 100 })).body.code).toBe('due_not_allowed');

    // A member eats on credit; the store has too little juice, the sale stands, marked short.
    const onCredit = await ct('post', 'sales', seller, {
      outletId: outlet,
      customerKind: 'member',
      memberId: member,
      lines: [{ itemId: juice, qty: 2 }],
      paid: 0,
    }).expect(201);
    expect(onCredit.body).toMatchObject({ net: 105, due: 105, stock: 'short' });
    expect(await held()).toBe(1);
    const view = await ct('get', `sales/${onCredit.body.id}`, manager).expect(200);
    expect(view.body).toMatchObject({ customerName: 'Selim Reza', memberName: 'Selim Reza', stockShort: true, vat: 5 });
    expect(view.body.lines).toEqual([
      expect.objectContaining({ itemName: 'Mango juice', qty: 2, rate: 50, amount: 100, vat: 5 }),
    ]);

    // His dues: never more than he owes; then his sale is not cancelled.
    expect((await ct('post', `members/${member}/collections`, seller, { amount: 200 })).body.code).toBe(
      'over_collection',
    );
    const paid = await ct('post', `members/${member}/collections`, seller, { amount: 100 }).expect(201);
    expect(paid.body).toMatchObject({ number: `CC-${year}-00001`, balance: 5 });
    const statement = await ct('get', `members/${member}/statement`, manager).expect(200);
    expect(
      statement.body.entries.map((entry: { kind: string; balance: number }) => [entry.kind, entry.balance]),
    ).toEqual([
      ['sale', 105],
      ['collection', 5],
    ]);
    const tooLate = await ct('post', `sales/${onCredit.body.id}/cancel`, seller, {
      version: 1,
      reason: 'Wrong member',
    });
    expect(tooLate.body.code).toBe('due_collected');

    // The walk-in sale taken back the same day.
    expect((await ct('post', `sales/${walkIn.body.id}/cancel`, stranger, { version: 1, reason: 'x' })).body.code).toBe(
      'not_your_outlet',
    );
    await ct('post', `sales/${walkIn.body.id}/cancel`, seller, { version: 1, reason: 'Customer changed mind' }).expect(
      204,
    );
    expect(
      (await ct('post', `sales/${walkIn.body.id}/cancel`, seller, { version: 2, reason: 'Again' })).body.code,
    ).toBe('sale_state');
    const cancelled = await ct('get', `sales?status=cancelled`, manager).expect(200);
    expect(cancelled.body.items.map((entry: { number: string }) => entry.number)).toEqual([`CS-${year}-00001`]);

    // Books: what is left is the member's sale and his payment.
    expect([await closing('cash'), await closing('receivable'), await closing('sales'), await closing('vat')]).toEqual([
      100, 5, -100, -5,
    ]);

    const sheet = await request(http)
      .post('/api/v1/reports/canteen.item-sales/render')
      .set(bearer(admin))
      .send({ format: 'xlsx', params: { from: today, to: today } })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(sheet.body as Buffer).buffer);
    const rows = (workbook.worksheets[0]!.getSheetValues() as unknown[][])
      .filter(Boolean)
      .map((row) => Array.from(row).slice(1));
    const body = rows.slice(rows.findIndex((row) => row[0] === 'Group') + 1);
    expect(body.map((row) => [row[1], row[2], row[3]])).toEqual([['Mango juice', 2, 100]]);
    for (const [key, params] of [
      ['canteen.receipt', { saleId: onCredit.body.id }],
      ['canteen.member-dues', {}],
    ] as const) {
      const pdf = await request(http)
        .post(`/api/v1/reports/${key}/render`)
        .set(bearer(admin))
        .send({ format: 'pdf', params });
      expect(pdf.status, key).toBe(200);
    }
  });
});
