import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { allocate, type Allocation } from '../domain/allocation.js';
import { StockLedger, type NewMovement, type StoreRef } from '../domain/repositories.js';

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

const storeKey = (store: StoreRef) =>
  'mainStoreId' in store ? `main:${store.mainStoreId}` : `sub:${store.subStoreId}`;

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
  ) {}

  async takeOut(
    store: StoreRef,
    lines: readonly OutLine[],
    document: StockDocument,
    kind: NewMovement['kind'],
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

  async putIn(
    store: StoreRef,
    parts: readonly Taken[],
    document: StockDocument,
    kind: NewMovement['kind'],
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
  }
}
