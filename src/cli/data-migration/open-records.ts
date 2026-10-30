import { zonedInstant } from '../../shared/domain/zoned-time.js';

/**
 * The instant an old date-time stood for. The old system kept wall-clock times without a zone, and the driver reads
 * them as if they were UTC: their UTC fields are the wall clock of the organisation's time zone.
 */
export function wallInstant(value: Date, timeZone: string): Date {
  const day = value.toISOString().slice(0, 10);
  const time = `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
  return zonedInstant(day, time, timeZone);
}

export interface OldBedRow<B> {
  readonly bed: B;
  readonly from: Date;
  readonly to: Date | null;
  readonly order: number;
}

/**
 * The beds of a stay, one after another, the last still in use: the old allocation rows sorted by when they began
 * (then their order). A stay ends when the next begins (the old release times were not always set, and sometimes
 * overlapped); the first begins at admission at the latest; stays of no time are dropped.
 */
export function bedHistory<B>(
  rows: readonly OldBedRow<B>[],
  admittedAt: Date,
): { bed: B; fromAt: Date; toAt: Date | null }[] {
  // A bed given back the moment it was taken was a mistake, not a stay.
  const sorted = rows
    .filter((row) => row.to === null || row.to.getTime() > row.from.getTime())
    .sort((a, b) => a.from.getTime() - b.from.getTime() || a.order - b.order);
  const stays = sorted.map((row, index) => {
    const next = sorted[index + 1];
    const fromAt = index === 0 && row.from.getTime() > admittedAt.getTime() ? admittedAt : row.from;
    const toAt = next ? (row.to && row.to.getTime() < next.from.getTime() ? row.to : next.from) : null;
    return { bed: row.bed, fromAt, toAt };
  });
  return stays.filter((stay) => stay.toAt === null || stay.toAt.getTime() > stay.fromAt.getTime());
}

/** Old AdvancePayments.TransactionType (TransactionType enum, as a number or its name): an advance or a refund. */
export function advanceKind(value: unknown): 'advance' | 'refund' | null {
  const kind =
    typeof value === 'number'
      ? (['', '', 'payment', '', '', 'refund'][value] ?? '')
      : typeof value === 'string'
        ? value
        : '';
  const name = kind.trim().toLowerCase();
  return name === 'payment' ? 'advance' : name === 'refund' ? 'refund' : null;
}

/** A balance in paisa from summed old debits and credits (floats). */
export const netPaisa = (debit: number | null, credit: number | null) =>
  Math.round(Number(debit ?? 0) * 100) - Math.round(Number(credit ?? 0) * 100);

/** Bed categories of intensive care (charged at the bed moved to on a move out). */
export const isIntensive = (name: string) => /\b(icu|hdu|ccu|nicu|picu|sicu|micu)\b/i.test(name);
