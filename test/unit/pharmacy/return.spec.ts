import { describe, expect, it } from 'vitest';
import { assertWithinReturnWindow, validReturnDays } from '../../../src/modules/pharmacy/domain/return-window.js';
import { PharmacySale, type SalePart } from '../../../src/modules/pharmacy/domain/sale.js';

const now = new Date('2026-04-10T08:00:00Z');

describe('return window', () => {
  const week = { isEnabled: true, days: 7 };

  it('counts calendar days inclusively; off or missing is no limit; never before the sale', () => {
    expect(() => assertWithinReturnWindow(week, '2026-04-12', '2026-04-19')).not.toThrow();
    expect(() => assertWithinReturnWindow(week, '2026-04-12', '2026-04-20')).toThrow(/7 days; this sale is 8 days old/);
    expect(() => assertWithinReturnWindow({ isEnabled: true, days: 0 }, '2026-04-12', '2026-04-12')).not.toThrow();
    expect(() => assertWithinReturnWindow({ isEnabled: false, days: 0 }, '2026-01-01', '2026-04-12')).not.toThrow();
    expect(() => assertWithinReturnWindow(null, '2026-01-01', '2026-04-12')).not.toThrow();
    expect(() => assertWithinReturnWindow(null, '2026-04-12', '2026-04-11')).toThrow(/before it was sold/);
    expect(() => validReturnDays(366)).toThrow(/0 to 365/);
  });
});

describe('PharmacySale.giveBack', () => {
  const parts: SalePart[] = [
    { productId: 'napa', lotId: 'b', qty: 10, saleRate: 1.2, unitCost: 0.85, discountPercent: 5 },
    { productId: 'seclo', lotId: 's', qty: 3, saleRate: 6, unitCost: 4, discountPercent: 0 },
  ];
  const make = (tendered: number, loyalMemberId: string | null = null) =>
    PharmacySale.make({
      id: 'x',
      number: 'SI-1',
      outletId: 'o',
      soldOn: '2026-04-10',
      customerName: null,
      mobileNo: null,
      loyalMemberId,
      parts,
      method: 'cash',
      reference: null,
      tendered,
      soldBy: 'u',
      now,
    });

  it('values units at the line total per unit, so the discount comes back with them', () => {
    const sale = make(100);
    // Napa: 12 less 0.60 = 11.40 for 10 units; 3 of them come back.
    const given = sale.giveBack([{ line: 1, qty: 3 }], now);
    expect(given).toMatchObject({
      amount: 3.6,
      discount: 0.18,
      refund: 3.42,
      dueReduced: 0,
      cashRefund: 3.42,
      cost: 2.55,
    });
    expect(sale.lines[0]!.returnedQty).toBe(3);
    // The rest of the line comes back to exactly what is left of its total.
    const rest = sale.giveBack([{ line: 1, qty: 7 }], now);
    expect(rest.refund).toBe(7.98);
    expect(() => sale.giveBack([{ line: 1, qty: 1 }], now)).toThrow(/0 of sale line 1 may still come back/);
  });

  it('adds every return of a line up to its total, whatever the rounding', () => {
    // Napa: 11.40 for 10 units, given back 3 + 3 + 4 (1.14 a unit does not split evenly into paisa per part).
    const sale = make(100);
    const refunds = [3, 3, 4].map((qty) => sale.giveBack([{ line: 1, qty }], now).refund);
    expect(refunds).toEqual([3.42, 3.42, 4.56]);
    expect(Math.round(refunds.reduce((sum, value) => sum + value, 0) * 100) / 100).toBe(11.4);
  });

  it('takes the open due down first and pays the rest back', () => {
    // Total 11.40 + 18 = 29.40; 20 paid, 9.40 due.
    const sale = make(20, 'member');
    const given = sale.giveBack([{ line: 2, qty: 2 }], now);
    expect(given).toMatchObject({ refund: 12, dueReduced: 9.4, cashRefund: 2.6 });
    expect(sale.giveBack([{ line: 2, qty: 1 }], now)).toMatchObject({ dueReduced: 0, cashRefund: 6 });
  });

  it('refuses unknown or repeated lines, and a sale with returns cannot be cancelled', () => {
    const sale = make(100);
    expect(() => sale.giveBack([{ line: 3, qty: 1 }], now)).toThrow(/no line 3/);
    expect(() =>
      sale.giveBack(
        [
          { line: 1, qty: 1 },
          { line: 1, qty: 1 },
        ],
        now,
      ),
    ).toThrow(/already given back here/);
    sale.giveBack([{ line: 1, qty: 1 }], now);
    expect(() => sale.cancel({ reason: 'x', on: '2026-04-10', by: 'u', now })).toThrow(/Medicines were returned/);
  });
});
