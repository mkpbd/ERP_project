import { describe, expect, it } from 'vitest';
import { ComparativeStudy, quoteAmounts } from '../../../src/modules/supply-chain/domain/comparative-study.js';
import { documentNumber, nextLevel, type ApprovalLevel } from '../../../src/modules/supply-chain/domain/documents.js';
import { orderTotals, PurchaseOrder } from '../../../src/modules/supply-chain/domain/purchase-order.js';
import { PurchaseRequisition } from '../../../src/modules/supply-chain/domain/requisition.js';

const now = new Date('2026-03-01T10:00:00Z');
const levels: ApprovalLevel[] = [
  { order: 2, name: 'Director', isFinal: false },
  { order: 1, name: 'Store manager', isFinal: false },
];

const requisition = () =>
  PurchaseRequisition.draft({
    id: 'r1',
    number: 'PR-2026-00001',
    header: {
      mainStoreId: 'm1',
      subStoreId: null,
      departmentId: null,
      supplierId: null,
      requisitionDate: '2026-03-01',
      paymentTerm: 'credit',
      note: null,
      terms: null,
    },
    lines: [
      { variantId: 'v1', requestedQty: 10, approvedQty: null, description: null },
      { variantId: 'v2', requestedQty: 2.5, approvedQty: null, description: 'Urgent' },
    ],
    createdBy: 'u0',
    now,
  });

describe('documents', () => {
  it('numbers documents per kind and year', () => {
    expect(documentNumber('PR', 2026, 7)).toBe('PR-2026-00007');
  });

  it('moves to the next level in order, and stops at a final one', () => {
    expect(nextLevel(levels, levels[1]!)?.name).toBe('Director');
    expect(nextLevel(levels, levels[0]!)).toBeNull();
    expect(nextLevel(levels, { ...levels[1]!, isFinal: true })).toBeNull();
  });
});

describe('PurchaseRequisition', () => {
  it('is approved level by level, each approver may lower quantities', () => {
    const pr = requisition();
    pr.submit(levels, now);
    expect(pr.toSnapshot()).toMatchObject({ status: 'pending', currentLevel: 1 });
    pr.approve({ level: levels[1]!, levels, quantities: new Map([['v1', 8]]), by: 'u1', remarks: null, now });
    expect(pr.toSnapshot()).toMatchObject({ status: 'pending', currentLevel: 2 });
    expect(pr.lines.map((line) => line.approvedQty)).toEqual([8, 2.5]);
    expect(() =>
      pr.approve({ level: levels[1]!, levels, quantities: new Map(), by: 'u1', remarks: null, now }),
    ).toThrow(/another approval level/);
    expect(() =>
      pr.approve({ level: levels[0]!, levels, quantities: new Map([['v1', 11]]), by: 'u2', remarks: null, now }),
    ).toThrow(/more than requested/);
    pr.approve({ level: levels[0]!, levels, quantities: new Map([['v2', 0]]), by: 'u2', remarks: 'ok', now });
    expect(pr.toSnapshot()).toMatchObject({ status: 'approved', currentLevel: null, version: 4 });
    expect(pr.lines.map((line) => line.approvedQty)).toEqual([8, 0]);
    expect(pr.toSnapshot().decisions.map((decision) => decision.levelName)).toEqual(['Store manager', 'Director']);
  });

  it('needs approval levels, a reason to reject, and something approved', () => {
    expect(() => requisition().submit([], now)).toThrow(/No approval levels/);
    const pr = requisition();
    pr.submit(levels, now);
    expect(() =>
      pr.approve({
        level: levels[1]!,
        levels,
        quantities: new Map([
          ['v1', 0],
          ['v2', 0],
        ]),
        by: 'u1',
        remarks: null,
        now,
      }),
    ).toThrow(/at least one line/);
    expect(() => pr.reject({ level: levels[1]!, by: 'u1', remarks: ' ', now })).toThrow(/Give a reason/);
    pr.reject({ level: levels[1]!, by: 'u1', remarks: 'Not budgeted', now });
    expect(pr.status).toBe('rejected');
    expect(() => pr.edit({ header: { note: 'x' } }, now)).toThrow(/rejected requisition cannot be edited/);
  });

  it('refuses bad lines', () => {
    const header = requisition().toSnapshot();
    const draft = (lines: { variantId: string; requestedQty: number }[]) =>
      PurchaseRequisition.draft({
        id: 'r2',
        number: 'PR-2026-00002',
        header,
        lines: lines.map((line) => ({ ...line, approvedQty: null, description: null })),
        createdBy: 'u0',
        now,
      });
    expect(() => draft([])).toThrow(/1 to 300 lines/);
    expect(() => draft([{ variantId: 'v1', requestedQty: 1.0001 }])).toThrow(/at most 3 decimals/);
    expect(() =>
      draft([
        { variantId: 'v1', requestedQty: 1 },
        { variantId: 'v1', requestedQty: 2 },
      ]),
    ).toThrow(/already on the requisition/);
  });
});

describe('ComparativeStudy', () => {
  const quote = (supplierId: string, unitPrice: number, extra: Record<string, unknown> = {}) => ({
    id: `${supplierId}-q`,
    supplierId,
    variantId: 'v1',
    manualName: null,
    qty: 3,
    unitPrice,
    vatPercent: 7.5,
    aitPercent: 2,
    ...extra,
  });

  it('adds VAT and AIT on price times quantity, each to the paisa', () => {
    expect(quoteAmounts({ qty: 3, unitPrice: 333.33, vatPercent: 7.5, aitPercent: 2 })).toEqual({
      vat: 75,
      ait: 20,
      total: 1094.99,
    });
  });

  it('keeps the quotes approvers choose; a final level ends the approval', () => {
    const study = ComparativeStudy.draft({
      id: 's1',
      number: 'CS-2026-00001',
      header: { studyDate: '2026-03-02', requisitionId: null, title: ' Gloves ', note: null },
      quotes: [quote('a', 100), quote('b', 95), quote('c', 0, { variantId: null, manualName: 'Local gloves' })],
      createdBy: 'u0',
      now,
    });
    expect(study.toSnapshot().title).toBe('Gloves');
    const studyLevels = [
      { order: 1, name: 'Purchase committee', isFinal: false },
      { order: 2, name: 'Managing director', isFinal: true },
      { order: 3, name: 'Chairman', isFinal: false },
    ];
    study.submit(studyLevels, now);
    study.approve({ level: studyLevels[0]!, levels: studyLevels, keep: ['a-q', 'b-q'], by: 'u1', remarks: null, now });
    expect(() =>
      study.approve({ level: studyLevels[1]!, levels: studyLevels, keep: ['c-q'], by: 'u2', remarks: null, now }),
    ).toThrow(/still in the running/);
    study.approve({ level: studyLevels[1]!, levels: studyLevels, keep: ['b-q'], by: 'u2', remarks: null, now });
    expect(study.status).toBe('approved');
    expect(study.winners().map((winner) => winner.supplierId)).toEqual(['b']);
  });

  it('refuses a quote without an item, or twice from one supplier', () => {
    const draft = (quotes: ReturnType<typeof quote>[]) =>
      ComparativeStudy.draft({
        id: 's2',
        number: 'CS-2026-00002',
        header: { studyDate: '2026-03-02', requisitionId: null, title: 'X', note: null },
        quotes,
        createdBy: 'u0',
        now,
      });
    expect(() => draft([quote('a', 1, { variantId: null })])).toThrow(/either a catalogue item or a typed-in name/);
    expect(() => draft([quote('a', 1), quote('a', 2)])).toThrow(/already quoted/);
    expect(() => draft([quote('a', 1, { vatPercent: 101 })])).toThrow(/0 to 100/);
  });
});

describe('PurchaseOrder', () => {
  const header = {
    supplierId: 's1',
    mainStoreId: 'm1',
    requisitionId: 'r1',
    comparativeStudyId: null,
    orderDate: '2026-03-05',
    expectedOn: null,
    terms: null,
    note: null,
  };

  it('stays within what the requisition still allows', () => {
    const open = (qty: number) =>
      PurchaseOrder.open({
        id: 'o1',
        number: 'PO-2026-00001',
        header,
        lines: [{ variantId: 'v1', qty, rate: 12.5, vatPercent: 5 }],
        allowance: new Map([['v1', 6]]),
        createdBy: 'u0',
        now,
      });
    expect(() => open(6.5)).toThrow(/only 6 is approved/);
    const order = open(6);
    expect(() =>
      order.edit({ lines: [{ variantId: 'v9', qty: 1, rate: 1, vatPercent: 0 }] }, new Map([['v1', 6]]), now),
    ).toThrow(/not on the requisition/);
    order.cancel('Supplier out of stock', now);
    expect(order.status).toBe('cancelled');
    expect(() => order.cancel('again', now)).toThrow(/cancelled order cannot be cancelled/);
  });

  it('totals rate times quantity plus VAT, to the paisa', () => {
    expect(
      orderTotals([
        { variantId: 'v1', qty: 3, rate: 33.33, vatPercent: 7.5 },
        { variantId: 'v2', qty: 1.5, rate: 10, vatPercent: 0 },
      ]),
    ).toEqual({ amount: 114.99, vat: 7.5, total: 122.49 });
  });
});
