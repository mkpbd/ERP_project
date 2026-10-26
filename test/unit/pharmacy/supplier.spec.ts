import { describe, expect, it } from 'vitest';
import { allocatePayment, type ReceiveDue } from '../../../src/modules/pharmacy/domain/supplier-payment.js';
import { SupplierReturn } from '../../../src/modules/pharmacy/domain/supplier-return.js';

const now = new Date('2026-03-25T08:00:00Z');

describe('allocatePayment', () => {
  const dues = new Map<string, ReceiveDue>([
    ['r1', { supplierId: 's', number: 'GR-1', total: 540, paid: 300 }],
    ['r2', { supplierId: 's', number: 'GR-2', total: 900.1, paid: 0 }],
    ['r3', { supplierId: 'other', number: 'GR-3', total: 10, paid: 0 }],
  ]);

  it('pays up to what is due on each receive and adds up to the paisa', () => {
    expect(
      allocatePayment(
        's',
        [
          { receiveId: 'r1', amount: 240 },
          { receiveId: 'r2', amount: 0.1 },
        ],
        dues,
      ),
    ).toEqual({
      allocations: [
        { receiveId: 'r1', dueBefore: 240, amount: 240 },
        { receiveId: 'r2', dueBefore: 900.1, amount: 0.1 },
      ],
      total: 240.1,
    });
  });

  it('refuses overpayment, another supplier, unposted receives, duplicates and zero', () => {
    expect(() => allocatePayment('s', [{ receiveId: 'r1', amount: 240.01 }], dues)).toThrow(/only 240.00 is due/);
    expect(() => allocatePayment('s', [{ receiveId: 'r3', amount: 1 }], dues)).toThrow(/another supplier/);
    expect(() => allocatePayment('s', [{ receiveId: 'r9', amount: 1 }], dues)).toThrow(/not posted/);
    expect(() =>
      allocatePayment(
        's',
        [
          { receiveId: 'r1', amount: 1 },
          { receiveId: 'r1', amount: 1 },
        ],
        dues,
      ),
    ).toThrow(/already paid here/);
    expect(() => allocatePayment('s', [{ receiveId: 'r1', amount: 0 }], dues)).toThrow(/more than 0/);
    expect(() => allocatePayment('s', [], dues)).toThrow(/1 to 300/);
  });
});

describe('SupplierReturn', () => {
  const draft = () =>
    SupplierReturn.draft({
      id: 'rt',
      number: 'RT-2026-00001',
      outletId: 'o',
      supplierId: 's',
      returnDate: '2026-03-25',
      reason: 'Short expiry',
      lines: [
        { productId: 'a', lotId: 'l1', qty: 100 },
        { productId: 'b', lotId: 'l2', qty: 3 },
      ],
      createdBy: 'u',
      now,
    });

  it('is valued at lot cost when sent and settled up to that value', () => {
    const supplierReturn = draft();
    expect(() => supplierReturn.settle(1, '2026-03-26', now)).toThrow(/draft return takes no replacement/);
    expect(
      supplierReturn.send(
        new Map([
          ['l1', 0.9],
          ['l2', 0.3333],
        ]),
        'JV-1',
        now,
      ),
    ).toBe(91);
    expect(supplierReturn.lines.map((line) => line.value)).toEqual([90, 1]);
    expect(() => supplierReturn.settle(10, '2026-03-24', now)).toThrow(/before it was returned/);
    supplierReturn.settle(45, '2026-04-02', now);
    expect(supplierReturn.status).toBe('partly_settled');
    expect(() => supplierReturn.settle(46.01, '2026-04-02', now)).toThrow(/Only 46.00 is still owed/);
    supplierReturn.settle(46, '2026-04-03', now);
    expect(supplierReturn.status).toBe('settled');
    expect(() => supplierReturn.close('x', now)).toThrow(/Only a sent or partly settled/);
  });

  it('is edited only as a draft, one line per lot, and closed with a reason', () => {
    expect(() =>
      SupplierReturn.draft({
        id: 'x',
        number: 'x',
        outletId: 'o',
        supplierId: 's',
        returnDate: '2026-03-25',
        reason: ' ',
        lines: [{ productId: 'a', lotId: 'l1', qty: 1 }],
        createdBy: 'u',
        now,
      }),
    ).toThrow(/Give the reason/);
    const supplierReturn = draft();
    expect(() =>
      supplierReturn.edit(
        {
          lines: [
            { productId: 'a', lotId: 'l1', qty: 1 },
            { productId: 'a', lotId: 'l1', qty: 2 },
          ],
        },
        now,
      ),
    ).toThrow(/already on the return/);
    supplierReturn.send(new Map([['l1', 1]]), null, now);
    expect(() => supplierReturn.edit({ reason: 'x' }, now)).toThrow(/sent return cannot be edited/);
    expect(() => supplierReturn.close('', now)).toThrow(/Give the reason/);
    expect(supplierReturn.status).toBe('sent');
    supplierReturn.close('Supplier will set it off', now);
    expect(supplierReturn.status).toBe('closed');
  });
});
