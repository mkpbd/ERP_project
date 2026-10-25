import { describe, expect, it } from 'vitest';
import { purchaseVoucherLines } from '../../../src/modules/supply-chain/application/stock.handlers.js';
import { PurchaseOrder } from '../../../src/modules/supply-chain/domain/purchase-order.js';
import type { CatalogueVariant } from '../../../src/modules/supply-chain/domain/repositories.js';
import {
  receiveLineAmounts,
  StockReceive,
  type ReceiveLineInput,
} from '../../../src/modules/supply-chain/domain/stock-receive.js';

const now = new Date('2026-03-10T09:00:00Z');
const line = (variantId: string, extra: Partial<ReceiveLineInput> = {}): ReceiveLineInput => ({
  variantId,
  qty: 10,
  rate: 12.35,
  discountPercent: 0,
  vatPercent: 0,
  aitPercent: 0,
  batchNo: null,
  expiryDate: null,
  warrantyNote: null,
  ...extra,
});
const receive = (lines: ReceiveLineInput[]) =>
  StockReceive.draft({
    id: 'r1',
    number: 'SR-2026-00001',
    header: {
      mainStoreId: 'm1',
      supplierId: 's1',
      purchaseOrderId: null,
      receivedOn: '2026-03-10',
      supplierInvoiceNo: ' INV-9 ',
      supplierInvoiceDate: null,
      challanNo: '',
      remarks: null,
    },
    lines,
    createdBy: 'u1',
    now,
  });
const active: CatalogueVariant = { isActive: true, expiryRequired: false, inventoryGlAccountId: null };

describe('stock receive', () => {
  it('takes discount, VAT and AIT as shares of rate times quantity, to the paisa', () => {
    expect(receiveLineAmounts({ qty: 3, rate: 333.33, discountPercent: 5, vatPercent: 7.5, aitPercent: 2 })).toEqual({
      amount: 999.99,
      discount: 50,
      vat: 75,
      ait: 20,
      total: 1044.99,
    });
    const draft = receive([line('v1', { discountPercent: 10 }), line('v2', { qty: 2.5, rate: 100, vatPercent: 5 })]);
    expect(draft.toSnapshot()).toMatchObject({
      amount: 373.5,
      discount: 12.35,
      vat: 12.5,
      total: 373.65,
      supplierInvoiceNo: 'INV-9',
      challanNo: null,
    });
  });

  it('allows an item twice only in different lots', () => {
    receive([line('v1', { batchNo: 'A' }), line('v1', { batchNo: 'B' })]);
    expect(() => receive([line('v1', { batchNo: 'a' }), line('v1', { batchNo: 'A ' })])).toThrow(/same item, batch/);
  });

  it('checks items, expiry and status when posting', () => {
    const draft = receive([line('v1', { expiryDate: '2026-03-10' })]);
    expect(() => draft.checkPostable(new Map([['v1', { ...active, isActive: false }]]))).toThrow(/inactive/);
    expect(() => draft.checkPostable(new Map([['v1', active]]))).toThrow(/expired by the receive date/);
    const needsExpiry = receive([line('v1')]);
    expect(() => needsExpiry.checkPostable(new Map([['v1', { ...active, expiryRequired: true }]]))).toThrow(
      /needs an expiry date/,
    );
    needsExpiry.post({ variants: new Map([['v1', active]]), voucher: { id: 'x', number: 'JV-1' }, by: 'u1', now });
    expect(needsExpiry.toSnapshot()).toMatchObject({ status: 'posted', voucherNumber: 'JV-1', version: 2 });
    expect(() => needsExpiry.edit({ header: { remarks: 'late' } }, now)).toThrow(/posted receive cannot be edited/);
  });

  it('adds up quantities per item for the order', () => {
    expect(
      receive([line('v1', { batchNo: 'A', qty: 2 }), line('v1', { batchNo: 'B', qty: 3.5 })]).quantities(),
    ).toEqual(new Map([['v1', 5.5]]));
  });

  it('debits inventory by item type and credits the supplier on their sub-ledger', () => {
    const draft = receive([line('v1'), line('v2'), line('v3', { rate: 0 })]);
    const lines = purchaseVoucherLines(
      draft,
      new Map([
        ['v1', { ...active, inventoryGlAccountId: 'gl-consumable' }],
        ['v2', active],
        ['v3', active],
      ]),
      { name: 'ACI', isActive: true, glAccountId: null, subLedgerId: 'sl-aci' },
    );
    expect(lines).toEqual([
      { account: { id: 'gl-consumable' }, debit: 123.5, credit: 0, narration: 'SR-2026-00001 from ACI' },
      { account: { role: 'store_inventory' }, debit: 123.5, credit: 0, narration: 'SR-2026-00001 from ACI' },
      {
        account: { role: 'supplier_payable' },
        debit: 0,
        credit: 247,
        narration: 'SR-2026-00001 from ACI',
        subLedgerId: 'sl-aci',
      },
    ]);
  });
});

describe('purchase order receipts', () => {
  const order = () =>
    PurchaseOrder.open({
      id: 'o1',
      number: 'PO-2026-00001',
      header: {
        supplierId: 's1',
        mainStoreId: 'm1',
        requisitionId: null,
        comparativeStudyId: null,
        orderDate: '2026-03-01',
        expectedOn: null,
        terms: null,
        note: null,
      },
      lines: [
        { variantId: 'v1', qty: 10, rate: 5, vatPercent: 0 },
        { variantId: 'v2', qty: 4, rate: 5, vatPercent: 0 },
      ],
      allowance: null,
      createdBy: 'u1',
      now,
    });

  it('takes partial receipts up to the ordered quantity', () => {
    const po = order();
    po.receive(new Map([['v1', 6]]), now);
    expect(po.status).toBe('partially_received');
    expect(() => po.receive(new Map([['v1', 4.001]]), now)).toThrow(/only 4 is still to be received/);
    expect(() => po.receive(new Map([['v9', 1]]), now)).toThrow(/not on the purchase order/);
    expect(() => po.cancel('x', now)).toThrow(/cannot be cancelled/);
    po.receive(
      new Map([
        ['v1', 4],
        ['v2', 4],
      ]),
      now,
    );
    expect(po.status).toBe('received');
    expect(() => po.receive(new Map([['v1', 1]]), now)).toThrow(/received order cannot be received/);
  });

  it('can be closed short once partly received', () => {
    const po = order();
    expect(() => po.close('Supplier stopped', now)).toThrow(/Only a partly received order/);
    po.receive(new Map([['v2', 1]]), now);
    po.close('Supplier stopped', now);
    expect(po.toSnapshot()).toMatchObject({ status: 'closed', cancelReason: 'Supplier stopped' });
  });
});
