export interface SupplierSummary {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly isActive: boolean;
  /** The supplier's own payable account, if any (else the `supplier_payable` GL role). */
  readonly glAccountId: string | null;
  /** The supplier's party sub-ledger in accounts. */
  readonly subLedgerId: string | null;
}

/**
 * Read-only view of the suppliers published by the supply chain module, so that the pharmacy (which buys from
 * the same suppliers) never reads the supply chain tables directly.
 */
export abstract class SupplierDirectory {
  /** The suppliers that exist among `ids`, in no particular order. */
  abstract find(ids: readonly string[]): Promise<SupplierSummary[]>;
}
