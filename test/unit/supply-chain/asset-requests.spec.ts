import { describe, expect, it } from 'vitest';
import { DiscardRequest, ScrapSale, ServiceRequest } from '../../../src/modules/supply-chain/domain/asset-requests.js';
import type { ApprovalLevel } from '../../../src/modules/supply-chain/domain/documents.js';

const now = new Date('2026-06-01T08:00:00Z');
const levels: ApprovalLevel[] = [
  { order: 1, name: 'Biomedical engineer', isFinal: false },
  { order: 2, name: 'Administrator', isFinal: false },
];

describe('ServiceRequest', () => {
  const open = () =>
    ServiceRequest.open({
      id: 's1',
      number: 'AS-2026-00001',
      requestDate: '2026-06-01',
      sentTo: 'Biomed Services',
      note: null,
      lines: [
        { assetId: 'a1', serviceType: 'warranty', problem: 'No display', cost: 500 },
        { assetId: 'a2', serviceType: 'maintenance', problem: null, cost: 1_200 },
      ],
      levels,
      createdBy: 'u0',
      now,
    });

  it('goes out after the last level, without rejected pieces, and closes when all are back', () => {
    const request = open();
    expect(request.lines[0]!.cost).toBe(0);
    expect(request.approve({ level: levels[0]!, levels, reject: ['a2'], by: 'u1', remarks: null, now })).toEqual([]);
    expect(request.status).toBe('pending');
    expect(request.approve({ level: levels[1]!, levels, reject: [], by: 'u2', remarks: null, now })).toEqual(['a1']);
    expect(request.status).toBe('approved');
    expect(() => request.receiveBack(['a2'], '2026-06-10', now)).toThrow(/not out on this request/);
    request.receiveBack(['a1'], '2026-06-10', now);
    expect(request.status).toBe('closed');
  });

  it('keeps one piece at least and refuses duplicates', () => {
    expect(() =>
      open().approve({ level: levels[0]!, levels, reject: ['a1', 'a2'], by: 'u1', remarks: null, now }),
    ).toThrow(/Keep at least one piece/);
    expect(() =>
      ServiceRequest.open({
        id: 's2',
        number: 'AS-2026-00002',
        requestDate: '2026-06-01',
        sentTo: 'X',
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
  it('is discarded at the last level and sold once for every piece', () => {
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
    expect(() => request.sell({ amounts: new Map(), soldTo: 'X', on: '2026-06-03', invoiceNo: 'DIS-1', now })).toThrow(
      /pending request cannot be sold/,
    );
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
    expect(() => request.sell({ amounts: new Map(), soldTo: 'X', on: '2026-06-01', invoiceNo: 'DIS-1', now })).toThrow(
      /not before the discard/,
    );
    const total = request.sell({
      amounts: new Map([['a1', 1_500.5]]),
      soldTo: 'Scrap Traders',
      on: '2026-06-05',
      invoiceNo: 'DIS-2026-00001',
      now,
    });
    expect(total).toBe(1_500.5);
    expect(request.lines.map((line) => line.saleAmount)).toEqual([1_500.5, 0]);
    expect(request.status).toBe('sold');
  });
});

describe('ScrapSale', () => {
  it('adds up its lines and is sold at the last level', () => {
    const sale = ScrapSale.open({
      id: 'x1',
      number: 'SS-2026-00001',
      saleDate: '2026-06-04',
      buyer: 'Scrap Traders',
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
