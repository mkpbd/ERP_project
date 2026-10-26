import { describe, expect, it } from 'vitest';
import { DiscardRequest, ScrapSale, ServiceRequest } from '../../../src/modules/supply-chain/domain/asset-requests.js';
import type { ApprovalLevel } from '../../../src/modules/supply-chain/domain/documents.js';

const now = new Date('2026-06-01T08:00:00Z');
const levels: ApprovalLevel[] = [
  { order: 1, name: 'Biomedical engineer', isFinal: false },
  { order: 2, name: 'Administrator', isFinal: false },
];
const saleLevels: ApprovalLevel[] = [{ order: 1, name: 'Accounts', isFinal: false }];

describe('ServiceRequest', () => {
  const open = () =>
    ServiceRequest.open({
      id: 's1',
      number: 'AS-2026-00001',
      requestDate: '2026-06-01',
      sentTo: 'Biomed Services',
      supplierId: null,
      note: null,
      lines: [
        { assetId: 'a1', serviceType: 'warranty', problem: 'No display', cost: 500 },
        { assetId: 'a2', serviceType: 'maintenance', problem: null, cost: 1_200 },
        { assetId: 'a3', serviceType: 'maintenance', problem: null, cost: 800 },
      ],
      levels,
      createdBy: 'u0',
      now,
    });

  it('goes out after the last level, without rejected pieces, and closes when all are back', () => {
    const request = open();
    expect(request.lines[0]!.cost).toBe(0);
    expect(request.approve({ level: levels[0]!, levels, reject: ['a3'], by: 'u1', remarks: null, now })).toEqual([]);
    expect(request.status).toBe('pending');
    expect(request.approve({ level: levels[1]!, levels, reject: [], by: 'u2', remarks: null, now })).toEqual([
      'a1',
      'a2',
    ]);
    expect(request.status).toBe('approved');
    const back = (assetIds: string[], costs: [string, number][] = []) =>
      request.receiveBack({ assetIds, costs: new Map(costs), on: '2026-06-10', now });
    expect(() => back(['a3'])).toThrow(/not out on this request/);
    expect(() => back(['a1'], [['a2', 10]])).toThrow(/not out on this request/);
    expect(() => back(['a1'], [['a1', 10]])).toThrow(/warranty repair costs nothing/);
    expect(back(['a1'])).toBe(0);
    expect(request.status).toBe('approved');
    // The actual cost wins over the expected one.
    expect(back(['a2'], [['a2', 1_350.25]])).toBe(1_350.25);
    request.booked(['a2'], 'JV-1');
    expect(request.lines.map((line) => [line.actualCost, line.receiptVoucherNumber])).toEqual([
      [0, null],
      [1_350.25, 'JV-1'],
      [null, null],
    ]);
    expect(request.status).toBe('closed');
  });

  it('charges the expected cost when no actual cost is given', () => {
    const request = open();
    request.approve({ level: levels[0]!, levels, reject: ['a1'], by: 'u1', remarks: null, now });
    request.approve({ level: levels[1]!, levels, reject: [], by: 'u2', remarks: null, now });
    expect(request.receiveBack({ assetIds: ['a2', 'a3'], costs: new Map(), on: '2026-06-10', now })).toBe(2_000);
  });

  it('keeps one piece at least and refuses duplicates', () => {
    expect(() =>
      open().approve({ level: levels[0]!, levels, reject: ['a1', 'a2', 'a3'], by: 'u1', remarks: null, now }),
    ).toThrow(/Keep at least one piece/);
    expect(() =>
      ServiceRequest.open({
        id: 's2',
        number: 'AS-2026-00002',
        requestDate: '2026-06-01',
        sentTo: 'X',
        supplierId: null,
        note: null,
        lines: [
          { assetId: 'a1', serviceType: 'warranty', problem: null, cost: 0 },
          { assetId: 'a1', serviceType: 'maintenance', problem: null, cost: 0 },
        ],
        levels,
        createdBy: 'u0',
        now,
      }),
    ).toThrow(/already on the service request/);
  });
});

describe('DiscardRequest', () => {
  const discarded = () => {
    const request = DiscardRequest.open({
      id: 'd1',
      number: 'AD-2026-00001',
      requestDate: '2026-06-02',
      reason: 'Beyond repair',
      lines: [
        { assetId: 'a1', reason: null },
        { assetId: 'a2', reason: 'Cracked' },
      ],
      levels: [levels[0]!],
      createdBy: 'u0',
      now,
    });
    return request;
  };
  const propose = (request: DiscardRequest, on = '2026-06-05') =>
    request.proposeSale({
      amounts: new Map([['a1', 1_500.5]]),
      soldTo: 'Scrap Traders',
      buyerSupplierId: 'sup1',
      on,
      levels: saleLevels,
      by: 'u3',
      now,
    });

  it('is discarded at the last level, then its sale is approved on its own ladder', () => {
    const request = discarded();
    expect(() => propose(request)).toThrow(/pending request cannot be sold/);
    expect(
      request.approve({
        level: levels[0]!,
        levels: [levels[0]!],
        reject: [],
        by: 'u1',
        remarks: null,
        on: '2026-06-02',
        now,
      }),
    ).toEqual(['a1', 'a2']);
    expect(() => propose(request, '2026-06-01')).toThrow(/not before the discard/);
    expect(() =>
      request.proposeSale({
        amounts: new Map(),
        soldTo: 'X',
        buyerSupplierId: null,
        on: '2026-06-05',
        levels: [],
        by: 'u3',
        now,
      }),
    ).toThrow(/No approval levels are set up for discard sales/);
    expect(request.status).toBe('discarded');

    propose(request);
    expect(request.status).toBe('sale_pending');
    expect(request.currentLevel).toBe(1);
    expect(request.saleTotal).toBe(1_500.5);
    expect(request.lines.map((line) => line.saleAmount)).toEqual([1_500.5, 0]);
    expect(() =>
      request.approve({ level: levels[0]!, levels, reject: [], by: 'u1', remarks: null, on: '2026-06-05', now }),
    ).toThrow(/own ladder/);
    expect(request.approveSale({ level: saleLevels[0]!, levels: saleLevels, by: 'u4', remarks: null, now })).toBe(true);
    expect(request.status).toBe('sold');
    expect(request.toSnapshot().decisions.map((decision) => decision.stage)).toEqual(['request', 'sale']);
  });

  it('goes back to discarded when the sale is rejected, and may be proposed again', () => {
    const request = discarded();
    request.approve({
      level: levels[0]!,
      levels: [levels[0]!],
      reject: [],
      by: 'u1',
      remarks: null,
      on: '2026-06-02',
      now,
    });
    propose(request);
    request.reject({ level: saleLevels[0]!, by: 'u4', remarks: 'Too cheap', now });
    expect(request.status).toBe('discarded');
    expect(request.lines.map((line) => line.saleAmount)).toEqual([null, null]);
    expect(request.buyerSupplierId).toBeNull();
    propose(request);
    expect(request.status).toBe('sale_pending');
    expect(request.toSnapshot().decisions.map((decision) => `${decision.stage}:${decision.decision}`)).toEqual([
      'request:approved',
      'sale:rejected',
    ]);
  });
});

describe('ScrapSale', () => {
  it('adds up its lines and is sold at the last level', () => {
    const sale = ScrapSale.open({
      id: 'x1',
      number: 'SS-2026-00001',
      saleDate: '2026-06-04',
      buyer: 'Scrap Traders',
      buyerSupplierId: null,
      lines: [
        { description: 'Cartons', unit: 'kg', qty: 12.5, unitPrice: 8 },
        { description: 'Broken chairs', unit: 'Pcs', qty: 3, unitPrice: 150.33 },
      ],
      levels,
      createdBy: 'u0',
      now,
    });
    expect(sale.total).toBe(550.99);
    expect(sale.approve({ level: levels[0]!, levels, by: 'u1', remarks: null, now })).toBe(false);
    expect(sale.approve({ level: levels[1]!, levels, by: 'u2', remarks: null, now })).toBe(true);
    expect(sale.status).toBe('sold');
  });
});
