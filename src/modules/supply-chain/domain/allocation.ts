import { DomainError } from '../../../shared/domain/errors.js';

/** What a store holds of one variant in one lot. */
export interface LotBalance {
  readonly lotId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly qty: number;
  /** Value of the quantity held, at the costs it came in at. */
  readonly value: number;
}

export interface Allocation {
  readonly lotId: string;
  readonly qty: number;
  readonly unitCost: number;
}

const qty3 = (value: number) => Math.round(value * 1000) / 1000;
const cost4 = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * Takes `qty` out of the lots, first expiring first (undated lots last), skipping lots expired on `on` (the
 * pharmacy fix of 2026-10-19 found expired lots taken first; the stores had no rule at all). A lot may be
 * named to take from it only. Each part carries the lot's average cost in this store.
 */
export function allocate(params: {
  lots: readonly LotBalance[];
  qty: number;
  on: string;
  lotId?: string | null;
  at: string;
}): Allocation[] {
  const usable = params.lots
    .filter((lot) => lot.qty > 0 && (!params.lotId || lot.lotId === params.lotId))
    .filter((lot) => lot.expiryDate === null || lot.expiryDate > params.on)
    .sort(
      (a, b) =>
        (a.expiryDate ?? '9999-12-31').localeCompare(b.expiryDate ?? '9999-12-31') ||
        (a.batchNo ?? '').localeCompare(b.batchNo ?? '') ||
        a.lotId.localeCompare(b.lotId),
    );
  const parts: Allocation[] = [];
  let left = qty3(params.qty);
  for (const lot of usable) {
    if (left <= 0) break;
    const take = qty3(Math.min(left, lot.qty));
    parts.push({ lotId: lot.lotId, qty: take, unitCost: cost4(lot.value / lot.qty) });
    left = qty3(left - take);
  }
  if (left > 0) {
    const available = qty3(usable.reduce((sum, lot) => sum + lot.qty, 0));
    throw new DomainError(
      'insufficient_stock',
      `${params.at}: only ${available} is in stock${params.lotId ? ' in that lot' : ''} (expired lots left out)`,
    );
  }
  return parts;
}
