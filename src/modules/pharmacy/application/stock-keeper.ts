import { Injectable } from '@nestjs/common';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { allocate, type Allocation } from '../domain/allocation.js';
import { PharmacyLedger, type MovementKind } from '../domain/repositories.js';

export interface OutLine {
  readonly productId: string;
  readonly qty: number;
  /** Take from this lot only; otherwise first expiring first. */
  readonly lotId?: string | null;
}

export interface Taken extends Allocation {
  readonly productId: string;
  /** The position of the line the part belongs to. */
  readonly line: number;
}

export interface StockDocument {
  readonly id: string;
  readonly number: string;
  readonly on: string;
}

/**
 * Moves an outlet's stock for documents. Taking out locks the outlet's products for the transaction (in a fixed
 * order, so two documents cannot deadlock or both take the last units), allocates lots first expiring first and
 * writes the outgoing movements; putting in writes the same parts into another outlet at the same lot and cost.
 */
@Injectable()
export class PharmacyKeeper {
  constructor(
    private readonly tx: TransactionManager,
    private readonly ledger: PharmacyLedger,
  ) {}

  async takeOut(
    outletId: string,
    lines: readonly OutLine[],
    document: StockDocument,
    kind: MovementKind,
  ): Promise<Taken[]> {
    const productIds = [...new Set(lines.map((line) => line.productId))].sort();
    for (const productId of productIds) await this.tx.lock(`pharmacy:stock:${outletId}:${productId}`);
    const balances = await this.ledger.stockLots(outletId, productIds);
    const taken: Taken[] = [];
    for (const [index, line] of lines.entries()) {
      const lots = (balances.get(line.productId) ?? []).map((lot) => {
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
      taken.push(...parts.map((part) => ({ ...part, productId: line.productId, line: index })));
    }
    await this.ledger.add(
      taken.map((part) => ({
        outletId,
        productId: part.productId,
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
    outletId: string,
    parts: readonly { productId: string; lotId: string; qty: number; unitCost: number }[],
    document: StockDocument,
    kind: MovementKind,
  ): Promise<void> {
    await this.ledger.add(
      parts.map((part) => ({
        outletId,
        productId: part.productId,
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
