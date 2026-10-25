import { describe, expect, it } from 'vitest';
import { inventoryVoucherLines } from '../../../src/modules/supply-chain/application/department.handlers.js';
import {
  DepartmentAdjustment,
  DepartmentConsumption,
  DepartmentReturn,
} from '../../../src/modules/supply-chain/domain/department.js';
import { placeOf } from '../../../src/modules/supply-chain/domain/places.js';
import { SupplierReturn } from '../../../src/modules/supply-chain/domain/supplier-return.js';

const now = new Date('2026-05-01T08:00:00Z');

describe('places', () => {
  it('are one main store, sub-store or department', () => {
    expect(placeOf({ departmentId: 'd1' })).toEqual({ departmentId: 'd1' });
    expect(() => placeOf({ mainStoreId: 'm1', departmentId: 'd1' })).toThrow(/Give one/);
    expect(() => placeOf({})).toThrow(/Give one/);
  });
});

describe('department documents', () => {
  it('consumption is cancelled once, with a reason', () => {
    const consumption = DepartmentConsumption.post({
      id: 'c1',
      number: 'DC-2026-00001',
      departmentId: 'd1',
      consumedOn: '2026-05-01',
      note: null,
      lines: [{ variantId: 'v1', qty: 2, lotId: null }],
      createdBy: 'u1',
      now,
    });
    expect(() => consumption.cancel('u1', ' ', now)).toThrow(/Give a reason/);
    consumption.cancel('u1', 'Wrong ward', now);
    expect(() => consumption.cancel('u1', 'again', now)).toThrow(/already cancelled/);
  });

  it('return is received on or after its date, or cancelled while pending', () => {
    const open = () =>
      DepartmentReturn.open({
        id: 'r1',
        number: 'DR-2026-00001',
        departmentId: 'd1',
        subStoreId: 's1',
        returnDate: '2026-05-02',
        reason: 'Unused',
        lines: [{ variantId: 'v1', qty: 1, lotId: null }],
        createdBy: 'u1',
        now,
      });
    const early = open();
    expect(() => early.receive('u2', '2026-05-01', now)).toThrow(/not received before it is sent/);
    early.receive('u2', '2026-05-03', now);
    expect(() => early.cancel(now)).toThrow(/received return cannot be cancelled/);
  });

  it('count is approved by someone else, against the records at approval', () => {
    const count = DepartmentAdjustment.request({
      id: 'a1',
      number: 'DA-2026-00001',
      departmentId: 'd1',
      countedOn: '2026-05-03',
      reason: 'Monthly count',
      lines: [
        { variantId: 'v1', lotId: 'l1', systemQty: 5, physicalQty: 3 },
        { variantId: 'v1', lotId: 'l2', systemQty: 0, physicalQty: 1.5 },
      ],
      createdBy: 'u1',
      now,
    });
    expect(() => count.approve({ by: 'u1', current: new Map(), remarks: null, now })).toThrow(/Someone other/);
    const lines = count.approve({ by: 'u2', current: new Map([['l1', 4]]), remarks: null, now });
    expect(lines.map((line) => line.adjustQty)).toEqual([-1, 1.5]);
    expect(() => count.cancel(now)).toThrow(/approved count cannot be cancelled/);
  });
});

describe('SupplierReturn', () => {
  const draft = () =>
    SupplierReturn.draft({
      id: 'rt1',
      number: 'RT-2026-00001',
      mainStoreId: 'm1',
      supplierId: 's1',
      returnDate: '2026-05-04',
      reason: 'Torn boxes',
      lines: [
        { variantId: 'v1', qty: 4, lotId: null },
        { variantId: 'v2', qty: 2, lotId: null },
      ],
      createdBy: 'u1',
      now,
    });

  it('is sent at the cost of the lots, and settled for what came back', () => {
    const supplierReturn = draft();
    expect(() => supplierReturn.settle({ lines: [], on: '2026-05-05', now })).toThrow(/draft return cannot be settled/);
    supplierReturn.send({ unitCosts: [102.5, 10], voucher: null, gatePassId: 'g1', now });
    expect(supplierReturn.sentValue()).toBe(430);
    expect(() =>
      supplierReturn.settle({
        lines: [{ receivedQty: 4, replacementVariantId: null, batchNo: null, expiryDate: null }],
        on: '2026-05-05',
        now,
      }),
    ).toThrow(/every line/);
    expect(() =>
      supplierReturn.settle({
        lines: [
          { receivedQty: 5, replacementVariantId: null, batchNo: null, expiryDate: null },
          { receivedQty: 0, replacementVariantId: null, batchNo: null, expiryDate: null },
        ],
        on: '2026-05-05',
        now,
      }),
    ).toThrow(/more came back than was sent/);
    const back = supplierReturn.settle({
      lines: [
        { receivedQty: 3, replacementVariantId: 'v9', batchNo: ' N1 ', expiryDate: '2027-01-01' },
        { receivedQty: 0, replacementVariantId: 'v2', batchNo: null, expiryDate: null },
      ],
      on: '2026-05-05',
      now,
    });
    expect(back).toBe(307.5);
    expect(supplierReturn.lines.map((line) => [line.replacementVariantId, line.replacementBatchNo])).toEqual([
      ['v9', 'N1'],
      [null, null],
    ]);
  });

  it('posts goods going back as a credit to inventory against the supplier', () => {
    const lines = inventoryVoucherLines(
      new Map([
        ['v1', 410],
        ['v2', 20],
      ]),
      new Map([
        ['v1', { isActive: true, expiryRequired: false, inventoryGlAccountId: 'gl-1' }],
        ['v2', { isActive: true, expiryRequired: false, inventoryGlAccountId: null }],
      ]),
      { name: 'ACI', isActive: true, glAccountId: 'gl-payable', subLedgerId: 'sl-1' },
      'RT-2026-00001 to ACI',
      'credit',
    );
    expect(lines.map((line) => [line.account, line.debit, line.credit])).toEqual([
      [{ id: 'gl-1' }, 0, 410],
      [{ role: 'store_inventory' }, 0, 20],
      [{ id: 'gl-payable' }, 430, 0],
    ]);
  });
});
