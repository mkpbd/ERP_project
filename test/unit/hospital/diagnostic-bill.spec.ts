import { describe, expect, it } from 'vitest';
import { DiagnosticBill } from '../../../src/modules/hospital/domain/diagnostic-bill.js';

const now = new Date('2026-10-27T04:00:00Z');
const lines = [
  { testId: 'cbc', packageId: null, rate: 400, discountAllowed: true, referralPercent: 20, reportHours: 6 },
  { testId: 'xray', packageId: null, rate: 600, discountAllowed: true, referralPercent: 10, reportHours: 2 },
  { testId: 'tube', packageId: null, rate: 20, discountAllowed: false, referralPercent: 0, reportHours: null },
];

const bill = (overrides: Partial<Parameters<typeof DiagnosticBill.create>[0]> = {}) =>
  DiagnosticBill.create({
    id: 'b',
    number: 'DB-2026-00001',
    patientId: 'p',
    billedOn: '2026-10-27',
    referredById: 'referrer',
    payer: { kind: 'patient' },
    lines,
    discount: 100,
    discountReason: 'Poor',
    discountLimitPercent: 10,
    mayDiscountMore: false,
    payment: { method: 'cash', amount: 500 },
    by: 'cashier',
    now,
    ...overrides,
  });

describe('DiagnosticBill', () => {
  it('shares the discount over the tests that may be discounted and earns the referrer their commission', () => {
    const made = bill();
    expect(made.toSnapshot()).toMatchObject({ gross: 1020, discount: 100, net: 920, paid: 500 });
    expect(made.due).toBe(420);
    expect(made.commission).toBe(140);
    expect(
      made.lines.map((line) => [line.discount, line.referralAmount, line.reportDueAt?.toISOString() ?? null]),
    ).toEqual([
      [40, 80, '2026-10-27T10:00:00.000Z'],
      [60, 60, '2026-10-27T06:00:00.000Z'],
      [0, 0, null],
    ]);
    expect(bill({ referredById: null }).commission).toBe(0);
  });

  it('holds the discount to what may be discounted and the counter to its limit', () => {
    expect(() => bill({ discount: 150 })).toThrow(expect.objectContaining({ code: 'discount_limit' }));
    expect(() => bill({ discount: 1001, mayDiscountMore: true })).toThrow(
      expect.objectContaining({ code: 'invalid_discount' }),
    );
    expect(() => bill({ discountReason: null })).toThrow(expect.objectContaining({ code: 'invalid_discount' }));
    expect(bill({ discount: 1000, mayDiscountMore: true, payment: null }).due).toBe(20);
    expect(() => bill({ lines: [lines[0]!, lines[0]!] })).toThrow(expect.objectContaining({ code: 'duplicate_test' }));
    expect(() => bill({ payment: { method: 'cash', amount: 921 } })).toThrow(
      expect.objectContaining({ code: 'overpayment' }),
    );
    expect(() => bill({ payer: { kind: 'corporate', clientId: 'acme', cash: true } })).toThrow(
      expect.objectContaining({ code: 'payment_needed' }),
    );
  });

  it('cancels tests off the due first and gives back what was paid beyond what is left', () => {
    const made = bill();
    expect(() =>
      made.cancelTests({ lines: [2], reason: 'Machine down', on: '2026-10-28', mayCancelLater: false, now }),
    ).toThrow(expect.objectContaining({ code: 'cancel_later' }));
    // The X-ray was worth 540 after its 60 of the discount: 420 due is cleared and 120 paid back.
    expect(
      made.cancelTests({ lines: [2], reason: 'Machine down', on: '2026-10-27', mayCancelLater: false, now }),
    ).toEqual({ positions: [2], gross: 600, discount: 60, commission: 60, dueCleared: 420, refund: 120 });
    expect([made.due, made.received]).toEqual([0, 380]);
    expect(() =>
      made.cancelTests({ lines: [2], reason: 'Again', on: '2026-10-27', mayCancelLater: true, now }),
    ).toThrow(expect.objectContaining({ code: 'invalid_line' }));
    const rest = made.cancelTests({ lines: null, reason: 'Patient left', on: '2026-10-28', mayCancelLater: true, now });
    expect(rest).toMatchObject({ positions: [1, 3], refund: 380, dueCleared: 0 });
    expect(made.toSnapshot()).toMatchObject({ status: 'cancelled', cancelled: 920, refunded: 500 });
    expect(() => made.collect(10, '2026-10-28', now)).toThrow(expect.objectContaining({ code: 'bill_state' }));
  });

  it('collects dues, never more than due', () => {
    const made = bill();
    expect(() => made.collect(500, '2026-10-27', now)).toThrow(expect.objectContaining({ code: 'overpayment' }));
    made.collect(420, '2026-10-28', now);
    expect(made.due).toBe(0);
    expect(() => made.assertVersion(1)).toThrow(expect.objectContaining({ code: 'stale_bill' }));
  });
});
