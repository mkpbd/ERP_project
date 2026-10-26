import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { MAX_DOCUMENT_LINES, paisa, taka, text, validUnits } from './documents.js';

export type ReturnStatus = 'draft' | 'sent' | 'partly_settled' | 'settled' | 'closed';

export interface ReturnLine {
  readonly productId: string;
  readonly lotId: string;
  readonly qty: number;
  /** The lot's cost at the outlet, frozen when sent. */
  readonly unitCost: number | null;
  readonly value: number | null;
}

export interface ReturnProps {
  id: string;
  number: string;
  outletId: string;
  supplierId: string;
  returnDate: string;
  reason: string;
  status: ReturnStatus;
  value: number;
  settledValue: number;
  sentVoucherNumber: string | null;
  closeReason: string | null;
  lines: ReturnLine[];
  createdBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const required = (value: string, max: number, what: string) => {
  const trimmed = text(value, max, what, 'Return');
  if (!trimmed) throw new DomainError('invalid_text', `Give the ${what}`);
  return trimmed;
};

function validLines(lines: readonly { productId: string; lotId: string; qty: number }[]): ReturnLine[] {
  if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
    throw new DomainError('invalid_lines', `A supplier return has 1 to ${MAX_DOCUMENT_LINES} lines`);
  }
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const at = `Line ${index + 1}`;
    if (seen.has(line.lotId)) throw new DomainError('duplicate_line', `${at}: the lot is already on the return`);
    seen.add(line.lotId);
    return { productId: line.productId, lotId: line.lotId, qty: validUnits(line.qty, at), unitCost: null, value: null };
  });
}

/**
 * Old SupplierReturnIndent with ProcessSupplierReturn and ReceiveSupplierReturn: medicines sent back to a supplier
 * from an outlet, lot by lot. Sending takes them out of stock at the lot's cost and the supplier owes that value;
 * the supplier settles it with replacement goods, in as many parts as needed but never above the value, or the
 * return is closed with the rest left on the supplier's ledger.
 */
export class SupplierReturn {
  private constructor(private readonly props: ReturnProps) {}

  static draft(params: {
    id: string;
    number: string;
    outletId: string;
    supplierId: string;
    returnDate: string;
    reason: string;
    lines: readonly { productId: string; lotId: string; qty: number }[];
    createdBy: string;
    now: Date;
  }): SupplierReturn {
    return new SupplierReturn({
      id: params.id,
      number: params.number,
      outletId: params.outletId,
      supplierId: params.supplierId,
      returnDate: params.returnDate,
      reason: required(params.reason, 500, 'reason'),
      status: 'draft',
      value: 0,
      settledValue: 0,
      sentVoucherNumber: null,
      closeReason: null,
      lines: validLines(params.lines),
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: ReturnProps): SupplierReturn {
    return new SupplierReturn({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get status(): ReturnStatus {
    return this.props.status;
  }
  get outletId(): string {
    return this.props.outletId;
  }
  get supplierId(): string {
    return this.props.supplierId;
  }
  get returnDate(): string {
    return this.props.returnDate;
  }
  get value(): number {
    return this.props.value;
  }
  get lines(): readonly ReturnLine[] {
    return this.props.lines;
  }

  edit(
    changes: {
      returnDate?: string;
      reason?: string;
      lines?: readonly { productId: string; lotId: string; qty: number }[];
    },
    now: Date,
  ): void {
    this.assertDraft('edited');
    if (changes.returnDate) this.props.returnDate = changes.returnDate;
    if (changes.reason !== undefined) this.props.reason = required(changes.reason, 500, 'reason');
    if (changes.lines) this.props.lines = validLines(changes.lines);
    this.touch(now);
  }

  /** Out of stock at each lot's cost (`costs`: lot → unit cost); returns the value the supplier now owes. */
  send(costs: ReadonlyMap<string, number>, voucherNumber: string | null, now: Date): number {
    this.assertDraft('sent');
    this.props.lines = this.props.lines.map((line) => {
      const unitCost = costs.get(line.lotId) ?? 0;
      return { ...line, unitCost, value: taka(paisa(unitCost * line.qty)) };
    });
    this.props.value = taka(this.props.lines.reduce((sum, line) => sum + paisa(line.value ?? 0), 0));
    this.props.status = 'sent';
    this.props.sentVoucherNumber = voucherNumber;
    this.touch(now);
    return this.props.value;
  }

  /** Replacement goods worth `value`; never more than is still owed. */
  settle(value: number, on: string, now: Date): void {
    if (this.props.status !== 'sent' && this.props.status !== 'partly_settled') {
      throw new DomainError(
        'supplier_return_state',
        `A ${this.props.status.replace('_', ' ')} return takes no replacement`,
      );
    }
    if (on < this.props.returnDate) throw new DomainError('invalid_date', 'Nothing is replaced before it was returned');
    const settled = paisa(this.props.settledValue) + paisa(value);
    if (settled > paisa(this.props.value)) {
      const left = taka(paisa(this.props.value) - paisa(this.props.settledValue));
      throw new DomainError('over_settlement', `Only ${left.toFixed(2)} is still owed on the return`);
    }
    this.props.settledValue = taka(settled);
    this.props.status = settled === paisa(this.props.value) ? 'settled' : 'partly_settled';
    this.touch(now);
  }

  /** The rest stays on the supplier's ledger (to be set off against payments). */
  close(reason: string, now: Date): void {
    if (this.props.status !== 'sent' && this.props.status !== 'partly_settled') {
      throw new DomainError('supplier_return_state', 'Only a sent or partly settled return is closed');
    }
    this.props.closeReason = required(reason, 500, 'reason');
    this.props.status = 'closed';
    this.touch(now);
  }

  assertDeletable(): void {
    this.assertDraft('deleted');
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_supplier_return', 'The return was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<ReturnProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertDraft(action: string): void {
    if (this.props.status !== 'draft') {
      throw new DomainError(
        'supplier_return_state',
        `A ${this.props.status.replace('_', ' ')} return cannot be ${action}`,
      );
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}
