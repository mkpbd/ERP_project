import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LedgerPosting } from '../../src/shared/application/contracts/ledger-posting.js';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
let admin: string;
let accountant: string;
let clerk: string;
let ids: Record<'cash' | 'sales' | 'payable' | 'expense' | 'pharmacy' | 'aci' | 'jv' | 'cpv' | 'fy', string>;

const PASSWORD = 'quite long passphrase 42';
const PDF = Buffer.from('%PDF-1.4\n% bill\n');
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const line = (glAccountId: string, debit: number, credit: number, extra: Record<string, unknown> = {}) => ({
  glAccountId,
  debit,
  credit,
  ...extra,
});

async function login(identifier: string, password: string): Promise<string> {
  const response = await request(http)
    .post('/api/v1/auth/login')
    .set('X-Refresh-Token-Delivery', 'body')
    .send({ identifier, password })
    .expect(200);
  return response.body.accessToken as string;
}

async function create(path: string, body: Record<string, unknown>, token = accountant): Promise<string> {
  const response = await request(http).post(`/api/v1/accounts/${path}`).set(bearer(token)).send(body);
  expect(response.status, `${path}: ${JSON.stringify(response.body)}`).toBe(201);
  return response.body.id as string;
}

async function user(name: string, permissions: string[]): Promise<string> {
  const created = await request(http)
    .post('/api/v1/users')
    .set(bearer(admin))
    .send({ email: `${name}@example.com`, password: PASSWORD, displayName: name })
    .expect(201);
  const role = await request(http)
    .post('/api/v1/roles')
    .set(bearer(admin))
    .send({ name: `role-${name}`, permissions })
    .expect(201);
  await request(http)
    .post(`/api/v1/users/${created.body.id}/roles`)
    .set(bearer(admin))
    .send({ roleId: role.body.id })
    .expect(204);
  return login(`${name}@example.com`, PASSWORD);
}

const voucher = (body: Record<string, unknown>, token = accountant) =>
  request(http).post('/api/v1/accounts/vouchers').set(bearer(token)).send(body);

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
  admin = await login(ADMIN.email, ADMIN.password);
  accountant = await user('accountant', ['accounts:read', 'accounts:manage', 'vouchers:write', 'vouchers:post']);
  clerk = await user('clerk', ['accounts:read', 'vouchers:write']);
  const assets = await create('natures', {
    code: '1',
    name: 'Assets',
    statement: 'balance_sheet',
    normalBalance: 'debit',
  });
  const category = await create('categories', { natureId: assets, code: '11', name: 'General' });
  const sub = await create('sub-categories', { categoryId: category, name: 'General' });
  const head4 = await create('level4-heads', { subCategoryId: sub, name: 'General' });
  const head5 = await create('level5-heads', { level4HeadId: head4, name: 'General' });
  const gl = (code: string, name: string, extra: Record<string, unknown> = {}) =>
    create('gl-accounts', { level5HeadId: head5, code, name, ...extra });
  const types = await create('sub-ledger-types', { name: 'Suppliers' });
  ids = {
    cash: await gl('1001', 'Cash in hand', { kind: 'cash' }),
    sales: await gl('4001', 'Sales'),
    payable: await gl('2001', 'Accounts payable', { isControlAccount: true }),
    expense: await gl('5001', 'Office expense', { requiresCostCenter: true }),
    pharmacy: await create('cost-centers', { name: 'Pharmacy' }),
    aci: await create('sub-ledgers', { typeId: types, name: 'ACI Limited' }),
    jv: await create('journal-types', { shortName: 'JV', name: 'Journal voucher' }),
    cpv: await create('journal-types', { shortName: 'CPV', name: 'Cash payment voucher' }),
    fy: await create('fiscal-years', { label: '2025-2026', startsOn: '2025-07-01', endsOn: '2026-06-30' }),
  };
});

describe('vouchers', () => {
  it('enters, posts with numbers, reverses and guards the double entry', async () => {
    const sale = { journalTypeId: ids.jv, voucherDate: '2026-03-31', narration: 'Cash sale' };
    const unbalanced = await voucher({ ...sale, lines: [line(ids.cash, 100, 0), line(ids.sales, 0, 90)] }).expect(422);
    expect(unbalanced.body.code).toBe('unbalanced_voucher');
    const control = await voucher({ ...sale, lines: [line(ids.cash, 10, 0), line(ids.payable, 0, 10)] }).expect(422);
    expect(control.body.detail).toMatch(/2001 is a control account/);
    await voucher({ ...sale, post: true, lines: [line(ids.cash, 1, 0), line(ids.sales, 0, 1)] }, clerk).expect(403);

    const draft = await voucher({ ...sale, lines: [line(ids.cash, 1000, 0), line(ids.sales, 0, 1000)] }, clerk).expect(
      201,
    );
    expect(draft.body.number).toBeNull();
    const id = draft.body.id as string;
    await request(http)
      .patch(`/api/v1/accounts/vouchers/${id}`)
      .set(bearer(clerk))
      .send({ version: 1, lines: [line(ids.cash, 1200, 0), line(ids.sales, 0, 1200)] })
      .expect(204);
    const stale = await request(http)
      .post(`/api/v1/accounts/vouchers/${id}/post`)
      .set(bearer(accountant))
      .send({ version: 1 })
      .expect(409);
    expect(stale.body.code).toBe('stale_voucher');
    await request(http)
      .post(`/api/v1/accounts/vouchers/${id}/post`)
      .set(bearer(clerk))
      .send({ version: 2 })
      .expect(403);
    await request(http)
      .post(`/api/v1/accounts/vouchers/${id}/post`)
      .set(bearer(accountant))
      .send({ version: 2 })
      .expect(200, { number: 'JV-2025-2026-00001' });

    const second = await voucher({
      ...sale,
      post: true,
      lines: [
        line(ids.expense, 300, 0, { costCenterId: ids.pharmacy }),
        line(ids.payable, 0, 300, { subLedgerId: ids.aci }),
      ],
    }).expect(201);
    expect(second.body.number).toBe('JV-2025-2026-00002');
    const payment = await voucher({
      journalTypeId: ids.cpv,
      voucherDate: '2026-04-01',
      paidTo: 'ACI Limited',
      post: true,
      lines: [line(ids.payable, 300, 0, { subLedgerId: ids.aci }), line(ids.cash, 0, 300, { chequeNo: '000123' })],
    }).expect(201);
    expect(payment.body.number).toBe('CPV-2025-2026-00001');

    const outside = await voucher({
      ...sale,
      voucherDate: '2027-01-01',
      post: true,
      lines: [line(ids.cash, 1, 0), line(ids.sales, 0, 1)],
    }).expect(422);
    expect(outside.body.code).toBe('no_fiscal_year');
    await request(http)
      .patch(`/api/v1/accounts/fiscal-years/${ids.fy}`)
      .set(bearer(accountant))
      .send({ isClosed: true })
      .expect(200);
    const closed = await voucher({ ...sale, post: true, lines: [line(ids.cash, 1, 0), line(ids.sales, 0, 1)] }).expect(
      422,
    );
    expect(closed.body.code).toBe('fiscal_year_closed');
    await request(http)
      .patch(`/api/v1/accounts/fiscal-years/${ids.fy}`)
      .set(bearer(accountant))
      .send({ isClosed: false })
      .expect(200);

    const locked = await request(http)
      .patch(`/api/v1/accounts/vouchers/${id}`)
      .set(bearer(accountant))
      .send({ version: 3, narration: 'Changed' })
      .expect(422);
    expect(locked.body.code).toBe('voucher_state');
    const reversal = await request(http)
      .post(`/api/v1/accounts/vouchers/${id}/reverse`)
      .set(bearer(accountant))
      .send({ version: 3, voucherDate: '2026-04-02' })
      .expect(200);
    expect(reversal.body.number).toBe('JV-2025-2026-00003');
    const original = await request(http).get(`/api/v1/accounts/vouchers/${id}`).set(bearer(clerk)).expect(200);
    expect(original.body).toMatchObject({ status: 'reversed', reversedById: reversal.body.id, total: 1200 });
    const reversed = await request(http)
      .get(`/api/v1/accounts/vouchers/${reversal.body.id}`)
      .set(bearer(clerk))
      .expect(200);
    expect(reversed.body).toMatchObject({ reversalOfId: id, narration: 'Reversal of JV-2025-2026-00001' });
    expect(
      reversed.body.lines.map((entry: { glCode: string; debit: number; credit: number }) => [
        entry.glCode,
        entry.debit,
        entry.credit,
      ]),
    ).toEqual([
      ['1001', 0, 1200],
      ['4001', 1200, 0],
    ]);
    await request(http)
      .post(`/api/v1/accounts/vouchers/${id}/reverse`)
      .set(bearer(accountant))
      .send({ version: 4, voucherDate: '2026-04-02' })
      .expect(422);

    const scrap = await voucher({ ...sale, lines: [line(ids.cash, 5, 0), line(ids.sales, 0, 5)] }, clerk).expect(201);
    await request(http).delete(`/api/v1/accounts/vouchers/${scrap.body.id}?version=1`).set(bearer(clerk)).expect(204);
    await request(http).delete(`/api/v1/accounts/vouchers/${second.body.id}?version=2`).set(bearer(clerk)).expect(422);

    const attached = await request(http)
      .post(`/api/v1/accounts/vouchers/${payment.body.id}/attachments?fileName=bill.pdf`)
      .set(bearer(clerk))
      .set('Content-Type', 'application/pdf')
      .send(PDF)
      .expect(201);
    const withFile = await request(http)
      .get(`/api/v1/accounts/vouchers/${payment.body.id}`)
      .set(bearer(clerk))
      .expect(200);
    expect(withFile.body.attachments).toEqual([
      expect.objectContaining({ fileName: 'bill.pdf', sizeBytes: PDF.length }),
    ]);
    await request(http)
      .delete(`/api/v1/accounts/vouchers/${payment.body.id}/attachments/${attached.body.id}`)
      .set(bearer(clerk))
      .expect(204);

    const posted = await request(http).get('/api/v1/accounts/vouchers?status=posted').set(bearer(clerk)).expect(200);
    expect(posted.body.items.map((item: { number: string }) => item.number).sort()).toEqual([
      'CPV-2025-2026-00001',
      'JV-2025-2026-00002',
      'JV-2025-2026-00003',
    ]);
    const byAccount = await request(http)
      .get(`/api/v1/accounts/vouchers?glAccountId=${ids.expense}`)
      .set(bearer(clerk))
      .expect(200);
    expect(byAccount.body.total).toBe(1);

    const print = await request(http)
      .post('/api/v1/reports/accounts.voucher/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { voucherId: payment.body.id } });
    expect(print.status).toBe(200);
  });

  it('lets other modules post through LedgerPosting by GL role or code', async () => {
    await create('journal-types', { shortName: 'SV', name: 'Sales voucher' });
    await create('gl-roles', { role: 'cash_in_hand', glAccountId: ids.cash });
    const posting = t.app.get(LedgerPosting);
    const result = await posting.post({
      journal: 'sv',
      voucherDate: '2026-03-15',
      narration: 'Pharmacy sales, 15 March',
      source: { module: 'pharmacy', reference: 'INV-1001' },
      lines: [
        { account: { role: 'cash_in_hand' }, debit: 750, credit: 0 },
        { account: { code: '4001' }, debit: 0, credit: 750 },
      ],
      postedBy: null,
    });
    expect(result.number).toBe('SV-2025-2026-00001');
    await expect(
      posting.post({
        journal: 'SV',
        voucherDate: '2026-03-15',
        narration: null,
        source: { module: 'pharmacy', reference: 'INV-1002' },
        lines: [
          { account: { role: 'nowhere' }, debit: 1, credit: 0 },
          { account: { code: '4001' }, debit: 0, credit: 1 },
        ],
        postedBy: null,
      }),
    ).rejects.toThrow(/unknown GL role nowhere/);
    const fromPharmacy = await request(http)
      .get('/api/v1/accounts/vouchers?sourceModule=pharmacy&sourceReference=INV-1001')
      .set(bearer(accountant))
      .expect(200);
    expect(fromPharmacy.body.items).toEqual([
      expect.objectContaining({ id: result.voucherId, status: 'posted', total: 750 }),
    ]);
  });
});
