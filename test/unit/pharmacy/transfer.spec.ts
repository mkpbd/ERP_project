import { describe, expect, it } from 'vitest';
import { allocate, type LotBalance } from '../../../src/modules/pharmacy/domain/allocation.js';
import { OutletIndent } from '../../../src/modules/pharmacy/domain/outlet-indent.js';
import { OutletTransfer } from '../../../src/modules/pharmacy/domain/transfer.js';

const now = new Date('2026-04-10T08:00:00Z');
const lot = (lotId: string, expiryDate: string, qty: number, value: number): LotBalance => ({
  lotId,
  batchNo: lotId.toUpperCase(),
  expiryDate,
  saleRate: 1.2,
  qty,
  value,
});

describe('allocate', () => {
  const lots = [lot('c', '2027-06-30', 200, 180), lot('a', '2026-03-31', 50, 40), lot('b', '2026-12-31', 100, 85)];

  it('takes first expiring first, skips expired lots and carries each lot cost', () => {
    expect(allocate({ lots, qty: 150, on: '2026-04-10', at: 'Line 1' })).toEqual([
      { lotId: 'b', qty: 100, unitCost: 0.85, saleRate: 1.2 },
      { lotId: 'c', qty: 50, unitCost: 0.9, saleRate: 1.2 },
    ]);
    expect(allocate({ lots, qty: 5, on: '2026-04-10', lotId: 'c', at: 'Line 1' })).toEqual([
      { lotId: 'c', qty: 5, unitCost: 0.9, saleRate: 1.2 },
    ]);
  });

  it('refuses more than the unexpired stock, and an expired lot named', () => {
    expect(() => allocate({ lots, qty: 301, on: '2026-04-10', at: 'Line 2' })).toThrow(
      /Line 2: only 300 in stock \(expired lots left out\)/,
    );
    expect(() => allocate({ lots, qty: 1, on: '2026-04-10', lotId: 'a', at: 'Line 1' })).toThrow(
      /only 0 in stock in that lot/,
    );
  });
});

describe('OutletIndent', () => {
  const raise = () =>
    OutletIndent.raise({
      id: 'i',
      number: 'OI-2026-00001',
      requestingOutletId: 'outdoor',
      supplyingOutletId: 'central',
      indentDate: '2026-04-09',
      urgent: false,
      note: null,
      lines: [
        { productId: 'a', qty: 250 },
        { productId: 'b', qty: 10 },
      ],
      createdBy: 'u',
      now,
    });

  it('takes transfers up to what was asked for and gives back what was rejected', () => {
    const indent = raise();
    indent.transfer(new Map([['a', 150]]), now);
    expect(indent.status).toBe('partly_transferred');
    expect(() => indent.transfer(new Map([['a', 101]]), now)).toThrow(/100 left/);
    expect(() => indent.transfer(new Map([['x', 1]]), now)).toThrow(/not on the indent/);
    indent.untransfer(new Map([['a', 150]]), now);
    expect(indent.status).toBe('open');
    indent.transfer(
      new Map([
        ['a', 250],
        ['b', 10],
      ]),
      now,
    );
    expect(indent.status).toBe('transferred');
    expect(() => indent.close('x', now)).toThrow(/Only a partly transferred/);
  });

  it('is edited or cancelled only while nothing was sent, never from itself', () => {
    const indent = raise();
    indent.edit({ urgent: true, lines: [{ productId: 'a', qty: 5 }] }, now);
    expect(indent.lines).toEqual([{ productId: 'a', qty: 5, transferredQty: 0 }]);
    indent.transfer(new Map([['a', 1]]), now);
    expect(() => indent.cancel('x', now)).toThrow(/cannot be cancelled/);
    expect(() =>
      OutletIndent.raise({
        id: 'x',
        number: 'x',
        requestingOutletId: 'o',
        supplyingOutletId: 'o',
        indentDate: '2026-04-09',
        urgent: false,
        note: null,
        lines: [{ productId: 'a', qty: 1 }],
        createdBy: 'u',
        now,
      }),
    ).toThrow(/does not indent from itself/);
  });
});

describe('OutletTransfer', () => {
  const send = () =>
    OutletTransfer.send({
      id: 't',
      number: 'TT-2026-00001',
      indentId: null,
      fromOutletId: 'central',
      toOutletId: 'outdoor',
      transferDate: '2026-04-10',
      note: null,
      lines: [
        { productId: 'a', lotId: 'b', qty: 100, unitCost: 0.85 },
        { productId: 'a', lotId: 'c', qty: 50, unitCost: 0.9 },
      ],
      createdBy: 'u',
      now,
    });

  it('is accepted or rejected once, not before it was sent, a rejection with a reason', () => {
    expect(send().quantities()).toEqual(new Map([['a', 150]]));
    const transfer = send();
    expect(() => transfer.accept({ on: '2026-04-09', by: 'u', now })).toThrow(/before it was sent/);
    expect(() => transfer.reject({ on: '2026-04-10', by: 'u', reason: ' ', now })).toThrow(/Give a reason/);
    transfer.accept({ on: '2026-04-11', by: 'u', now });
    expect(transfer.status).toBe('accepted');
    expect(() => transfer.reject({ on: '2026-04-11', by: 'u', reason: 'x', now })).toThrow(/decided already/);
  });
});
