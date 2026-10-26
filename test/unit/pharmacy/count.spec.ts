import { describe, expect, it } from 'vitest';
import { StockCount } from '../../../src/modules/pharmacy/domain/stock-count.js';

const now = new Date('2026-04-30T18:00:00Z');
const open = () =>
  StockCount.open({
    id: 'c',
    number: 'SC-2026-00001',
    outletId: 'o',
    countDate: '2026-04-30',
    note: null,
    lots: [
      { productId: 'napa', lotId: 'b', qty: 100, unitCost: 0.85 },
      { productId: 'napa', lotId: 'a', qty: 50, unitCost: 0.8 },
    ],
    createdBy: 'counter',
    now,
  });

describe('StockCount', () => {
  it('applies against the ledger as of the count date then, not the figures it was opened with', () => {
    const count = open();
    count.record(
      [
        { lotId: 'b', qty: 95 },
        { lotId: 'a', qty: 0, note: 'Expired, binned' },
      ],
      now,
    );
    count.addLot({ productId: 'napa', lotId: 'c', systemQty: 0, unitCost: 0.9, countedQty: 10 }, now);
    // Three units of lot b were sold, dated before the count, after it was opened.
    const result = count.apply({
      balances: new Map([
        ['b', 97],
        ['a', 50],
      ]),
      by: 'manager',
      now,
    });
    expect(result.adjustments).toEqual([
      { productId: 'napa', lotId: 'b', qty: -2, unitCost: 0.85 },
      { productId: 'napa', lotId: 'a', qty: -50, unitCost: 0.8 },
      { productId: 'napa', lotId: 'c', qty: 10, unitCost: 0.9 },
    ]);
    expect([result.shortage, result.excess]).toEqual([41.7, 9]);
    expect(count.lines.map((line) => [line.appliedSystemQty, line.adjustedQty])).toEqual([
      [97, -2],
      [50, -50],
      [0, 10],
    ]);
    expect(count.lines[1]!.note).toBe('Expired, binned');
    expect(count.status).toBe('applied');
  });

  it('is applied only when every lot is counted, by someone else than who opened it, and once', () => {
    const count = open();
    count.record([{ lotId: 'b', qty: 100 }], now);
    expect(() => count.apply({ balances: new Map(), by: 'manager', now })).toThrow(/1 lots are not counted yet/);
    count.record([{ lotId: 'a', qty: 50 }], now);
    expect(() => count.apply({ balances: new Map(), by: 'counter', now })).toThrow(/other than who opened/);
    const result = count.apply({
      balances: new Map([
        ['b', 100],
        ['a', 50],
      ]),
      by: 'manager',
      now,
    });
    expect(result.adjustments).toEqual([]);
    expect(() => count.record([{ lotId: 'b', qty: 1 }], now)).toThrow(/applied count cannot be counted/);
  });

  it('refuses counts of lots it does not list, fractions, a lot twice, and cancels with a reason', () => {
    const count = open();
    expect(() => count.record([{ lotId: 'x', qty: 1 }], now)).toThrow(/not on the count/);
    expect(() => count.record([{ lotId: 'b', qty: 1.5 }], now)).toThrow(/whole number/);
    expect(() =>
      count.addLot({ productId: 'napa', lotId: 'b', systemQty: 0, unitCost: 1, countedQty: 1 }, now),
    ).toThrow(/already on the count/);
    expect(() => count.cancel(' ', now)).toThrow(/Give a reason/);
    count.cancel('Wrong date', now);
    expect(count.status).toBe('cancelled');
  });
});
