import { DomainError } from '../../../shared/domain/errors.js';

/** What tells one lot of a product from another: the batch, the expiry and the sale rate printed on it. */
export interface LotIdentity {
  readonly batchNo: string | null;
  readonly expiryDate: string;
  readonly saleRate: number;
}

const paisa = (value: number) => Math.round(value * 100);

/**
 * Old UpdateProductInStock (expiry and sale price edited in place, no reason asked): the lot as it should have been
 * entered. Something must change, and the reason is kept.
 */
export function correctLot(
  current: LotIdentity,
  wanted: LotIdentity,
  reason: string,
): LotIdentity & { reason: string } {
  const batchNo = wanted.batchNo?.trim() || null;
  if (batchNo && batchNo.length > 50)
    throw new DomainError('invalid_batch', 'A batch number has at most 50 characters');
  if (!(Number.isFinite(wanted.saleRate) && wanted.saleRate >= 0)) {
    throw new DomainError('invalid_rate', 'The sale rate is a sum of money, not negative');
  }
  const saleRate = paisa(wanted.saleRate) / 100;
  const why = reason.replace(/\s+/g, ' ').trim();
  if (!why) throw new DomainError('invalid_remarks', 'Give a reason');
  if (why.length > 300) throw new DomainError('invalid_remarks', 'The reason is longer than 300 characters');
  const same =
    (current.batchNo ?? '').toUpperCase() === (batchNo ?? '').toUpperCase() &&
    current.expiryDate === wanted.expiryDate &&
    paisa(current.saleRate) === paisa(saleRate);
  if (same) throw new DomainError('lot_unchanged', 'Change the batch, the expiry or the sale rate');
  return { batchNo, expiryDate: wanted.expiryDate, saleRate, reason: why };
}
