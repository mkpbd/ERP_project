import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { MAX_DOCUMENT_LINES, text, validUnits } from './documents.js';

export type IndentStatus = 'open' | 'partly_transferred' | 'transferred' | 'closed' | 'cancelled';

export interface IndentLine {
  readonly productId: string;
  readonly qty: number;
  readonly transferredQty: number;
}

export interface IndentProps {
  id: string;
  number: string;
  requestingOutletId: string;
  supplyingOutletId: string;
  indentDate: string;
  urgent: boolean;
  note: string | null;
  status: IndentStatus;
  closeReason: string | null;
  lines: IndentLine[];
  createdBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function validLines(lines: readonly { productId: string; qty: number }[]): IndentLine[] {
  if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
    throw new DomainError('invalid_lines', `An outlet indent has 1 to ${MAX_DOCUMENT_LINES} lines`);
  }
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const at = `Line ${index + 1}`;
    if (seen.has(line.productId)) throw new DomainError('duplicate_line', `${at}: the product is already asked for`);
    seen.add(line.productId);
    return { productId: line.productId, qty: validUnits(line.qty, at), transferredQty: 0 };
  });
}

const required = (value: string) => {
  const reason = text(value, 500, 'reason', 'Indent');
  if (!reason) throw new DomainError('invalid_remarks', 'Give a reason');
  return reason;
};

/**
 * Old OutletIndent: an outlet asks another for products. Transfers against it send up to what was asked; it is
 * transferred in full, or closed with what came; an indent nothing was sent against may be edited or cancelled.
 */
export class OutletIndent {
  private constructor(private readonly props: IndentProps) {}

  static raise(params: {
    id: string;
    number: string;
    requestingOutletId: string;
    supplyingOutletId: string;
    indentDate: string;
    urgent: boolean;
    note: string | null;
    lines: readonly { productId: string; qty: number }[];
    createdBy: string;
    now: Date;
  }): OutletIndent {
    if (params.requestingOutletId === params.supplyingOutletId) {
      throw new DomainError('same_outlet', 'An outlet does not indent from itself');
    }
    return new OutletIndent({
      id: params.id,
      number: params.number,
      requestingOutletId: params.requestingOutletId,
      supplyingOutletId: params.supplyingOutletId,
      indentDate: params.indentDate,
      urgent: params.urgent,
      note: text(params.note, 1000, 'note', 'Indent'),
      status: 'open',
      closeReason: null,
      lines: validLines(params.lines),
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: IndentProps): OutletIndent {
    return new OutletIndent({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get status(): IndentStatus {
    return this.props.status;
  }
  get requestingOutletId(): string {
    return this.props.requestingOutletId;
  }
  get supplyingOutletId(): string {
    return this.props.supplyingOutletId;
  }
  get lines(): readonly IndentLine[] {
    return this.props.lines;
  }

  edit(
    changes: { urgent?: boolean; note?: string | null; lines?: readonly { productId: string; qty: number }[] },
    now: Date,
  ): void {
    this.assertUntouched('edited');
    if (changes.urgent !== undefined) this.props.urgent = changes.urgent;
    if (changes.note !== undefined) this.props.note = text(changes.note, 1000, 'note', 'Indent');
    if (changes.lines) this.props.lines = validLines(changes.lines);
    this.touch(now);
  }

  /** What a transfer sends against the indent (product → units); never more than was asked for. */
  transfer(quantities: ReadonlyMap<string, number>, now: Date): void {
    if (this.props.status !== 'open' && this.props.status !== 'partly_transferred') {
      throw new DomainError(
        'outlet_indent_state',
        `A ${this.props.status.replace('_', ' ')} indent takes no transfers`,
      );
    }
    for (const [productId, qty] of quantities) {
      const line = this.props.lines.find((entry) => entry.productId === productId);
      if (!line) throw new DomainError('not_indented', 'A product sent is not on the indent');
      if (line.transferredQty + qty > line.qty) {
        throw new DomainError('over_transfer', `More is sent than asked for (${line.qty - line.transferredQty} left)`);
      }
    }
    this.props.lines = this.props.lines.map((line) => ({
      ...line,
      transferredQty: line.transferredQty + (quantities.get(line.productId) ?? 0),
    }));
    this.props.status = this.props.lines.every((line) => line.transferredQty === line.qty)
      ? 'transferred'
      : 'partly_transferred';
    this.touch(now);
  }

  /** A rejected transfer gives its quantities back to the indent. */
  untransfer(quantities: ReadonlyMap<string, number>, now: Date): void {
    this.props.lines = this.props.lines.map((line) => ({
      ...line,
      transferredQty: Math.max(0, line.transferredQty - (quantities.get(line.productId) ?? 0)),
    }));
    if (this.props.status === 'transferred' || this.props.status === 'partly_transferred') {
      this.props.status = this.props.lines.some((line) => line.transferredQty > 0) ? 'partly_transferred' : 'open';
    }
    this.touch(now);
  }

  cancel(reason: string, now: Date): void {
    this.assertUntouched('cancelled');
    this.props.closeReason = required(reason);
    this.props.status = 'cancelled';
    this.touch(now);
  }

  close(reason: string, now: Date): void {
    if (this.props.status !== 'partly_transferred') {
      throw new DomainError('outlet_indent_state', 'Only a partly transferred indent is closed');
    }
    this.props.closeReason = required(reason);
    this.props.status = 'closed';
    this.touch(now);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_outlet_indent', 'The indent was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<IndentProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertUntouched(action: string): void {
    if (this.props.status !== 'open' || this.props.lines.some((line) => line.transferredQty > 0)) {
      throw new DomainError('outlet_indent_state', `An indent stock was sent against cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}
