import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let nurse: string;
let pharmacist: string;
let cashier: string;
let indoor: string;
let napa: string;
let ceftron: string;
let admission: string;
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

const ph = (method: 'get' | 'post' | 'put', path: string, token: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/pharmacy/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const hs = (method: 'get' | 'post', path: string, token: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/hospital/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const stockOf = async (productId: string) =>
  ((await ph('get', `stock?outletId=${indoor}&productId=${productId}`, admin).expect(200)).body.items[0]?.qty as
    number | undefined) ?? 0;

async function sheet(key: string, params: Record<string, unknown>): Promise<unknown[][]> {
  const result = await request(http)
    .post(`/api/v1/reports/${key}/render`)
    .set(bearer(admin))
    .send({ format: 'xlsx', params })
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    })
    .expect(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Uint8Array.from(result.body as Buffer).buffer);
  const rows = (workbook.worksheets[0]!.getSheetValues() as unknown[][]).filter(Boolean).map((row) =>
    Array.from(row)
      .slice(1)
      .map((value) => value ?? null),
  );
  return rows.slice(rows.findIndex((row) => row[0] === 'Date') + 1);
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
  nurse = (await user('nurse', ['pharmacy:ward', 'ipd:read'])).token;
  const chemist = await user('pharmacist', ['pharmacy:read', 'pharmacy:sell']);
  pharmacist = chemist.token;
  cashier = (await user('cashier', ['ipd:read', 'ipd:admit', 'ipd:bill'])).token;

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, role] of [
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['inventory', '1', 'debit', '1350', 'Medicine inventory', 'pharmacy_inventory'],
    ['unbilled', '1', 'debit', '1240', 'Medicine charged to stays', 'ipd_medicine_unbilled'],
    ['sales', '4', 'credit', '4101', 'Medicine sales', 'pharmacy_sales'],
    ['admission', '4', 'credit', '4301', 'Admission fees', 'ipd_admission_income'],
    ['discount', '5', 'debit', '5102', 'Sales discount', 'pharmacy_sales_discount'],
    ['cogs', '5', 'debit', '5101', 'Cost of medicines sold', 'pharmacy_cogs'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role, glAccountId: gl[key] });
  }

  // The pharmacy: an indoor outlet with Napa and Ceftron, 10 % off indoors.
  const maker = await create('pharmacy/manufacturers', { name: 'Beximco' });
  const tablet = await create('pharmacy/formations', { name: 'Tablet', shortName: 'Tab.' });
  const injection = await create('pharmacy/formations', { name: 'Injection', shortName: 'Inj.' });
  napa = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Napa', manufacturerId: maker }),
    genericId: await create('pharmacy/generics', { name: 'Paracetamol' }),
    formationId: tablet,
  });
  ceftron = await create('pharmacy/products', {
    brandId: await create('pharmacy/brands', { name: 'Ceftron', manufacturerId: maker }),
    genericId: await create('pharmacy/generics', { name: 'Ceftriaxone' }),
    formationId: injection,
  });
  await ph('put', 'discount-policy', admin, { allowedByDefault: true, opdPercent: 5, ipdPercent: 10 }).expect(204);
  indoor = await create('pharmacy/outlets', { name: 'Indoor pharmacy' });
  await create('pharmacy/outlet-users', { outletId: indoor, userId: chemist.id });
  await create('pharmacy/opening-stock', {
    outletId: indoor,
    openedOn: today,
    lines: [
      { productId: napa, qty: 100, unitCost: 0.8, saleRate: 1.2, batchNo: 'N1', expiryDate: `${year + 1}-12-31` },
      { productId: ceftron, qty: 10, unitCost: 180, saleRate: 250, batchNo: 'C1', expiryDate: `${year + 1}-12-31` },
    ],
  });

  // The hospital: Rahima admitted to a ward bed.
  const doctor = await create('hospital/doctors', { name: 'Dr. Nusrat Jahan', isConsultant: true });
  const ward = await create('hospital/wards', { name: 'Medicine ward' });
  const general = await create('hospital/bed-categories', { name: 'General', admissionFee: 500, dailyRate: 1200 });
  const bed = await create('hospital/beds', { code: 'W-1', wardId: ward, categoryId: general });
  const patient = (
    await hs('post', 'patients', admin, {
      fullName: 'Rahima Begum',
      sex: 'female',
      dateOfBirth: '1990-01-01',
      mobileNo: '01811000000',
    }).expect(201)
  ).body.id as string;
  admission = (
    await hs('post', 'admissions', cashier, { patientId: patient, bedId: bed, doctorId: doctor }).expect(201)
  ).body.id as string;
});

describe('ward medicine', () => {
  it('sends medicine asked for by the ward, takes unused medicine back and puts the rest on the indoor bill', async () => {
    const indent = {
      outletId: indoor,
      admissionId: admission,
      requestedOn: today,
      lines: [
        { productId: napa, qty: 10 },
        { productId: ceftron, qty: 3 },
      ],
    };
    expect((await ph('post', 'ward-indents', pharmacist, indent)).status).toBe(403);
    const asked = await ph('post', 'ward-indents', nurse, indent).expect(201);
    expect(asked.body.number).toBe(`WN-${year}-00001`);
    const early = await ph('post', 'ward-indents', nurse, { ...indent, requestedOn: '2020-01-01' });
    expect(early.body.code).toBe('invalid_date');
    expect((await hs('get', `admissions/${admission}/account`, cashier).expect(200)).body.openIndents).toBe(1);
    const listed = await ph('get', `ward-indents?admissionId=${admission}`, nurse).expect(200);
    expect(listed.body.items[0]).toMatchObject({ patientName: 'Rahima Begum', status: 'open', lineCount: 2 });

    // Sent as asked: 10 × 1.20 and 3 × 250, 10 % off indoors.
    expect((await ph('post', 'ward-issues', nurse, { ...indent, issuedOn: today })).status).toBe(403);
    const sent = await ph('post', 'ward-issues', pharmacist, {
      outletId: indoor,
      admissionId: admission,
      indentId: asked.body.id,
      issuedOn: today,
      lines: indent.lines,
    }).expect(201);
    expect(sent.body).toMatchObject({ number: `WI-${year}-00001`, total: 685.8 });
    expect((await ph('get', `ward-indents/${asked.body.id}`, nurse).expect(200)).body).toMatchObject({
      status: 'issued',
      issueId: sent.body.id,
    });
    expect([await stockOf(napa), await stockOf(ceftron)]).toEqual([90, 7]);

    // Another indent the pharmacy cannot answer: cancelled with a reason by the outlet.
    const second = await ph('post', 'ward-indents', nurse, { ...indent, lines: [{ productId: napa, qty: 500 }] });
    const short = await ph('post', 'ward-issues', pharmacist, {
      outletId: indoor,
      admissionId: admission,
      indentId: second.body.id,
      issuedOn: today,
      lines: [{ productId: napa, qty: 500 }],
    });
    expect(short.body.code).toBe('insufficient_stock');
    await ph('post', `ward-indents/${second.body.id}/cancel`, pharmacist, {
      version: 1,
      reason: 'Out of stock',
    }).expect(204);

    // One vial back unused: restocked, taken off at what it was charged.
    const tooMany = await ph('post', `ward-issues/${sent.body.id}/returns`, pharmacist, {
      version: 1,
      returnedOn: today,
      lines: [{ line: 2, qty: 4 }],
    });
    expect(tooMany.body.code).toBe('over_return');
    const back = await ph('post', `ward-issues/${sent.body.id}/returns`, pharmacist, {
      version: 1,
      returnedOn: today,
      reason: 'Switched to oral',
      lines: [{ line: 2, qty: 1 }],
    }).expect(201);
    expect(back.body).toMatchObject({ number: `WR-${year}-00001`, total: 225, charged: 460.8 });
    expect(await stockOf(ceftron)).toBe(8);

    const account = await hs('get', `admissions/${admission}/account`, cashier).expect(200);
    expect(account.body).toMatchObject({ openIndents: 0, total: 960.8 });
    expect(account.body.lines.map((line: { head: string; amount: number }) => [line.head, line.amount])).toEqual([
      ['admission', 500],
      ['medicine', 460.8],
    ]);

    // The final bill takes the medicine; nothing more is sent or taken back until it is cancelled.
    await hs('post', `admissions/${admission}/final-bill`, cashier, { payment: { amount: 960.8 } }).expect(201);
    const late = await ph('post', 'ward-issues', pharmacist, {
      outletId: indoor,
      admissionId: admission,
      indentId: null,
      issuedOn: today,
      lines: [{ productId: napa, qty: 2 }],
    });
    expect([late.status, late.body.code]).toEqual([409, 'bill_made']);
    const lateBack = await ph('post', `ward-issues/${sent.body.id}/returns`, pharmacist, {
      version: 2,
      returnedOn: today,
      lines: [{ line: 1, qty: 1 }],
    });
    expect(lateBack.body.code).toBe('bill_made');
    expect((await ph('post', 'ward-indents', nurse, indent)).body.code).toBe('bill_made');
    await hs('post', `admissions/${admission}/discharge`, cashier, { version: 1 }).expect(204);

    // Books: the stay's medicine is cleared by the bill; sales, discount and cost net of the return.
    expect([
      await closing('unbilled'),
      await closing('sales'),
      await closing('discount'),
      await closing('cogs'),
    ]).toEqual([0, -512, 51.2, 368]);
    expect(await closing('cash')).toBe(960.8);

    const statement = await sheet('pharmacy.ward-medicine', { admissionId: admission });
    expect(statement.map((row) => [row[2], row[4], row[5], row[7]])).toEqual([
      ['Sent', 'Tab. Napa', 10, 10.8],
      ['Sent', 'Inj. Ceftron', 3, 675],
      ['Returned', 'Inj. Ceftron', -1, -225],
    ]);
    for (const [key, params] of [
      ['pharmacy.ward-medicine', { admissionId: admission }],
      ['hospital.ipd-bill', { admissionId: admission }],
    ] as const) {
      const pdf = await request(http)
        .post(`/api/v1/reports/${key}/render`)
        .set(bearer(admin))
        .send({ format: 'pdf', params });
      expect(pdf.status, key).toBe(200);
    }
  });
});
