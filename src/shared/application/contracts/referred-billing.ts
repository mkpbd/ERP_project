export interface ReferredAmounts {
  readonly doctorId: string;
  readonly doctorName: string;
  /** Consultation bills referred (net). */
  readonly opd: number;
  /** Diagnostic bills referred (net of tests cancelled). */
  readonly diagnostic: number;
  /** Final indoor bills of admissions referred (net). */
  readonly indoor: number;
}

/**
 * What the hospital billed on doctors' referrals, for marketing's targets, so that marketing never reads the bills.
 * Bills cancelled are left out; a bill counts on the day it was made.
 */
export abstract class ReferredBilling {
  /** Per referring doctor with something referred between the days (inclusive). */
  abstract referred(from: string, to: string): Promise<ReferredAmounts[]>;
}
