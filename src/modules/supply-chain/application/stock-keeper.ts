import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { allocate, type Allocation } from '../domain/allocation.js';
import { AssetRegister, StockLedger, type NewMovement, type StockPlace } from '../domain/repositories.js';

export interface OutLine {
  readonly variantId: string;
  readonly qty: number;
  /** Take from this lot only; otherwise first expiring first. */
  readonly lotId?: string | null;
}

export interface Taken extends Allocation {
  readonly variantId: string;
  /** The position of the line the part belongs to. */
  readonly line: number;
}

export interface StockDocument {
  readonly id: string;
  readonly number: string;
  readonly on: string;
}

const storeKey = (store: StockPlace) =>
  'mainStoreId' in store
    ? `main:${store.mainStoreId}`
    : 'subStoreId' in store
      ? `sub:${store.subStoreId}`
      : `department:${store.departmentId}`;

/**
 * Moves stock for store documents. Taking out locks the store's variants for the transaction (in a fixed
 * order, so two documents cannot deadlock or both take the last units), allocates lots and writes the
 * outgoing movements; putting in writes the same parts into another store at the same lot and cost.
 */
@Injectable()
export class StockKeeper {
  constructor(
    private readonly tx: TransactionManager,
    private readonly ledger: StockLedger,
    private readonly assets: AssetRegister,
  ) {}

  async takeOut(
    store: StockPlace,
    lines: readonly OutLine[],
    document: StockDocument,
    kind: NewMovement['kind'],
    options: { includeExpired?: boolean } = {},
  ): Promise<Taken[]> {
    const variantIds = [...new Set(lines.map((line) => line.variantId))].sort();
    for (const variantId of variantIds) await this.tx.lock(`scm:stock:${storeKey(store)}:${variantId}`);
    const balances = await this.ledger.balances(store, variantIds);
    const taken: Taken[] = [];
    for (const [index, line] of lines.entries()) {
      const lots = (balances.get(line.variantId) ?? []).map((lot) => {
        // Earlier lines of this document already took from the same lots.
        const used = taken.filter((part) => part.lotId === lot.lotId).reduce((sum, part) => sum + part.qty, 0);
        const unit = lot.qty > 0 ? lot.value / lot.qty : 0;
        return { ...lot, qty: lot.qty - used, value: (lot.qty - used) * unit };
      });
      const parts = allocate({
        lots,
        qty: line.qty,
        on: document.on,
        lotId: line.lotId ?? null,
        includeExpired: options.includeExpired ?? false,
        at: `Line ${index + 1}`,
      });
      taken.push(...parts.map((part) => ({ ...part, variantId: line.variantId, line: index })));
    }
    await this.ledger.add(
      taken.map((part) => ({
        store,
        variantId: part.variantId,
        lotId: part.lotId,
        qty: -part.qty,
        unitCost: part.unitCost,
        movedOn: document.on,
        kind,
        documentId: document.id,
        documentNumber: document.number,
      })),
    );
    return taken;
  }

  /** Puts the parts into `store`; registered asset pieces move with them from `from` (old RelocateFixedAssetPieces). */
  async putIn(
    store: StockPlace,
    parts: readonly Taken[],
    document: StockDocument,
    kind: NewMovement['kind'],
    from?: StockPlace,
  ): Promise<void> {
    await this.ledger.add(
      parts.map((part) => ({
        store,
        variantId: part.variantId,
        lotId: part.lotId,
        qty: part.qty,
        unitCost: part.unitCost,
        movedOn: document.on,
        kind,
        documentId: document.id,
        documentNumber: document.number,
      })),
    );
    if (from) {
      for (const [key, qty] of piecesByLot(parts)) {
        const [variantId, lotId] = key.split('|') as [string, string];
        await this.assets.relocate(variantId, lotId, qty, from, store);
      }
    }
  }

  /** Registered pieces leave the stock with the parts (goods back to the supplier). */
  async release(from: StockPlace, parts: readonly Taken[]): Promise<void> {
    for (const [key, qty] of piecesByLot(parts)) {
      const [variantId, lotId] = key.split('|') as [string, string];
      await this.assets.release(variantId, lotId, qty, from, 'returned');
    }
  }
}

/** Whole pieces per variant and lot. */
function piecesByLot(parts: readonly Taken[]): Map<string, number> {
  const pieces = new Map<string, number>();
  for (const part of parts) {
    const key = `${part.variantId}|${part.lotId}`;
    pieces.set(key, (pieces.get(key) ?? 0) + part.qty);
  }
  for (const [key, qty] of pieces) pieces.set(key, Math.floor(qty + 1e-9));
  return pieces;
}
