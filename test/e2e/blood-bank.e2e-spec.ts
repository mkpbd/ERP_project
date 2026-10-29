import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let collector: string;
let nurse: string;
let issuer: string;
let cashier: string;
let packed: string;
let plasma: string;
let patient: string;
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

async function user(name: string, permissions: string[]): Promise<string> {
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
  return login(`${name}@example.com`, PASSWORD);
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

const bb = (method: 'get' | 'post', path: string, token: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/blood-bank/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};
const hs = (method: 'get' | 'post', path: string, token: string, body?: Record<string, unknown>) => {
  const call = request(http)[method](`/api/v1/hospital/${path}`).set(bearer(token));
  return body ? call.send(body) : call;
};

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
  return rows.slice(rows.findIndex((row) => row[0] === 'Component') + 1);
}

const clear = { hiv: 'negative', hbsag: 'negative', hcv: 'negative', syphilis: 'negative', malaria: 'negative' };

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  collector = await user('collector', ['bb:read', 'bb:collect']);
  nurse = await user('nurse', ['bb:read', 'bb:request']);
  issuer = await user('issuer', ['bb:read', 'bb:issue']);
  cashier = await user('cashier', ['ipd:read', 'ipd:admit', 'ipd:bill']);

  await create('accounts/fiscal-years', {
    label: `${fiscal}-${fiscal + 1}`,
    startsOn: `${fiscal}-07-01`,
    endsOn: `${fiscal + 1}-06-30`,
  });
  await create('accounts/journal-types', { shortName: 'JV', name: 'Journal' });
  for (const [key, nature, balance, code, name, role] of [
    ['cash', '1', 'debit', '1001', 'Cash in hand', 'cash_in_hand'],
    ['unbilled', '1', 'debit', '1270', 'Blood charged to stays', 'ipd_blood_unbilled'],
    ['blood', '4', 'credit', '4501', 'Blood bank income', 'blood_bank_income'],
    ['admission', '4', 'credit', '4301', 'Admission fees', 'ipd_admission_income'],
  ] as const) {
    gl[key] = await glAccount(nature, balance, code, name);
    await create('accounts/gl-roles', { role, glAccountId: gl[key] });
  }

  packed = await create('blood-bank/component-types', {
    name: 'Packed red cells',
    code: 'PC',
    shelfDays: 35,
    compatibility: 'red_cells',
    rate: 1500,
  });
  plasma = await create('blood-bank/component-types', {
    name: 'Fresh frozen plasma',
    code: 'FFP',
    shelfDays: 365,
    compatibility: 'plasma',
    rate: 1000,
  });

  // Karim, B+, admitted to a ward bed.
  const doctor = await create('hospital/doctors', { name: 'Dr. Nusrat Jahan', isConsultant: true });
  const ward = await create('hospital/wards', { name: 'Surgery ward' });
  const general = await create('hospital/bed-categories', { name: 'General', admissionFee: 500, dailyRate: 1200 });
  const bed = await create('hospital/beds', { code: 'S-1', wardId: ward, categoryId: general });
  patient = (
    await hs('post', 'patients', admin, {
      fullName: 'Karim Uddin',
      sex: 'male',
      dateOfBirth: '1980-05-05',
      mobileNo: '01711000000',
      bloodGroup: 'B+',
    }).expect(201)
  ).body.id as string;
  admission = (
    await hs('post', 'admissions', cashier, { patientId: patient, bedId: bed, doctorId: doctor }).expect(201)
  ).body.id as string;
});

describe('blood bank', () => {
  it('collects, screens and splits donations, then cross-matches and issues a unit charged to the stay', async () => {
    // Donors: one gives a clean bag, the other a reactive one.
    const donor = (
      await bb('post', 'donors', collector, {
        fullName: 'Rafiq Islam',
        sex: 'male',
        dateOfBirth: '1995-02-01',
        bloodGroup: 'O+',
      }).expect(201)
    ).body;
    expect(donor.number).toBe(`DN-${year}-00001`);
    const young = await bb('post', 'donors', collector, {
      fullName: 'Tanim',
      sex: 'male',
      dateOfBirth: `${year - 16}-01-01`,
      bloodGroup: 'A+',
    }).expect(201);
    expect((await bb('post', 'donations', collector, { donorId: young.body.id, volumeMl: 450 })).body.code).toBe(
      'donor_age',
    );
    expect((await bb('post', 'donations', nurse, { donorId: donor.id, volumeMl: 450 })).status).toBe(403);
    const bag = await bb('post', 'donations', collector, { donorId: donor.id, volumeMl: 450 }).expect(201);
    expect(bag.body.bagNumber).toBe(`BB-${year}-00001`);
    const again = await bb('post', 'donations', collector, { donorId: donor.id, volumeMl: 450 });
    expect(again.body.code).toBe('donor_deferred');

    // Split into packed cells and plasma, in quarantine until screened clear.
    const split = await bb('post', `donations/${bag.body.id}/components`, collector, {
      componentTypeIds: [packed, plasma],
    }).expect(201);
    expect(split.body.units.map((unit: { unitNumber: string }) => unit.unitNumber)).toEqual([
      `BB-${year}-00001/PC`,
      `BB-${year}-00001/FFP`,
    ]);
    const [cells, ffp] = split.body.units.map((unit: { id: string }) => unit.id) as [string, string];
    const twice = await bb('post', `donations/${bag.body.id}/components`, collector, { componentTypeIds: [packed] });
    expect(twice.body.code).toBe('already_prepared');
    expect((await bb('get', 'units?status=quarantine', collector).expect(200)).body.items).toHaveLength(2);
    expect(
      (await bb('post', `donations/${bag.body.id}/screening`, collector, { version: 1, ...clear }).expect(200)).body,
    ).toEqual({ status: 'screened', units: 2 });
    const donation = await bb('get', `donations/${bag.body.id}`, collector).expect(200);
    expect(donation.body).toMatchObject({ status: 'screened', bloodGroup: 'O+', screens: clear });
    expect(donation.body.units.map((unit: { status: string }) => unit.status)).toEqual(['available', 'available']);

    const other = await create(
      'blood-bank/donors',
      { fullName: 'Selim', sex: 'male', dateOfBirth: '1990-01-01', bloodGroup: 'B+' },
      collector,
    );
    const bad = await bb('post', 'donations', collector, { donorId: other, volumeMl: 350 }).expect(201);
    await bb('post', `donations/${bad.body.id}/components`, collector, { componentTypeIds: [packed] }).expect(201);
    expect(
      (
        await bb('post', `donations/${bad.body.id}/screening`, collector, {
          version: 1,
          ...clear,
          hbsag: 'positive',
        }).expect(200)
      ).body,
    ).toEqual({ status: 'discarded', units: 1 });
    const donors = await bb('get', 'donors?bloodGroup=B%2B', collector).expect(200);
    expect(donors.body.items[0]).toMatchObject({ fullName: 'Selim', deferredUntil: '9999-12-31' });
    expect((await bb('get', 'units?status=discarded', collector).expect(200)).body.items).toHaveLength(1);

    // Karim needs a unit of packed cells: the O+ plasma does not fit him, the O+ cells do.
    const ask = { patientId: patient, admissionId: admission, componentTypeId: packed, units: 1 };
    expect((await bb('post', 'requests', issuer, ask)).status).toBe(403);
    const both = await bb('post', 'requests', nurse, { ...ask, billNumber: 'DB-1' });
    expect(both.body.code).toBe('invalid_payer');
    const asked = await bb('post', 'requests', nurse, { ...ask, reason: 'Hb 6.2 before surgery' }).expect(201);
    expect(asked.body.number).toBe(`BR-${year}-00001`);
    const wrong = await bb('post', `requests/${asked.body.id}/crossmatch`, issuer, {
      unitId: ffp,
      result: 'compatible',
    });
    expect(wrong.body.code).toBe('wrong_component');
    expect((await bb('post', `requests/${asked.body.id}/issue`, issuer, { unitId: cells })).body.code).toBe(
      'not_crossmatched',
    );
    await bb('post', `requests/${asked.body.id}/crossmatch`, issuer, {
      unitId: cells,
      result: 'compatible',
      method: 'Saline + AHG',
    }).expect(200);
    const given = await bb('post', `requests/${asked.body.id}/issue`, issuer, { unitId: cells }).expect(201);
    expect(given.body).toMatchObject({ number: `BI-${year}-00001`, amount: 1500, status: 'fulfilled' });
    const view = await bb('get', `requests/${asked.body.id}`, nurse).expect(200);
    expect(view.body).toMatchObject({
      status: 'fulfilled',
      issued: 1,
      bloodGroup: 'B+',
      reason: 'Hb 6.2 before surgery',
    });
    expect(view.body.crossmatches[0]).toMatchObject({ result: 'compatible', method: 'Saline + AHG' });

    // Plasma asked for too: O plasma is not given to a B patient; the request is cancelled.
    const fresh = await bb('post', 'requests', nurse, { ...ask, componentTypeId: plasma }).expect(201);
    const misfit = await bb('post', `requests/${fresh.body.id}/crossmatch`, issuer, {
      unitId: ffp,
      result: 'compatible',
    });
    expect(misfit.body.code).toBe('incompatible_group');
    expect((await bb('post', `requests/${fresh.body.id}/cancel`, nurse, { version: 1 }).expect(200)).body).toEqual({
      released: 0,
    });

    // The stay carries the blood; the final bill clears it.
    const account = await hs('get', `admissions/${admission}/account`, cashier).expect(200);
    expect(account.body.lines.map((line: { head: string; amount: number }) => [line.head, line.amount])).toEqual([
      ['admission', 500],
      ['blood', 1500],
    ]);
    await hs('post', `admissions/${admission}/final-bill`, cashier, { payment: { amount: 2000 } }).expect(201);
    expect([await closing('unbilled'), await closing('blood'), await closing('cash')]).toEqual([0, -1500, 2000]);

    const stock = await sheet('blood-bank.stock', {});
    expect(stock.map((row) => row.slice(0, 7))).toEqual([['Fresh frozen plasma', 'O+', 0, 1, 0, 0, 0]]);
    for (const [key, params] of [
      ['blood-bank.stock', {}],
      ['blood-bank.issue-slip', { issueId: given.body.id }],
      ['hospital.ipd-bill', { admissionId: admission }],
    ] as const) {
      const pdf = await request(http)
        .post(`/api/v1/reports/${key}/render`)
        .set(bearer(admin))
        .send({ format: 'pdf', params });
      expect(pdf.status, key).toBe(200);
    }

    // A unit no longer fit for use is thrown away with a reason.
    expect((await bb('post', `units/${ffp}/discard`, collector, { version: 2, reason: 'Bag leaked' })).status).toBe(
      403,
    );
    await bb('post', `units/${ffp}/discard`, admin, { version: 2, reason: 'Bag leaked' }).expect(204);
    expect((await bb('get', 'units?status=available', collector).expect(200)).body.items).toHaveLength(0);
  });

  it("needs the patient's blood group, and an admission of the same patient", async () => {
    const unknown = (
      await hs('post', 'patients', admin, {
        fullName: 'Ayesha',
        sex: 'female',
        dateOfBirth: '1992-01-01',
        mobileNo: '01911000000',
      }).expect(201)
    ).body.id as string;
    const ask = { admissionId: admission, componentTypeId: packed, units: 1 };
    expect((await bb('post', 'requests', nurse, { ...ask, patientId: unknown })).body.code).toBe('blood_group_unknown');
    const typed = (
      await hs('post', 'patients', admin, {
        fullName: 'Babul',
        sex: 'male',
        dateOfBirth: '1970-01-01',
        mobileNo: '01611000000',
        bloodGroup: 'A-',
      }).expect(201)
    ).body.id as string;
    expect((await bb('post', 'requests', nurse, { ...ask, patientId: typed })).body.code).toBe('admission_mismatch');
  });
});
