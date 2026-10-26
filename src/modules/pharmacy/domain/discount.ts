import { DomainError } from '../../../shared/domain/errors.js';
import { paisa, taka } from './documents.js';

export type SaleChannel = 'opd' | 'ipd';

/** The pharmacy-wide default (old ProductDiscountPolicies). */
export interface DiscountPolicy {
  readonly allowedByDefault: boolean;
  readonly opdPercent: number;
  /** Null = the same as over the counter. */
  readonly ipdPercent: number | null;
}

/** A product's own rule (old ProductDiscountSettings). */
export interface ProductDiscount {
  readonly isAllowed: boolean;
  /** Null = the policy's percent. */
  readonly opdPercent: number | null;
  /** Null = the same as this product's over-the-counter percent. */
  readonly ipdPercent: number | null;
}

/** What every sale got before per-product discounts (old flat 5 %), when no policy is set up. */
export const DEFAULT_POLICY: DiscountPolicy = { allowedByDefault: true, opdPercent: 5, ipdPercent: null };

export function validDiscountPercent(percent: number | null, what: string): number | null {
  if (percent === null) return null;
  if (
    !Number.isFinite(percent) ||
    percent < 0 ||
    percent > 100 ||
    Math.abs(Math.round(percent * 100) - percent * 100) > 1e-6
  ) {
    throw new DomainError('invalid_percent', `${what}: percentages are 0 to 100 with at most 2 decimals`);
  }
  return percent;
}

/**
 * Old PharmacyDiscountRules (19-10-2026): the percent a product gets on a channel. A product is discountable or
 * not (its own rule, else the policy's default); its percent is its own, else the policy's; indoor follows over
 * the counter unless set.
 */
export function discountPercent(policy: DiscountPolicy, own: ProductDiscount | null, channel: SaleChannel): number {
  const allowed = own ? own.isAllowed : policy.allowedByDefault;
  if (!allowed) return 0;
  if (channel === 'opd') return own?.opdPercent ?? policy.opdPercent;
  return own?.ipdPercent ?? own?.opdPercent ?? policy.ipdPercent ?? policy.opdPercent;
}

/** One line's discount, to the paisa (half away from zero); lines are worked out on their own. */
export function lineDiscount(amount: number, percent: number): number {
  return taka(Math.round((paisa(amount) * percent) / 100));
}
