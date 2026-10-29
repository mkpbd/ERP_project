import { DomainError } from '../../../shared/domain/errors.js';

export const CUSTOMER_KINDS = ['walk_in', 'staff', 'member'] as const;
export type CustomerKind = (typeof CUSTOMER_KINDS)[number];

export interface CanteenItem {
  readonly id: string;
  readonly name: string;
  readonly unit: string;
  readonly rate: number;
  readonly staffRate: number;
  readonly vatPercent: number;
  readonly stockVariantId: string | null;
  readonly stockQty: number;
  readonly isActive: boolean;
}

export interface PricedLine {
  readonly itemId: string;
  readonly qty: number;
  readonly rate: number;
  readonly amount: number;
  readonly vat: number;
}

export interface SaleTotals {
  readonly lines: PricedLine[];
  readonly gross: number;
  readonly discount: number;
  readonly vat: number;
  readonly net: number;
  readonly paid: number;
  readonly due: number;
}

const cents = (value: number) => Math.round(value * 100) / 100;

/**
 * Old SaleInvoice totals: each line at the general rate (the staff rate for staff), VAT on the line, the discount off
 * the gross; what is not paid is a due, which only a member may leave. Paying more is change, never kept.
 */
export function priceSale(params: {
  customerKind: CustomerKind;
  lines: readonly { itemId: string; qty: number }[];
  items: ReadonlyMap<string, CanteenItem>;
  discount: number;
  paid: number;
}): SaleTotals {
  if (params.lines.length === 0 || params.lines.length > 50) {
    throw new DomainError('invalid_lines', 'A sale has 1 to 50 lines');
  }
  const lines = params.lines.map((line) => {
    const item = params.items.get(line.itemId);
    if (!item) throw new DomainError('unknown_item', 'An item is not on the menu');
    if (!item.isActive) throw new DomainError('item_inactive', `${item.name} is not sold`);
    if (
      !Number.isFinite(line.qty) ||
      line.qty <= 0 ||
      line.qty > 1000 ||
      Math.abs(Math.round(line.qty * 1000) - line.qty * 1000) > 1e-6
    ) {
      throw new DomainError('invalid_quantity', `The quantity of ${item.name} is above 0, to 3 decimals`);
    }
    const rate = params.customerKind === 'staff' ? item.staffRate : item.rate;
    const amount = cents(line.qty * rate);
    return { itemId: item.id, qty: line.qty, rate, amount, vat: cents((amount * item.vatPercent) / 100) };
  });
  const gross = cents(lines.reduce((sum, line) => sum + line.amount, 0));
  const vat = cents(lines.reduce((sum, line) => sum + line.vat, 0));
  if (!(params.discount >= 0) || params.discount > gross) {
    throw new DomainError('invalid_discount', 'The discount is 0 up to the amount');
  }
  const net = cents(gross - params.discount + vat);
  if (!(params.paid >= 0)) throw new DomainError('invalid_payment', 'The payment is 0 or more');
  const paid = Math.min(cents(params.paid), net);
  const due = cents(net - paid);
  if (due > 0 && params.customerKind !== 'member') {
    throw new DomainError('due_not_allowed', 'Only a member may leave a due; take the whole amount');
  }
  return { lines, gross, discount: cents(params.discount), vat, net, paid, due };
}

/** Packaged goods to use up from the store department: store item and quantity, added up per store item. */
export function stockToUse(lines: readonly PricedLine[], items: ReadonlyMap<string, CanteenItem>) {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const item = items.get(line.itemId)!;
    if (!item.stockVariantId) continue;
    const used = Math.round(line.qty * item.stockQty * 1000) / 1000;
    totals.set(item.stockVariantId, Math.round(((totals.get(item.stockVariantId) ?? 0) + used) * 1000) / 1000);
  }
  return [...totals.entries()].map(([variantId, qty]) => ({ variantId, qty }));
}
