import { DomainError } from '../../../shared/domain/errors.js';

export const MAX_DOCUMENT_LINES = 300;
export const MAX_QUANTITY = 1_000_000_000;
export const MAX_AMOUNT = 1_000_000_000;

/** Numbers are `<kind>-<year>-<serial>`, e.g. PR-2026-00001 (old: typed, or spGetNextIndentNo serials). */
export const documentNumber = (kind: string, year: number, serial: number) =>
  `${kind}-${year}-${String(serial).padStart(5, '0')}`;

const decimals = (value: number, places: number) => {
  const scaled = value * 10 ** places;
  return Math.abs(Math.round(scaled) - scaled) < 1e-6;
};

/** A quantity: more than zero, at most three decimals. */
export function validQuantity(quantity: number, at: string, allowZero = false): number {
  if (
    !Number.isFinite(quantity) ||
    (allowZero ? quantity < 0 : quantity <= 0) ||
    quantity > MAX_QUANTITY ||
    !decimals(quantity, 3)
  ) {
    throw new DomainError(
      'invalid_quantity',
      `${at}: the quantity must be ${allowZero ? '0' : 'more than 0'} to ${MAX_QUANTITY} with at most 3 decimals`,
    );
  }
  return quantity;
}

/** A rate or amount: 0 or more, at most two decimals. */
export function validAmount(amount: number, at: string): number {
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT || !decimals(amount, 2)) {
    throw new DomainError('invalid_amount', `${at}: amounts are 0 to ${MAX_AMOUNT} with at most 2 decimals`);
  }
  return amount;
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

/** Line count and one line per variant. */
export function validLineSet<T>(lines: readonly T[], key: (line: T) => string, what: string): T[] {
  if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
    throw new DomainError('invalid_lines', `A ${what} has 1 to ${MAX_DOCUMENT_LINES} lines`);
  }
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const id = key(line);
    if (seen.has(id)) throw new DomainError('duplicate_line', `Line ${index + 1}: the item is already on the ${what}`);
    seen.add(id);
  }
  return [...lines];
}

/** A configured approval level; levels are decided in ascending order. */
export interface ApprovalLevel {
  readonly order: number;
  readonly name: string;
  /** Approving at this level approves the document outright (old IsThisTheHighestLevelApproval). */
  readonly isFinal: boolean;
}

/** The level after `current`, or null when `current` was the last one (or is final). */
export function nextLevel(levels: readonly ApprovalLevel[], current: ApprovalLevel): ApprovalLevel | null {
  if (current.isFinal) return null;
  return [...levels].sort((a, b) => a.order - b.order).find((level) => level.order > current.order) ?? null;
}

export function firstLevel(levels: readonly ApprovalLevel[], what: string): ApprovalLevel {
  const first = [...levels].sort((a, b) => a.order - b.order)[0];
  if (!first) throw new DomainError('no_approval_levels', `No approval levels are set up for ${what}`);
  return first;
}

export interface Decision {
  readonly levelOrder: number;
  readonly levelName: string;
  readonly decision: 'approved' | 'rejected';
  readonly decidedBy: string | null;
  readonly decidedAt: Date;
  readonly remarks: string | null;
}

export function validRemarks(remarks: string | null, required: boolean): string | null {
  const text = remarks?.trim() ?? '';
  if (required && text.length === 0) throw new DomainError('invalid_remarks', 'Give a reason');
  if (text.length > 500) throw new DomainError('invalid_remarks', 'Remarks are at most 500 characters');
  return text.length > 0 ? text : null;
}

/**
 * An approver's quantities (variant → approved, 0 drops a line) applied to the lines: never above what was
 * asked for; lines left out keep their quantity (the request, at the first level); something must remain.
 */
export function approvedLines<T extends { readonly variantId: string; readonly approvedQty: number | null }>(
  lines: readonly T[],
  quantities: ReadonlyMap<string, number>,
  requested: (line: T) => number,
  what: string,
): T[] {
  for (const variantId of quantities.keys()) {
    if (!lines.some((line) => line.variantId === variantId)) {
      throw new DomainError('invalid_line', `An approved quantity is for an item not on the ${what}`);
    }
  }
  const approved = lines.map((line, index) => {
    const qty = quantities.get(line.variantId) ?? line.approvedQty ?? requested(line);
    validQuantity(qty, `Line ${index + 1}`, true);
    if (qty > requested(line)) {
      throw new DomainError('approval_exceeds_request', `Line ${index + 1}: more than requested is approved`);
    }
    return { ...line, approvedQty: qty };
  });
  if (approved.every((line) => line.approvedQty === 0)) {
    throw new DomainError('nothing_approved', `Approve at least one line, or reject the ${what}`);
  }
  return approved;
}
