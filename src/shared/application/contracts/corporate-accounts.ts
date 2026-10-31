/** A company the hospital bills, as another module gives it credit. */
export interface CreditClient {
  readonly id: string;
  readonly name: string;
  /** Credit: what its people buy may be left for the company to pay. */
  readonly payment: 'cash' | 'credit';
  /** Null: no limit. */
  readonly creditLimit: number | null;
  readonly isActive: boolean;
}

/**
 * Published by the hospital: its corporate clients as other modules sell to them on credit (the pharmacy), so that
 * they never read the hospital tables directly. One company, one limit: what it owes is its unpaid hospital bills and
 * the pharmacy's credit sales together.
 */
export abstract class CorporateAccounts {
  /** The client, locked for a credit until the transaction ends (credits to it never cross); null when none. */
  abstract lockForCredit(clientId: string): Promise<CreditClient | null>;
  /** The client without a lock; null when none. */
  abstract find(clientId: string): Promise<CreditClient | null>;
  /** All the client owes: its unpaid hospital bills and the pharmacy's credit sales (PharmacyCredit). */
  abstract owed(clientId: string): Promise<number>;
  /** Client id → name, for those among `ids` that exist. */
  abstract names(ids: readonly string[]): Promise<Map<string, string>>;
}
