import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { paisa, taka, validQuantity } from './documents.js';
import { validMoveLines, type MoveLine } from './store-documents.js';

export type SupplierReturnStatus = 'draft' | 'sent' | 'settled';

export interface ReturnLine extends MoveLine {
  /** Average cost of the lots that went back (set when sent). */
  readonly unitCost: number | null;
  /** Taken back by the supplier as replacement or repair (set when settled). */
  readonly receivedQty: number | null;
  /** The product received instead, if not the same one (old ReturnBrandExtentionId). */
  readonly replacementVariantId: string | null;
  readonly replacementBatchNo: string | null;
  readonly replacementExpiryDate: string | null;
}

export interface SupplierReturnProps {
  id: string;
  number: string;
  mainStoreId: string;
  supplierId: string;
  returnDate: string;
  reason: string;
  status: SupplierReturnStatus;
  lines: ReturnLine[];
  sentVoucherId: string | null;
  sentVoucherNumber: string | null;
  gatePassId: string | null;
  settledOn: string | null;
  settledVoucherId: string | null;
  settledVoucherNumber: string | null;
  createdBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettleLine {
  readonly receivedQty: number;
  readonly replacementVariantId: string | null;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
}

const blankLine = (line: MoveLine): ReturnLine => ({
  ...line,
  unitCost: null,
  receivedQty: null,
  replacementVariantId: null,
  replacementBatchNo: null,
  replacementExpiryDate: null,
});

/**
 * Old SCMSupplierReturnIndent (RetStatus 1 → 9 → 18): goods sent back to a supplier from a main store, and
 * what the supplier sends in their place. Sending takes the lots out of the store and posts a debit note to
 * the supplier; settling takes in what came back (the same product or a replacement, at the cost of what was
 * returned) and reverses that part of the debit note. The old return took no lot, never touched the supplier
 * ledger or accounts, and showed both later statuses as "On Hold".
 */
export class SupplierReturn {
  private constructor(private readonly props: SupplierReturnProps) {}

  static draft(params: {
    id: string;
    number: string;
    mainStoreId: string;
    supplierId: string;
    returnDate: string;
    reason: string;
    lines: readonly MoveLine[];
    createdBy: string;
    now: Date;
  }): SupplierReturn {
    return new SupplierReturn({
      id: params.id,
      number: params.number,
      mainStoreId: params.mainStoreId,
      supplierId: params.supplierId,
      returnDate: params.returnDate,
      reason: validReason(params.reason),
      status: 'draft',
      lines: validMoveLines(params.lines, 'supplier return').map(blankLine),
      sentVoucherId: null,
      sentVoucherNumber: null,
      gatePassId: null,
      settledOn: null,
      settledVoucherId: null,
      settledVoucherNumber: null,
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: SupplierReturnProps): SupplierReturn {
    return new SupplierReturn({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get status(): SupplierReturnStatus {
    return this.props.status;
  }
  get mainStoreId(): string {
    return this.props.mainStoreId;
  }
  get supplierId(): string {
    return this.props.supplierId;
  }
  get returnDate(): string {
    return this.props.returnDate;
  }
  get lines(): readonly ReturnLine[] {
    return this.props.lines;
  }

  edit(changes: { returnDate?: string; reason?: string; lines?: readonly MoveLine[] }, now: Date): void {
    this.assertStatus('draft', 'edited');
    if (changes.returnDate) this.props.returnDate = changes.returnDate;
    if (changes.reason !== undefined) this.props.reason = validReason(changes.reason);
    if (changes.lines) this.props.lines = validMoveLines(changes.lines, 'supplier return').map(blankLine);
    this.touch(now);
  }

  /** `unitCosts`: the average cost of what each line took out of the store. */
  send(params: {
    unitCosts: readonly number[];
    voucher: { id: string; number: string } | null;
    gatePassId: string;
    now: Date;
  }): void {
    this.assertStatus('draft', 'sent');
    this.props.lines = this.props.lines.map((line, index) => ({ ...line, unitCost: params.unitCosts[index] ?? 0 }));
    this.props.status = 'sent';
    this.props.sentVoucherId = params.voucher?.id ?? null;
    this.props.sentVoucherNumber = params.voucher?.number ?? null;
    this.props.gatePassId = params.gatePassId;
    this.touch(params.now);
  }

  /** What the supplier owes for the returned goods, at their cost. */
  sentValue(): number {
    return taka(this.props.lines.reduce((sum, line) => sum + paisa((line.unitCost ?? 0) * line.qty), 0));
  }

  /**
   * Records what came back for each line (0 when nothing; never more than was sent). Returns the value taken
   * back, at the cost of what was returned.
   */
  settle(params: { lines: readonly SettleLine[]; on: string; now: Date }): number {
    this.assertStatus('sent', 'settled');
    if (params.on < this.props.returnDate)
      throw new DomainError('invalid_date', 'Nothing comes back before it was sent');
    if (params.lines.length !== this.props.lines.length) {
      throw new DomainError('invalid_lines', 'Give what came back for every line of the return');
    }
    this.props.lines = this.props.lines.map((line, index) => {
      const back = params.lines[index]!;
      validQuantity(back.receivedQty, `Line ${index + 1}`, true);
      if (back.receivedQty > line.qty) {
        throw new DomainError('receive_exceeds_return', `Line ${index + 1}: more came back than was sent`);
      }
      return {
        ...line,
        receivedQty: back.receivedQty,
        replacementVariantId: back.replacementVariantId === line.variantId ? null : back.replacementVariantId,
        replacementBatchNo: back.batchNo?.trim() || null,
        replacementExpiryDate: back.expiryDate,
      };
    });
    this.props.status = 'settled';
    this.props.settledOn = params.on;
    this.touch(params.now);
    return taka(this.props.lines.reduce((sum, line) => sum + paisa((line.unitCost ?? 0) * (line.receivedQty ?? 0)), 0));
  }

  setSettlementVoucher(voucher: { id: string; number: string } | null): void {
    this.props.settledVoucherId = voucher?.id ?? null;
    this.props.settledVoucherNumber = voucher?.number ?? null;
  }

  assertDeletable(): void {
    this.assertStatus('draft', 'deleted');
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_supplier_return', 'The return was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<SupplierReturnProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertStatus(status: SupplierReturnStatus, action: string): void {
    if (this.props.status !== status) {
      throw new DomainError('supplier_return_state', `A ${this.props.status} return cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}

function validReason(reason: string): string {
  const text = reason.trim();
  if (text.length === 0 || text.length > 500) {
    throw new DomainError('invalid_reason', 'Give the reason for the return (1-500 characters)');
  }
  return text;
}
