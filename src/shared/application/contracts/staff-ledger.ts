export interface StaffLedgerEntry {
  readonly staffId: string;
  readonly entryDate: string;
  readonly particulars: string;
  /** Owed more. */
  readonly debit: number;
  /** Paid back, recovered or taken off. */
  readonly credit: number;
  readonly reference: string | null;
}

/**
 * Published by payroll: the staff ledger (old Payroll.StaffGlobalLedgers) of what staff owe the units that sell to
 * them on credit (the pharmacy). Payroll recovers it from salary; a counter may take it in cash.
 */
export abstract class StaffLedger {
  /** What the person owes now (a credit is negative), with their ledger locked until the transaction ends. */
  abstract lockBalance(staffId: string): Promise<number>;
  /** What the person owes now, without a lock. */
  abstract balance(staffId: string): Promise<number>;
  abstract post(entry: StaffLedgerEntry): Promise<void>;
}
