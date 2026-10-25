/** One line of a voucher posted by another module; the account is a GL code or a configured GL role. */
export interface LedgerPostingLine {
  readonly account: { readonly code: string } | { readonly role: string };
  readonly debit: number;
  readonly credit: number;
  readonly narration?: string | null;
  readonly costCenterId?: string | null;
  readonly subLedgerId?: string | null;
}

export interface LedgerPostingRequest {
  /** Journal type short name, e.g. "SV" for sales. */
  readonly journal: string;
  readonly voucherDate: string;
  readonly narration: string | null;
  /** The posting module and its document (old VoucherMaster.ReferenceId, the HIS invoice). */
  readonly source: { readonly module: string; readonly reference: string };
  readonly lines: readonly LedgerPostingLine[];
  /** The user the posting is done for, if any. */
  readonly postedBy: string | null;
}

/**
 * Published by the accounts module: other modules (pharmacy, billing, payroll) post balanced vouchers
 * through it, inside their own transaction. Throws DomainError when the voucher is not balanced, an
 * account or role is unknown, or the date falls in no open fiscal year.
 */
export abstract class LedgerPosting {
  abstract post(request: LedgerPostingRequest): Promise<{ voucherId: string; number: string }>;
}
