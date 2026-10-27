import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { lineDiscount } from './discount.js';
import { MAX_DOCUMENT_LINES, paisa, taka, text, validUnits } from './documents.js';
import type { SalePart } from './sale.js';

const sum = <T>(rows: readonly T[], pick: (row: T) => number) =>
  taka(rows.reduce((total, row) => total + paisa(pick(row)), 0));

export type WardIndentStatus = 'open' | 'issued' | 'cancelled';

export interface WardIndentLine {
  readonly productId: string;
  readonly qty: number;
}

export interface WardIndentProps {
  id: string;
  number: string;
  outletId: string;
  admissionId: string;
  requestedOn: string;
  note: string | null;
  status: WardIndentStatus;
  cancelReason: string | null;
  issueId: string | null;
  requestedBy: string | null;
  closedBy: string | null;
  lines: WardIndentLine[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old IPD medicine indent (nurse station to pharmacy, deleted when the patient left): what a ward asks an outlet to
 * send for an admitted patient. It is answered by one ward issue, or cancelled with a reason.
 */
export class WardIndent {
  private constructor(private readonly props: WardIndentProps) {}

  static raise(params: {
    id: string;
    number: string;
    outletId: string;
    admissionId: string;
    requestedOn: string;
    note: string | null;
    lines: readonly WardIndentLine[];
    by: string;
    now: Date;
  }): WardIndent {
    if (params.lines.length === 0 || params.lines.length > MAX_DOCUMENT_LINES) {
      throw new DomainError('invalid_lines', `An indent has 1 to ${MAX_DOCUMENT_LINES} lines`);
    }
    const seen = new Set<string>();
    params.lines.forEach((line, index) => {
      validUnits(line.qty, `Line ${index + 1}`);
      if (seen.has(line.productId)) {
        throw new DomainError('duplicate_line', `Line ${index + 1}: the product is asked for already`);
      }
      seen.add(line.productId);
    });
    return new WardIndent({
      id: params.id,
      number: params.number,
      outletId: params.outletId,
      admissionId: params.admissionId,
      requestedOn: params.requestedOn,
      note: text(params.note, 300, 'note', 'Indent'),
      status: 'open',
      cancelReason: null,
      issueId: null,
      requestedBy: params.by,
      closedBy: null,
      lines: [...params.lines],
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: WardIndentProps): WardIndent {
    return new WardIndent({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get outletId(): string {
    return this.props.outletId;
  }
  get admissionId(): string {
    return this.props.admissionId;
  }

  issued(issueId: string, by: string, now: Date): void {
    this.assertOpen('issued');
    this.props.status = 'issued';
    this.props.issueId = issueId;
    this.props.closedBy = by;
    this.touch(now);
  }

  cancel(reason: string, by: string, now: Date): void {
    this.assertOpen('cancelled');
    const why = text(reason, 300, 'reason', 'Indent');
    if (!why) throw new DomainError('invalid_remarks', 'Give a reason');
    this.props.status = 'cancelled';
    this.props.cancelReason = why;
    this.props.closedBy = by;
    this.touch(now);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_indent', 'The indent was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<WardIndentProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertOpen(action: string): void {
    if (this.props.status !== 'open') {
      throw new DomainError('indent_state', `An ${this.props.status} indent cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}

export interface WardIssueLine extends SalePart {
  readonly amount: number;
  readonly discount: number;
  readonly total: number;
  readonly returnedQty: number;
}

export interface WardIssueProps {
  id: string;
  number: string;
  outletId: string;
  admissionId: string;
  indentId: string | null;
  issuedOn: string;
  amount: number;
  discount: number;
  total: number;
  returned: number;
  cost: number;
  voucherNumber: string | null;
  issuedBy: string | null;
  lines: WardIssueLine[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A part of a ward return: an issue line (1-based) and the units sent back from it, with what they were charged. */
export interface WardReturnPart {
  readonly issueLine: number;
  readonly productId: string;
  readonly lotId: string;
  readonly qty: number;
  readonly unitCost: number;
  readonly amount: number;
  readonly discount: number;
  readonly total: number;
}

/**
 * Old IPD pharmacy invoice (paid with the final bill; "Medicine(Paid)" when paid at the pharmacy during the stay):
 * medicine sent to a ward for an admitted patient, each lot part at its sale rate less the indoor discount, charged to
 * the admission. Unused medicine sent back before the final bill is taken off the charge.
 */
export class WardIssue {
  private constructor(private readonly props: WardIssueProps) {}

  static make(params: {
    id: string;
    number: string;
    outletId: string;
    admissionId: string;
    indentId: string | null;
    issuedOn: string;
    parts: readonly SalePart[];
    by: string;
    now: Date;
  }): WardIssue {
    if (params.parts.length === 0) throw new DomainError('invalid_lines', 'An issue sends something');
    const lines = params.parts.map((part) => {
      const amount = taka(paisa(part.saleRate * part.qty));
      const discount = lineDiscount(amount, part.discountPercent);
      return { ...part, amount, discount, total: taka(paisa(amount) - paisa(discount)), returnedQty: 0 };
    });
    return new WardIssue({
      id: params.id,
      number: params.number,
      outletId: params.outletId,
      admissionId: params.admissionId,
      indentId: params.indentId,
      issuedOn: params.issuedOn,
      amount: sum(lines, (line) => line.amount),
      discount: sum(lines, (line) => line.discount),
      total: sum(lines, (line) => line.total),
      returned: 0,
      cost: sum(lines, (line) => line.unitCost * line.qty),
      voucherNumber: null,
      issuedBy: params.by,
      lines,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: WardIssueProps): WardIssue {
    return new WardIssue({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get outletId(): string {
    return this.props.outletId;
  }
  get admissionId(): string {
    return this.props.admissionId;
  }
  get amount(): number {
    return this.props.amount;
  }
  get discount(): number {
    return this.props.discount;
  }
  get total(): number {
    return this.props.total;
  }
  get cost(): number {
    return this.props.cost;
  }
  /** What stays charged to the admission. */
  get charged(): number {
    return taka(paisa(this.props.total) - paisa(this.props.returned));
  }
  get lines(): readonly WardIssueLine[] {
    return this.props.lines;
  }

  posted(voucherNumber: string | null): void {
    this.props.voucherNumber = voucherNumber;
  }

  /**
   * Units sent back from issue lines (1-based), never more than issued less what came back before. Each is worth its
   * line's total per unit, so the discount comes back with it and all returns of a line add up to its total.
   */
  giveBack(lines: readonly { line: number; qty: number }[], now: Date) {
    if (lines.length === 0) throw new DomainError('invalid_lines', 'A return sends something back');
    const seen = new Set<number>();
    const parts: WardReturnPart[] = lines.map((entry, index) => {
      const at = `Line ${index + 1}`;
      const line = this.props.lines[entry.line - 1];
      if (!Number.isInteger(entry.line) || !line) {
        throw new DomainError('invalid_line', `${at}: the issue has no line ${entry.line}`);
      }
      if (seen.has(entry.line)) {
        throw new DomainError('duplicate_line', `${at}: issue line ${entry.line} is already sent back here`);
      }
      seen.add(entry.line);
      const left = line.qty - line.returnedQty;
      if (!Number.isInteger(entry.qty) || entry.qty <= 0 || entry.qty > left) {
        throw new DomainError('over_return', `${at}: ${left} of issue line ${entry.line} may still come back`);
      }
      const share = (units: number) => Math.round((paisa(line.total) * units) / line.qty);
      const total = taka(share(line.returnedQty + entry.qty) - share(line.returnedQty));
      const amount = taka(paisa(line.saleRate * entry.qty));
      return {
        issueLine: entry.line,
        productId: line.productId,
        lotId: line.lotId,
        qty: entry.qty,
        unitCost: line.unitCost,
        amount,
        discount: taka(paisa(amount) - paisa(total)),
        total,
      };
    });
    this.props.lines = this.props.lines.map((line, index) => {
      const part = parts.find((entry) => entry.issueLine === index + 1);
      return part ? { ...line, returnedQty: line.returnedQty + part.qty } : line;
    });
    const total = sum(parts, (part) => part.total);
    this.props.returned = taka(paisa(this.props.returned) + paisa(total));
    this.props.version += 1;
    this.props.updatedAt = now;
    return {
      parts,
      amount: sum(parts, (part) => part.amount),
      discount: sum(parts, (part) => part.discount),
      total,
      cost: sum(parts, (part) => part.unitCost * part.qty),
    };
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_issue', 'The issue was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<WardIssueProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }
}
