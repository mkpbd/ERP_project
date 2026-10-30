const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad = (value: number) => String(value).padStart(2, '0');
const lastDay = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const valid = (year: number, month: number, day: number) =>
  year >= 1990 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= lastDay(year, month)
    ? `${year}-${pad(month)}-${pad(day)}`
    : null;
const fullYear = (value: string) => (value.length === 2 ? 2000 + Number(value) : Number(value));

/**
 * An expiry day from however the old lots wrote it: a date, or text as 2027-03-31, 31/03/2027, 31-03-27, 31-Mar-2027,
 * 03/2027 or Mar 2027 (a month alone expires on its last day). Null when it cannot be read.
 */
export function expiryDay(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : valid(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (match) return valid(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/.exec(text);
  if (match) return valid(fullYear(match[3]!), Number(match[2]), Number(match[1]));
  match = /^(\d{1,2})[-/. ]([a-z]{3})[a-z]*[-/., ]+(\d{2}|\d{4})$/.exec(text);
  if (match) return valid(fullYear(match[3]!), MONTHS.indexOf(match[2]!) + 1, Number(match[1]));
  match = /^(\d{1,2})[-/. ](\d{4})$/.exec(text);
  if (match) return valid(Number(match[2]), Number(match[1]), lastDay(Number(match[2]), Number(match[1])));
  match = /^([a-z]{3})[a-z]*[-/., ]+(\d{2}|\d{4})$/.exec(text);
  if (match) {
    const year = fullYear(match[2]!);
    const month = MONTHS.indexOf(match[1]!) + 1;
    return month ? valid(year, month, lastDay(year, month)) : null;
  }
  return null;
}

/** One old stock row of a product at a store: its lot (or none), quantity and expiry. */
export interface StockRow<L> {
  readonly lot: L;
  readonly qty: number;
  readonly expiry: string | null;
}

/**
 * What a product holds at a store, by lot. The old stock rows can be negative (issues and transfers were counted
 * without their lot), so the product's net quantity is kept, in the lots that expire last: what was issued first
 * expired first. A net that is not above zero holds nothing (`short` says by how much it was under).
 */
export function allocate<L>(rows: readonly StockRow<L>[], places = 0): { lots: StockRow<L>[]; short: number } {
  const scale = 10 ** places;
  const round = (value: number) => Math.round(value * scale) / scale;
  const net = round(rows.reduce((sum, row) => sum + row.qty, 0));
  if (net <= 0) return { lots: [], short: -net };
  if (rows.every((row) => row.qty >= 0)) return { lots: rows.filter((row) => round(row.qty) > 0), short: 0 };
  const latestFirst = rows
    .filter((row) => row.qty > 0)
    .sort((a, b) => (b.expiry ?? '9999-12-31').localeCompare(a.expiry ?? '9999-12-31'));
  const lots: StockRow<L>[] = [];
  let left = net;
  for (const row of latestFirst) {
    if (left <= 0) break;
    const qty = round(Math.min(row.qty, left));
    if (qty > 0) lots.push({ ...row, qty });
    left = round(left - qty);
  }
  return { lots, short: 0 };
}

/** Reusable and fixed-asset items register each piece; the old item type was a GL account named so. */
export const isAssetType = (glAccountName: string | null | undefined) =>
  /reusable|fixed\s*asset/i.test(glAccountName ?? '');
