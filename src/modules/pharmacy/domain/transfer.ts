import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { text } from './documents.js';

export type TransferStatus = 'in_transit' | 'accepted' | 'rejected';

export interface TransferLine {
  readonly productId: string;
  readonly lotId: string;
  readonly qty: number;
  readonly unitCost: number;
  /** Sent back by the receiving outlet (old per-line accept). */
  readonly rejected: boolean;
}

export interface TransferProps {
  id: string;
  number: string;
  indentId: string | null;
  fromOutletId: string;
  toOutletId: string;
  transferDate: string;
  note: string | null;
  status: TransferStatus;
  decidedOn: string | null;
  decidedBy: string | null;
  rejectReason: string | null;
  lines: TransferLine[];
  createdBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old StockTransfer (ProcessStockTransfer) and its accept (ProcessAcceptOutletTransfer): stock leaves the sending
 * outlet by lot when sent and is in transit until the receiving outlet accepts it into the same lots at the same
 * cost, or rejects it back to the sender; lines may be sent back one by one.
 */
export class OutletTransfer {
  private constructor(private readonly props: TransferProps) {}

  static send(params: {
    id: string;
    number: string;
    indentId: string | null;
    fromOutletId: string;
    toOutletId: string;
    transferDate: string;
    note: string | null;
    lines: readonly Omit<TransferLine, 'rejected'>[];
    createdBy: string;
    now: Date;
  }): OutletTransfer {
    if (params.fromOutletId === params.toOutletId) {
      throw new DomainError('same_outlet', 'An outlet does not transfer to itself');
    }
    if (params.lines.length === 0) throw new DomainError('invalid_lines', 'A transfer sends something');
    return new OutletTransfer({
      ...params,
      note: text(params.note, 1000, 'note', 'Transfer'),
      status: 'in_transit',
      decidedOn: null,
      decidedBy: null,
      rejectReason: null,
      lines: params.lines.map((line) => ({ ...line, rejected: false })),
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: TransferProps): OutletTransfer {
    return new OutletTransfer({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get status(): TransferStatus {
    return this.props.status;
  }
  get indentId(): string | null {
    return this.props.indentId;
  }
  get fromOutletId(): string {
    return this.props.fromOutletId;
  }
  get toOutletId(): string {
    return this.props.toOutletId;
  }
  get lines(): readonly TransferLine[] {
    return this.props.lines;
  }

  /** Product → units sent (or, with `rejected`, only those sent back). */
  quantities(rejected?: boolean): Map<string, number> {
    const quantities = new Map<string, number>();
    for (const line of this.props.lines) {
      if (rejected !== undefined && line.rejected !== rejected) continue;
      quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.qty);
    }
    return quantities;
  }

  /**
   * Accepts the transfer, sending back the lines numbered in `rejectLines` (1-based; a reason is then needed).
   * Something must be kept, or the whole transfer is rejected instead.
   */
  accept(params: { on: string; by: string; rejectLines: readonly number[]; reason: string | null; now: Date }): void {
    this.assertInTransit();
    for (const line of params.rejectLines) {
      if (!Number.isInteger(line) || line < 1 || line > this.props.lines.length) {
        throw new DomainError('invalid_line', `There is no line ${line} on the transfer`);
      }
    }
    if (params.rejectLines.length > 0) {
      if (new Set(params.rejectLines).size === this.props.lines.length) {
        throw new DomainError('nothing_accepted', 'Keep at least one line, or reject the transfer');
      }
      const reason = text(params.reason, 500, 'reason', 'Transfer');
      if (!reason) throw new DomainError('invalid_remarks', 'Give a reason for the lines sent back');
      this.props.rejectReason = reason;
    }
    this.props.lines = this.props.lines.map((line, index) =>
      params.rejectLines.includes(index + 1) ? { ...line, rejected: true } : line,
    );
    this.decide(params.on, params.by, params.now);
    this.props.status = 'accepted';
  }

  reject(params: { on: string; by: string; reason: string; now: Date }): void {
    this.assertInTransit();
    const reason = text(params.reason, 500, 'reason', 'Transfer');
    if (!reason) throw new DomainError('invalid_remarks', 'Give a reason');
    this.decide(params.on, params.by, params.now);
    this.props.status = 'rejected';
    this.props.rejectReason = reason;
    this.props.lines = this.props.lines.map((line) => ({ ...line, rejected: true }));
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_transfer', 'The transfer was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<TransferProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertInTransit(): void {
    if (this.props.status !== 'in_transit') {
      throw new DomainError('transfer_state', `An ${this.props.status} transfer is decided already`);
    }
  }

  private decide(on: string, by: string, now: Date): void {
    this.assertInTransit();
    if (on < this.props.transferDate) throw new DomainError('invalid_date', 'Nothing arrives before it was sent');
    this.props.decidedOn = on;
    this.props.decidedBy = by;
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}
