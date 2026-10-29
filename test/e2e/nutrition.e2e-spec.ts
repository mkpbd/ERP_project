import ExcelJS from 'exceljs';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let dietitian: string;
let nurse: string;
let cook: string;
let general: string;
let cabin: string;
let earlyTea: string;
let lunch: string;
let normal: string;
let diabetic: string;
const admitted: Record<string, string> = {};

const PASSWORD = 'quite long passphrase 42';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const dayIn = (date: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
const today = dayIn(new Date());
const later = dayIn(new Date(Date.now() + 2 * 86_400_000));
const midnight = `${today}T00:00:00+06:00`;

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

const nu = (method: 'get' | 'post' | 'put', path: string, token: string, body?: object) => {
  const call = request(http)[method](`/api/v1/nutrition/${path}`).set(bearer(token));
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
  dietitian = await user('dietitian', ['diet:read', 'diet:manage']);
  nurse = await user('nurse', ['diet:read', 'diet:order']);
  cook = await user('cook', ['diet:read', 'diet:serve']);

  const doctor = await create('hospital/doctors', { name: 'Dr. Nusrat Jahan', isConsultant: true });
  const ward = await create('hospital/wards', { name: 'Medicine ward' });
  general = await create('hospital/bed-categories', { name: 'General', admissionFee: 500, dailyRate: 1200 });
  cabin = await create('hospital/bed-categories', { name: 'Cabin', admissionFee: 1000, dailyRate: 4000 });
  for (const [name, sex, mobileNo, code, category] of [
    ['Karim Uddin', 'male', '01711000000', 'G-1', general],
    ['Selim Reza', 'male', '01611000000', 'G-2', general],
    ['Rahima Begum', 'female', '01811000000', 'C-1', cabin],
  ] as const) {
    const patient = await create('hospital/patients', { fullName: name, sex, dateOfBirth: '1980-01-01', mobileNo });
    const bed = await create('hospital/beds', { code, wardId: ward, categoryId: category });
    admitted[name] = await create('hospital/admissions', { patientId: patient, bedId: bed, doctorId: doctor });
  }

  earlyTea = await create('nutrition/meal-types', { name: 'Early tea', servedAt: '00:00' }, dietitian);
  lunch = await create('nutrition/meal-types', { name: 'Lunch', servedAt: '13:00' }, dietitian);
  normal = await create('nutrition/diet-plans', { name: 'Normal' }, dietitian);
  diabetic = await create('nutrition/diet-plans', { name: 'Diabetic', description: 'No sugar' }, dietitian);
});

describe('nutrition', () => {
  it("orders patients' diets, lists a meal for the kitchen and records what was served", async () => {
    // The dietitian's setup: meals per bed category and menus per diet.
    expect((await nu('put', `category-meals/${general}`, nurse, { mealTypeIds: [lunch] })).status).toBe(403);
    await nu('put', `category-meals/${general}`, dietitian, { mealTypeIds: [earlyTea, lunch] }).expect(204);
    await nu('put', `category-meals/${cabin}`, dietitian, { mealTypeIds: [lunch] }).expect(204);
    const twice = await nu('put', `diet-plans/${normal}/menus`, dietitian, {
      menus: [
        { mealTypeId: earlyTea, menu: 'Tea' },
        { mealTypeId: earlyTea, menu: 'Coffee' },
      ],
    });
    expect(twice.body.code).toBe('duplicate_meal');
    await nu('put', `diet-plans/${normal}/menus`, dietitian, {
      menus: [
        { mealTypeId: earlyTea, menu: 'Tea with milk, 2 biscuits' },
        { mealTypeId: lunch, menu: 'Rice, fish curry, dal, vegetables' },
      ],
    }).expect(204);
    await nu('put', `diet-plans/${diabetic}/menus`, dietitian, {
      menus: [{ mealTypeId: lunch, menu: '1 cup rice, fish, vegetables, no sweets' }],
    }).expect(204);
    expect((await nu('get', `diet-plans/${normal}/menus`, cook).expect(200)).body.items).toHaveLength(2);
    const meals = await nu('get', 'category-meals', cook).expect(200);
    expect(meals.body.items.find((entry: { name: string }) => entry.name === 'Cabin').mealTypeIds).toEqual([lunch]);

    // Diets: Karim normal from midnight, then nothing by mouth; Rahima diabetic; Selim has none.
    const karim = admitted['Karim Uddin']!;
    expect((await nu('post', `admissions/${karim}/diet-orders`, cook, { planId: normal })).status).toBe(403);
    const both = await nu('post', `admissions/${karim}/diet-orders`, nurse, { planId: normal, nilByMouth: true });
    expect(both.body.code).toBe('invalid_diet');
    await nu('post', `admissions/${karim}/diet-orders`, nurse, { planId: normal, fromAt: midnight }).expect(201);
    await nu('post', `admissions/${karim}/diet-orders`, nurse, { nilByMouth: true, remarks: 'For surgery' }).expect(
      201,
    );
    const back = await nu('post', `admissions/${karim}/diet-orders`, nurse, { planId: normal, fromAt: midnight });
    expect(back.body.code).toBe('diet_overlap');
    await nu('post', `admissions/${admitted['Rahima Begum']}/diet-orders`, nurse, {
      planId: diabetic,
      remarks: 'Allergic to prawns',
    }).expect(201);
    const history = await nu('get', `admissions/${karim}/diet-orders`, cook).expect(200);
    expect(
      history.body.items.map((entry: { planName: string | null; toAt: string | null }) => [
        entry.planName,
        entry.toAt === null,
      ]),
    ).toEqual([
      [null, true],
      ['Normal', false],
    ]);

    // Early tea of today: General beds only; Karim was on the normal diet at midnight.
    const list = await nu('get', `kitchen?day=${today}&mealTypeId=${earlyTea}`, cook).expect(200);
    expect(
      list.body.rows.map((row: { patientName: string; planName: string | null; state: string }) => [
        row.patientName,
        row.planName,
        row.state,
      ]),
    ).toEqual([
      ['Karim Uddin', 'Normal', 'to_serve'],
      ['Selim Reza', null, 'no_order'],
    ]);
    expect(list.body.rows[0].menu).toBe('Tea with milk, 2 biscuits');
    expect(list.body.totals).toEqual([{ planName: 'Normal', count: 1 }]);

    // The kitchen records what it did.
    const serve = (body: object) =>
      nu('post', 'meal-services', cook, { day: today, mealTypeId: earlyTea, status: 'served', ...body });
    expect(
      (
        await nu('post', 'meal-services', nurse, {
          admissionId: karim,
          day: today,
          mealTypeId: earlyTea,
          status: 'served',
        })
      ).status,
    ).toBe(403);
    await serve({ admissionId: karim }).expect(201);
    expect((await serve({ admissionId: karim })).body.code).toBe('meal_recorded');
    expect((await serve({ admissionId: admitted['Selim Reza'] })).body.code).toBe('nothing_to_serve');
    expect((await serve({ admissionId: admitted['Rahima Begum'] })).body.code).toBe('meal_not_given');
    expect((await serve({ admissionId: admitted['Rahima Begum'], mealTypeId: lunch, day: later })).body.code).toBe(
      'not_yet',
    );
    const after = await nu('get', `kitchen?day=${today}&mealTypeId=${earlyTea}`, cook).expect(200);
    expect(after.body.rows[0]).toMatchObject({
      state: 'served',
      service: expect.objectContaining({ status: 'served' }),
    });

    // Lunch: Karim is nothing by mouth now; Rahima's diabetic menu with her remarks.
    const lunchList = await nu('get', `kitchen?day=${later}&mealTypeId=${lunch}`, cook).expect(200);
    expect(
      lunchList.body.rows.map((row: { bedCode: string; patientName: string; state: string }) => [
        row.bedCode,
        row.patientName,
        row.state,
      ]),
    ).toEqual([
      ['C-1', 'Rahima Begum', 'to_serve'],
      ['G-1', 'Karim Uddin', 'nil_by_mouth'],
      ['G-2', 'Selim Reza', 'no_order'],
    ]);
    expect(lunchList.body.rows[0]).toMatchObject({
      planName: 'Diabetic',
      menu: '1 cup rice, fish, vegetables, no sweets',
      remarks: 'Allergic to prawns',
      bedCategoryName: 'Cabin',
    });
    expect(lunchList.body.totals).toEqual([{ planName: 'Diabetic', count: 1 }]);

    // Stopped: nothing more for Karim.
    await nu('post', `admissions/${karim}/diet-orders/stop`, nurse).expect(204);
    expect((await nu('post', `admissions/${karim}/diet-orders/stop`, nurse)).body.code).toBe('no_diet');

    const sheet = await request(http)
      .post('/api/v1/reports/nutrition.kitchen-list/render')
      .set(bearer(admin))
      .send({ format: 'xlsx', params: { day: later, mealTypeId: lunch } })
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(sheet.body as Buffer).buffer);
    expect(workbook.worksheets[0]!.rowCount).toBeGreaterThan(3);
    const pdf = await request(http)
      .post('/api/v1/reports/nutrition.kitchen-list/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { day: today, mealTypeId: earlyTea } });
    expect(pdf.status).toBe(200);
  });
});
