import type { Book, PostableAccount, Voucher } from './voucher.js';

export interface JournalInfo {
  readonly id: string;
  readonly shortName: string;
  readonly book: Book;
}

export interface FiscalYearInfo {
  readonly id: string;
  readonly label: string;
  readonly isClosed: boolean;
}

export interface VoucherAttachmentInfo {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly uploadedAt: Date;
}

export interface StoredAttachment {
  readonly fileName: string;
  readonly contentType: string;
  readonly data: Uint8Array;
}

export abstract class VoucherRepository {
  /** Locks the voucher row until the transaction ends. */
  abstract findForUpdate(id: string): Promise<Voucher | null>;
  /** Throws NotFoundError for a missing journal type, cost centre, sub-ledger or service unit. */
  abstract insert(voucher: Voucher): Promise<void>;
  abstract update(voucher: Voucher): Promise<void>;
  abstract delete(id: string): Promise<void>;
  /** The next serial of a journal type in a fiscal year (locks the counter until the transaction ends). */
  abstract nextSerial(journalTypeId: string, fiscalYearId: string): Promise<number>;
  abstract addAttachment(attachment: {
    id: string;
    voucherId: string;
    fileName: string;
    contentType: string;
    data: Uint8Array;
    uploadedBy: string;
    now: Date;
  }): Promise<void>;
  abstract listAttachments(voucherId: string): Promise<VoucherAttachmentInfo[]>;
  abstract findAttachment(voucherId: string, attachmentId: string): Promise<StoredAttachment | null>;
  abstract removeAttachment(voucherId: string, attachmentId: string): Promise<boolean>;
}

/** Facts about the chart of accounts that posting needs. */
export abstract class LedgerFacts {
  abstract accounts(ids: readonly string[]): Promise<Map<string, PostableAccount>>;
  abstract accountIdsByCode(codes: readonly string[]): Promise<Map<string, string>>;
  abstract accountIdsByRole(roles: readonly string[]): Promise<Map<string, string>>;
  abstract fiscalYearOn(date: string): Promise<FiscalYearInfo | null>;
  abstract journalType(id: string): Promise<JournalInfo | null>;
  abstract journalTypeByShortName(shortName: string): Promise<JournalInfo | null>;
}
