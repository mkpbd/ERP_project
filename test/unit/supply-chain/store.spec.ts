import { describe, expect, it } from 'vitest';
import { StockKeeper } from '../../../src/modules/supply-chain/application/stock-keeper.js';
import type { LotBalance } from '../../../src/modules/supply-chain/domain/allocation.js';
import type { ApprovalLevel } from '../../../src/modules/supply-chain/domain/documents.js';
import { StockLedger, type NewMovement, type StoreRef } from '../../../src/modules/supply-chain/domain/repositories.js';
import {
  acceptedLines,
  quantitiesOf,
  StoreIndent,
  StoreRequest,
  validMoveLines,
} from '../../../src/modules/supply-chain/domain/store-documents.js';
import type { TransactionManager } from '../../../src/shared/application/ports/transaction-manager.js';

const now = new Date('2026-04-01T08:00:00Z');
const levels: ApprovalLevel[] = [
  { order: 1, name: 'Ward in-charge', isFinal: false },
  { order: 2, name: 'Store manager', isFinal: false },
];

const indent = () =>
  StoreIndent.draft({
    id: 'i1',
    number: 'SI-2026-00001',
    header: { subStoreId: 's1', departmentId: 'd1', indentDate: '2026-04-01', priority: 'emergency', note: ' ' },
    lines: [
      { variantId: 'v1', qty: 10, remarks: null },
      { variantId: 'v2', qty: 4, remarks: 'Urgent' },
    ],
    createdBy: 'u0',
    now,
  });

describe('StoreIndent', () => {
  it('needs every approval level in turn, then is served by issues and acknowledged', () => {
    const si = indent();
    expect(si.toSnapshot().note).toBeNull();
    si.submit(levels, now);
    si.approve({ level: levels[0]!, levels, quantities: new Map([['v1', 6]]), by: 'u1', remarks: null, now });
    // The old screen marked the indent approved here, so the store manager never saw it.
    expect(si.status).toBe('pending');
    expect(() => si.serve(new Map([['v1', 1]]), now)).toThrow(/pending indent cannot be served/);
    si.approve({ level: levels[1]!, levels, quantities: new Map(), by: 'u2', remarks: null, now });
    expect(si.status).toBe('approved');
    expect(si.open()).toEqual(
      new Map([
        ['v1', 6],
        ['v2', 4],
      ]),
    );
    si.serve(new Map([['v1', 6]]), now);
    expect(si.status).toBe('partially_served');
    expect(() => si.serve(new Map([['v2', 4.5]]), now)).toThrow(/only 4 is still open/);
    expect(() => si.acknowledge('u0', now)).toThrow(/partially served indent cannot be acknowledged/);
    si.serve(new Map([['v2', 4]]), now);
    expect(si.status).toBe('served');
    si.acknowledge('u0', now);
    expect(si.toSnapshot()).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'u0' });
  });

  it('can be rejected with a reason or cancelled while partly served', () => {
    const rejected = indent();
    rejected.submit(levels, now);
    rejected.reject({ level: levels[0]!, by: 'u1', remarks: 'Use the old stock', now });
    expect(rejected.status).toBe('rejected');
    const partial = indent();
    partial.submit([{ order: 1, name: 'Only', isFinal: false }], now);
    partial.approve({
      level: { order: 1, name: 'Only', isFinal: false },
      levels: [],
      quantities: new Map(),
      by: 'u1',
      remarks: null,
      now,
    });
    partial.serve(new Map([['v1', 2]]), now);
    partial.cancel(now);
    expect(partial.status).toBe('cancelled');
  });
});

describe('StoreRequest', () => {
  it('is served by transfers up to what was asked and can go to purchase once', () => {
    const request = StoreRequest.open({
      id: 'r1',
      number: 'RQ-2026-00001',
      subStoreId: 's1',
      mainStoreId: 'm1',
      requestDate: '2026-04-02',
      note: null,
      lines: [
        { variantId: 'v1', qty: 5 },
        { variantId: 'v2', qty: 2 },
      ],
      createdBy: 'u0',
      now,
    });
    request.serve(new Map([['v1', 5]]), now);
    expect(request.status).toBe('partially_served');
    expect(request.outstanding()).toEqual(new Map([['v2', 2]]));
    expect(() => request.serve(new Map([['v3', 1]]), now)).toThrow(/not on the store request/);
    request.linkPurchase('pr1', now);
    expect(() => request.linkPurchase('pr2', now)).toThrow(/already raised/);
    request.close(now);
    expect(() => request.serve(new Map([['v2', 1]]), now)).toThrow(/closed request cannot be served/);
  });
});

describe('moves', () => {
  it('allow an item twice only in different lots, and add up quantities', () => {
    const lines = validMoveLines(
      [
        { variantId: 'v1', qty: 2, lotId: 'a' },
        { variantId: 'v1', qty: 3, lotId: null },
      ],
      'issue',
    );
    expect(quantitiesOf(lines)).toEqual(new Map([['v1', 5]]));
    expect(() =>
      validMoveLines(
        [
          { variantId: 'v1', qty: 2, lotId: 'a' },
          { variantId: 'v1', qty: 3, lotId: 'a' },
        ],
        'issue',
      ),
    ).toThrow(/already on the issue/);
  });

  it('accept less than sent, not more', () => {
    const lines = [
      { variantId: 'v1', qty: 5, lotId: null, acceptedQty: null },
      { variantId: 'v2', qty: 2, lotId: null, acceptedQty: null },
    ];
    expect(acceptedLines(lines, new Map([[1, 0]])).map((line) => line.acceptedQty)).toEqual([5, 0]);
    expect(() => acceptedLines(lines, new Map([[0, 6]]))).toThrow(/more than sent/);
    expect(() =>
      acceptedLines(
        lines,
        new Map([
          [0, 0],
          [1, 0],
        ]),
      ),
    ).toThrow(/Accept at least one line/);
  });
});

describe('StockKeeper', () => {
  class FakeLedger extends StockLedger {
    readonly written: NewMovement[] = [];
    constructor(private readonly lots: Map<string, LotBalance[]>) {
      super();
    }
    lot(): Promise<string> {
      throw new Error('not used');
    }
    add(movements: readonly NewMovement[]): Promise<void> {
      this.written.push(...movements);
      return Promise.resolve();
    }
    balances(_store: StoreRef, variantIds: readonly string[]): Promise<Map<string, LotBalance[]>> {
      return Promise.resolve(new Map(variantIds.map((id) => [id, this.lots.get(id) ?? []])));
    }
  }
  const locks: string[] = [];
  const tx = {
    lock: (resource: string) => Promise.resolve(void locks.push(resource)),
  } as unknown as TransactionManager;

  it('locks the variants in order and takes lots across lines of one document', async () => {
    const ledger = new FakeLedger(
      new Map([
        [
          'v2',
          [
            { lotId: 'early', batchNo: 'E', expiryDate: '2026-05-01', qty: 3, value: 30 },
            { lotId: 'late', batchNo: 'L', expiryDate: '2027-05-01', qty: 10, value: 120 },
          ],
        ],
        ['v1', [{ lotId: 'x', batchNo: null, expiryDate: null, qty: 1, value: 7 }]],
      ]),
    );
    const keeper = new StockKeeper(tx, ledger);
    const document = { id: 'd1', number: 'IS-2026-00001', on: '2026-04-01' };
    const taken = await keeper.takeOut(
      { subStoreId: 's1' },
      [
        { variantId: 'v2', qty: 2, lotId: 'early' },
        { variantId: 'v2', qty: 4 },
        { variantId: 'v1', qty: 1 },
      ],
      document,
      'issue',
    );
    expect(locks).toEqual(['scm:stock:sub:s1:v1', 'scm:stock:sub:s1:v2']);
    expect(taken.map((part) => [part.line, part.lotId, part.qty, part.unitCost])).toEqual([
      [0, 'early', 2, 10],
      [1, 'early', 1, 10],
      [1, 'late', 3, 12],
      [2, 'x', 1, 7],
    ]);
    expect(ledger.written.map((movement) => movement.qty)).toEqual([-2, -1, -3, -1]);
    await keeper.putIn({ mainStoreId: 'm1' }, taken, document, 'transfer');
    expect(ledger.written.slice(4).map((movement) => [movement.store, movement.qty])).toEqual([
      [{ mainStoreId: 'm1' }, 2],
      [{ mainStoreId: 'm1' }, 1],
      [{ mainStoreId: 'm1' }, 3],
      [{ mainStoreId: 'm1' }, 1],
    ]);
    await expect(
      keeper.takeOut({ subStoreId: 's1' }, [{ variantId: 'v1', qty: 2 }], document, 'issue'),
    ).rejects.toThrow(/only 1 is in stock/);
  });
});
