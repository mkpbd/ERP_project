import { DomainError } from '../../../shared/domain/errors.js';

/** What an outlet holds of one product in one lot. */
export interface LotBalance {
  readonly lotId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string;
  readonly saleRate: number;
  readonly qty: number;
  /** Value of the units held, at the costs they came in at. */
  readonly value: number;
}

export interface Allocation {
  readonly lotId: string;
  readonly qty: number;
  readonly unitCost: number;
  readonly saleRate: number;
}

const cost4 = (value: number) => Math.round(value * 10_000) / 10_000;

/**
 * Takes `qty` units out of the lots, first expiring first, skipping lots expired on `on` (old
 * PharmacySaleExpiryGuard; the 2026-10-19 fix found expired lots taken first). A lot may be named to take from it
 * only. Each part carries the lot's average cost at the outlet and its sale rate.
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
    .filter((lot) => lot.expiryDate > params.on)
    .sort(
      (a, b) =>
        a.expiryDate.localeCompare(b.expiryDate) ||
        (a.batchNo ?? '').localeCompare(b.batchNo ?? '') ||
        a.lotId.localeCompare(b.lotId),
    );
  const parts: Allocation[] = [];
  let left = params.qty;
  for (const lot of usable) {
    if (left <= 0) break;
    const take = Math.min(left, lot.qty);
    parts.push({ lotId: lot.lotId, qty: take, unitCost: cost4(lot.value / lot.qty), saleRate: lot.saleRate });
    left -= take;
  }
  if (left > 0) {
    const available = usable.reduce((sum, lot) => sum + lot.qty, 0);
    throw new DomainError(
      'insufficient_stock',
      `${params.at}: only ${available} in stock${params.lotId ? ' in that lot' : ''} (expired lots left out)`,
    );
  }
  return parts;
}
