import { DomainError } from '../../../shared/domain/errors.js';

export type ReturnChannel = 'opd' | 'ipd';

/** Old PharmacyReturnPolicies: one row per channel; switched off (or no row) = no limit. */
export interface ReturnPolicy {
  readonly isEnabled: boolean;
  readonly days: number;
}

export const MAX_RETURN_DAYS = 365;

export function validReturnDays(days: number): number {
  if (!Number.isInteger(days) || days < 0 || days > MAX_RETURN_DAYS) {
    throw new DomainError('invalid_days', `The return period is 0 to ${MAX_RETURN_DAYS} whole days`);
  }
  return days;
}

const dayNumber = (isoDay: string) => Math.round(Date.parse(`${isoDay}T00:00:00Z`) / 86_400_000);

/**
 * Old PharmacyReturnWindowRules (19-10-2026): calendar days, inclusive (with 7 days a sale of the 12th comes back up
 * to and including the 19th; 0 = the same day only); a sale dated after the return is never returnable; a period
 * switched off, or none set up, is no limit.
 */
export function assertWithinReturnWindow(policy: ReturnPolicy | null, soldOn: string, returnedOn: string): void {
  if (returnedOn < soldOn) throw new DomainError('invalid_date', 'Nothing comes back before it was sold');
  if (!policy?.isEnabled) return;
  const age = dayNumber(returnedOn) - dayNumber(soldOn);
  if (age > policy.days) {
    throw new DomainError(
      'return_period_over',
      `The return period is ${policy.days} days; this sale is ${age} days old`,
    );
  }
}
