import { describe, expect, it } from 'vitest';
import { PharmacyOrder } from '../../../src/modules/pharmacy/domain/purchase-order.js';
import { PharmacyReceive, receiveLineAmounts } from '../../../src/modules/pharmacy/domain/receive.js';

const now = new Date('2026-03-01T08:00:00Z');
const header = { supplierId: 's', outletId: 'o', orderDate: '2026-03-01', note: null };

describe('PharmacyOrder', () => {
  const open = () =>
    PharmacyOrder.open({
      id: 'po',
      number: 'PO-2026-00001',
      header,
      lines: [
        { productId: 'a', qty: 100 },
        { productId: 'b', qty: 10 },
      ],
      createdBy: 'u',
      now,
    });

  it('takes receives up to what was ordered, then is received or closed', () => {
    const order = open();
    expect(() => order.receive(new Map([['c', 1]]), now)).toThrow(/not on the purchase order/);
    order.receive(new Map([['a', 60]]), now);
    expect(order.status).toBe('partly_received');
    expect(() => order.receive(new Map([['a', 41]]), now)).toThrow(/40 to come/);
    expect(() => order.edit({ header: { note: 'x' } }, now)).toThrow(/cannot be edited/);
    expect(() => order.cancel('x', now)).toThrow(/cannot be cancelled/);
    order.receive(
      new Map([
        ['a', 40],
        ['b', 10],
      ]),
      now,
    );
    expect(order.status).toBe('received');
    expect(() => order.close('x', now)).toThrow(/Only a partly received/);
  });

  it('is cancelled or edited only while nothing came, in whole units, one line per product', () => {
    const order = open();
    order.edit({ lines: [{ productId: 'a', qty: 5 }] }, now);
    expect(order.lines).toEqual([{ productId: 'a', qty: 5, receivedQty: 0 }]);
    expect(() => order.cancel('  ', now)).toThrow(/Give a reason/);
    order.cancel('Supplier out of stock', now);
    expect(order.status).toBe('cancelled');
    expect(() =>
      PharmacyOrder.open({ id: 'x', number: 'x', header, lines: [{ productId: 'a', qty: 1.5 }], createdBy: 'u', now }),
    ).toThrow(/whole number/);
    expect(() =>
      PharmacyOrder.open({
        id: 'x',
        number: 'x',
        header,
        lines: [
          { productId: 'a', qty: 1 },
          { productId: 'a', qty: 2 },
        ],
        createdBy: 'u',
        now,
      }),
    ).toThrow(/already ordered/);
  });
});

describe('PharmacyReceive', () => {
  const line = {
    productId: 'a',
    qty: 600,
    bonusQty: 0,
    purchaseRate: 0.9,
    saleRate: 1.2,
    discountPercent: 5,
    vatPercent: 0,
    batchNo: ' B1 ',
    expiryDate: '2027-06-30',
  };
  const draft = (lines = [line]) =>
    PharmacyReceive.draft({
      id: 'r',
      number: 'GR-2026-00001',
      header: {
        outletId: 'o',
        supplierId: 's',
        purchaseOrderId: null,
        receivedOn: '2026-03-05',
        supplierInvoiceNo: null,
        supplierInvoiceDate: null,
        challanNo: null,
        remarks: null,
      },
      lines,
      createdBy: 'u',
      now,
    });

  it('works out discount and VAT to the paisa, with rates to four decimals', () => {
    expect(receiveLineAmounts({ qty: 3, purchaseRate: 0.8547, discountPercent: 0, vatPercent: 7.5 })).toEqual({
      amount: 2.56,
      discount: 0,
      vat: 0.19,
      total: 2.75,
    });
    const receive = draft();
    expect(receive.lines[0]).toMatchObject({ batchNo: 'B1', amount: 540, discount: 27, total: 513 });
    expect(receive.total).toBe(513);
  });

  it('refuses the same lot twice, fractions and expired lots, and changes nothing once posted', () => {
    expect(() => draft([line, { ...line, batchNo: 'b1' }])).toThrow(/already on it/);
    // Another sale rate is another lot.
    expect(draft([line, { ...line, saleRate: 1.5 }]).lines).toHaveLength(2);
    expect(() => draft([{ ...line, qty: 2.5 }])).toThrow(/whole number/);
    expect(() => draft([{ ...line, bonusQty: -1 }])).toThrow(/\(bonus\): the quantity must be a whole number from 0/);
    // Bonus units change nothing that is owed.
    expect(draft([{ ...line, bonusQty: 60 }]).total).toBe(513);
    expect(() => draft([{ ...line, purchaseRate: 0.12345 }])).toThrow(/4 decimals/);

    const expired = draft([{ ...line, expiryDate: '2026-03-05' }]);
    expect(() => expired.post({ products: new Map([['a', { isActive: true }]]), voucher: null, by: 'u', now })).toThrow(
      /expired by the receive date/,
    );
    const receive = draft();
    expect(() =>
      receive.post({ products: new Map([['a', { isActive: false }]]), voucher: null, by: 'u', now }),
    ).toThrow(/inactive/);
    receive.post({
      products: new Map([['a', { isActive: true }]]),
      voucher: { id: 'v', number: 'JV-1' },
      by: 'u',
      now,
    });
    expect(receive.status).toBe('posted');
    expect(() => receive.edit({ header: { remarks: 'x' } }, now)).toThrow(/cannot be edited/);
    expect(() => receive.assertDeletable()).toThrow(/cannot be deleted/);
  });
});
