import { DomainError } from '../../../shared/domain/errors.js';

export const MAX_DOCUMENT_LINES = 300;
export const MAX_QUANTITY = 10_000_000;
export const MAX_AMOUNT = 1_000_000_000;

/** Numbers are `<kind>-<year>-<serial>`, e.g. PO-2026-00001. */
export const documentNumber = (kind: string, year: number, serial: number) =>
  `${kind}-${year}-${String(serial).padStart(5, '0')}`;

const decimals = (value: number, places: number) => {
  const scaled = value * 10 ** places;
  return Math.abs(Math.round(scaled) - scaled) < 1e-6;
};

/** Medicines move in whole units (tablets, bottles, vials), as the old integer quantities. */
export function validUnits(qty: number, at: string, allowZero = false): number {
  if (!Number.isInteger(qty) || (allowZero ? qty < 0 : qty <= 0) || qty > MAX_QUANTITY) {
    throw new DomainError(
      'invalid_quantity',
      `${at}: the quantity must be a whole number from ${allowZero ? 0 : 1} to ${MAX_QUANTITY}`,
    );
  }
  return qty;
}

/** An amount or sale rate: 0 or more, at most two decimals. */
export function validAmount(amount: number, at: string): number {
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT || !decimals(amount, 2)) {
    throw new DomainError('invalid_amount', `${at}: amounts are 0 to ${MAX_AMOUNT} with at most 2 decimals`);
  }
  return amount;
}

/** A purchase rate per unit: 0 or more, at most four decimals (a box price divided by its units). */
export function validRate(rate: number, at: string): number {
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_AMOUNT || !decimals(rate, 4)) {
    throw new DomainError('invalid_rate', `${at}: rates are 0 to ${MAX_AMOUNT} with at most 4 decimals`);
  }
  return rate;
}

export function validPercent(percent: number, at: string): number {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100 || !decimals(percent, 2)) {
    throw new DomainError('invalid_percent', `${at}: percentages are 0 to 100 with at most 2 decimals`);
  }
  return percent;
}

/** Rounds to the paisa, half away from zero. */
export const paisa = (amount: number) => Math.sign(amount) * Math.round(Math.abs(amount) * 100);
export const taka = (paisa: number) => paisa / 100;

export const text = (value: string | null, max: number, what: string, at: string): string | null => {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length > max) throw new DomainError('invalid_text', `${at}: the ${what} is at most ${max} characters`);
  return trimmed.length > 0 ? trimmed : null;
};
