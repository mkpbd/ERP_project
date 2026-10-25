import { describe, expect, it } from 'vitest';
import { allocate, type LotBalance } from '../../../src/modules/supply-chain/domain/allocation.js';

const lot = (lotId: string, expiryDate: string | null, qty: number, value: number): LotBalance => ({
  lotId,
  batchNo: lotId.toUpperCase(),
  expiryDate,
  qty,
  value,
});
const lots = [
  lot('later', '2027-12-31', 10, 1000),
  lot('undated', null, 50, 2500),
  lot('expired', '2026-03-01', 5, 500),
  lot('soon', '2026-06-30', 4, 410),
];

describe('allocate', () => {
  it('takes the first expiring lots first, skipping expired ones, at each lot cost', () => {
    expect(allocate({ lots, qty: 6.5, on: '2026-03-10', at: 'Line 1' })).toEqual([
      { lotId: 'soon', qty: 4, unitCost: 102.5 },
      { lotId: 'later', qty: 2.5, unitCost: 100 },
    ]);
    expect(allocate({ lots, qty: 20, on: '2026-03-10', at: 'Line 1' }).map((part) => [part.lotId, part.qty])).toEqual([
      ['soon', 4],
      ['later', 10],
      ['undated', 6],
    ]);
  });

  it('takes from a named lot only, and refuses more than there is', () => {
    expect(allocate({ lots, qty: 3, on: '2026-03-10', lotId: 'later', at: 'Line 2' })).toEqual([
      { lotId: 'later', qty: 3, unitCost: 100 },
    ]);
    expect(() => allocate({ lots, qty: 11, on: '2026-03-10', lotId: 'later', at: 'Line 2' })).toThrow(
      /Line 2: only 10 is in stock in that lot/,
    );
    expect(() => allocate({ lots, qty: 1, on: '2026-03-10', lotId: 'expired', at: 'Line 3' })).toThrow(/only 0/);
    expect(() => allocate({ lots, qty: 64.001, on: '2026-03-10', at: 'Line 4' })).toThrow(/only 64 is in stock/);
  });
});
