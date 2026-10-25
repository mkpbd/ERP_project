import { describe, expect, it } from 'vitest';
import {
  validLines,
  Voucher,
  voucherNumber,
  voucherTotal,
  type PostableAccount,
  type VoucherLine,
} from '../../../src/modules/accounts/domain/voucher.js';
import { DomainError } from '../../../src/shared/domain/errors.js';

const account = (id: string, overrides: Partial<PostableAccount> = {}): PostableAccount => ({
  id,
  code: id.toUpperCase(),
  isActive: true,
  isControlAccount: false,
  requiresCostCenter: false,
  book: 'main',
  ...overrides,
});
const accounts = new Map(
  [
    account('cash'),
    account('sales'),
    account('old', { isActive: false }),
    account('payable', { isControlAccount: true }),
    account('expense', { requiresCostCenter: true }),
  ].map((entry) => [entry.id, entry]),
);
const chart = { book: 'main' as const, accounts };
const line = (glAccountId: string, debit: number, credit: number, extra: Partial<VoucherLine> = {}): VoucherLine => ({
  glAccountId,
  debit,
  credit,
  narration: null,
  costCenterId: null,
  subLedgerId: null,
  chequeNo: null,
  chequeDate: null,
  ...extra,
});
const now = new Date('2026-04-01T00:00:00Z');
const header = {
  journalTypeId: 'jv',
  voucherDate: '2026-03-31',
  documentDate: null,
  narration: 'Cash sale',
  paidTo: null,
  mode: null,
  serviceUnitId: null,
};

describe('voucher lines (double entry)', () => {
  it('accepts balanced vouchers to the paisa', () => {
    expect(voucherTotal(validLines([line('cash', 1000.1, 0), line('sales', 0, 1000.1)], chart))).toBe(1000.1);
    expect(validLines([line('cash', 0.1, 0), line('cash', 0.2, 0), line('sales', 0, 0.3)], chart)).toHaveLength(3);
  });

  it('refuses unbalanced, one-sided, two-sided and over-precise lines', () => {
    expect(() => validLines([line('cash', 100, 0), line('sales', 0, 99)], chart)).toThrow(/must be equal/);
    expect(() => validLines([line('cash', 100, 0)], chart)).toThrow(/2 to/);
    expect(() => validLines([line('cash', 100, 100), line('sales', 0, 0)], chart)).toThrow(
      /either a debit or a credit/,
    );
    expect(() => validLines([line('cash', 1.005, 0), line('sales', 0, 1.005)], chart)).toThrow(/2 decimals/);
  });

  it('checks the accounts: active, cost centre, sub-ledger on control accounts', () => {
    expect(() => validLines([line('old', 5, 0), line('sales', 0, 5)], chart)).toThrow(/OLD is inactive/);
    expect(() => validLines([line('expense', 5, 0), line('cash', 0, 5)], chart)).toThrow(/cost centre/);
    expect(() => validLines([line('payable', 0, 5), line('cash', 5, 0)], chart)).toThrow(/sub-ledger/);
    expect(() => validLines([line('nowhere', 5, 0), line('cash', 0, 5)], chart)).toThrow(DomainError);
    expect(() => validLines([line('cash', 5, 0), line('sales', 0, 5)], { ...chart, book: 'pf' })).toThrow(
      /belongs to the main book/,
    );
    expect(
      validLines([line('expense', 5, 0, { costCenterId: 'cc' }), line('payable', 0, 5, { subLedgerId: 'aci' })], chart),
    ).toHaveLength(2);
  });
});

describe('voucher lifecycle', () => {
  const draft = () =>
    Voucher.draft({
      id: 'v1',
      header,
      lines: [line('cash', 500, 0), line('sales', 0, 500)],
      chart,
      source: null,
      createdBy: 'u1',
      now,
    });

  it('edits drafts, posts with a number and refuses changes afterwards', () => {
    const voucher = draft();
    voucher.edit({ lines: [line('cash', 600, 0), line('sales', 0, 600)] }, chart, now);
    voucher.post({ number: voucherNumber('jv', '2025-2026', 7), fiscalYearId: 'fy', chart, by: 'u2', now });
    expect(voucher.toSnapshot()).toMatchObject({ status: 'posted', number: 'JV-2025-2026-00007', version: 3 });
    expect(() => voucher.edit({ header: { narration: 'x' } }, chart, now)).toThrow(/posted voucher cannot be edited/);
    expect(() => voucher.assertDeletable()).toThrow(/cannot be deleted/);
  });

  it('reverses a posted voucher with debits and credits swapped, once', () => {
    const voucher = draft();
    voucher.post({ number: 'JV-1', fiscalYearId: 'fy', chart, by: 'u2', now });
    const reversal = voucher.reversal({
      id: 'v2',
      voucherDate: '2026-04-02',
      narration: 'Wrong amount',
      by: 'u2',
      now,
    });
    expect(voucher.status).toBe('reversed');
    expect(reversal.toSnapshot()).toMatchObject({ status: 'draft', reversalOfId: 'v1', number: null });
    expect(reversal.lines.map((entry) => [entry.glAccountId, entry.debit, entry.credit])).toEqual([
      ['cash', 0, 500],
      ['sales', 500, 0],
    ]);
    expect(() => voucher.reversal({ id: 'v3', voucherDate: '2026-04-02', narration: 'Again', by: 'u2', now })).toThrow(
      /reversed voucher cannot be reversed/,
    );
  });

  it('refuses a stale version', () => {
    expect(() => draft().assertVersion(2)).toThrow(/changed by someone else/);
  });
});
