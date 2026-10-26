import { ConflictError, DomainError, ForbiddenError } from '../../../shared/domain/errors.js';
import { MAX_QUANTITY, paisa, taka, text } from './documents.js';

export type CountStatus = 'counting' | 'applied' | 'cancelled';

export interface CountLine {
  readonly productId: string;
  readonly lotId: string;
  readonly systemQty: number;
  readonly countedQty: number | null;
  readonly unitCost: number;
  readonly note: string | null;
  readonly appliedSystemQty: number | null;
  readonly adjustedQty: number | null;
}

export interface CountProps {
  id: string;
  number: string;
  outletId: string;
  countDate: string;
  note: string | null;
  status: CountStatus;
  shortageValue: number;
  excessValue: number;
  voucherNumber: string | null;
  cancelReason: string | null;
  createdBy: string | null;
  appliedBy: string | null;
  appliedAt: Date | null;
  lines: CountLine[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A line's move to match the count: units (+ found, − missing) at the lot's cost. */
export interface Adjustment {
  readonly productId: string;
  readonly lotId: string;
  readonly qty: number;
  readonly unitCost: number;
}

export const MAX_COUNT_LINES = 5000;

const validCount = (qty: number, at: string) => {
  if (!Number.isInteger(qty) || qty < 0 || qty > MAX_QUANTITY) {
    throw new DomainError('invalid_quantity', `${at}: a count is a whole number from 0 to ${MAX_QUANTITY}`);
  }
  return qty;
};

/**
 * Old StockAudit (initialize, count, apply), rebuilt after the 2026 forensic review: an outlet's lots counted as of a
 * date; when applied, each lot's deviation is the count less what the ledger holds **as of the count date then**
 * (not a figure frozen when the count was opened: anything dated on or before the count date and entered later is
 * taken into account), moved into **that lot** in one transaction, only when every line is counted.
 */
export class StockCount {
  private constructor(private readonly props: CountProps) {}

  static open(params: {
    id: string;
    number: string;
    outletId: string;
    countDate: string;
    note: string | null;
    lots: readonly { productId: string; lotId: string; qty: number; unitCost: number }[];
    createdBy: string;
    now: Date;
  }): StockCount {
    if (params.lots.length > MAX_COUNT_LINES) {
      throw new DomainError('invalid_lines', `A count has at most ${MAX_COUNT_LINES} lots; count by product group`);
    }
    return new StockCount({
      id: params.id,
      number: params.number,
      outletId: params.outletId,
      countDate: params.countDate,
      note: text(params.note, 1000, 'note', 'Count'),
      status: 'counting',
      shortageValue: 0,
      excessValue: 0,
      voucherNumber: null,
      cancelReason: null,
      createdBy: params.createdBy,
      appliedBy: null,
      appliedAt: null,
      lines: params.lots.map((lot) => ({
        productId: lot.productId,
        lotId: lot.lotId,
        systemQty: Math.max(0, lot.qty),
        countedQty: null,
        unitCost: lot.unitCost,
        note: null,
        appliedSystemQty: null,
        adjustedQty: null,
      })),
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: CountProps): StockCount {
    return new StockCount({ ...props, lines: [...props.lines] });
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
  get countDate(): string {
    return this.props.countDate;
  }
  get status(): CountStatus {
    return this.props.status;
  }
  get lines(): readonly CountLine[] {
    return this.props.lines;
  }

  /** What was counted (lot → units, with an optional note); a count may be corrected until applied. */
  record(counts: readonly { lotId: string; qty: number; note?: string | null }[], now: Date): void {
    this.assertCounting('counted');
    for (const [index, count] of counts.entries()) {
      const at = `Count ${index + 1}`;
      validCount(count.qty, at);
      if (!this.props.lines.some((line) => line.lotId === count.lotId)) {
        throw new DomainError('not_on_count', `${at}: the lot is not on the count; add it first`);
      }
    }
    this.props.lines = this.props.lines.map((line) => {
      const count = counts.find((entry) => entry.lotId === line.lotId);
      if (!count) return line;
      return {
        ...line,
        countedQty: count.qty,
        note: count.note === undefined ? line.note : text(count.note, 300, 'note', 'Count'),
      };
    });
    this.touch(now);
  }

  /** A lot found on the shelf that the count does not list (the ledger may hold none of it). */
  addLot(
    lot: { productId: string; lotId: string; systemQty: number; unitCost: number; countedQty: number },
    now: Date,
  ) {
    this.assertCounting('changed');
    if (this.props.lines.some((line) => line.lotId === lot.lotId)) {
      throw new DomainError('duplicate_line', 'The lot is already on the count');
    }
    if (this.props.lines.length >= MAX_COUNT_LINES) throw new DomainError('invalid_lines', 'The count is full');
    this.props.lines.push({
      productId: lot.productId,
      lotId: lot.lotId,
      systemQty: Math.max(0, lot.systemQty),
      countedQty: validCount(lot.countedQty, 'Count'),
      unitCost: lot.unitCost,
      note: null,
      appliedSystemQty: null,
      adjustedQty: null,
    });
    this.touch(now);
  }

  /**
   * Applies the count against the ledger as of the count date now (\`balances\`: lot → units). Every line must be
   * counted. Whoever opened the count does not apply it. Returns the moves and their values.
   */
  apply(params: { balances: ReadonlyMap<string, number>; by: string; now: Date }) {
    this.assertCounting('applied');
    if (params.by === this.props.createdBy) {
      throw new ForbiddenError('self_approval', 'Someone other than who opened the count applies it');
    }
    const uncounted = this.props.lines.filter((line) => line.countedQty === null).length;
    if (uncounted > 0) throw new DomainError('uncounted_lines', `${uncounted} lots are not counted yet`);
    const adjustments: Adjustment[] = [];
    let shortage = 0;
    let excess = 0;
    this.props.lines = this.props.lines.map((line) => {
      const held = params.balances.get(line.lotId) ?? 0;
      const qty = line.countedQty! - held;
      if (qty !== 0) {
        adjustments.push({ productId: line.productId, lotId: line.lotId, qty, unitCost: line.unitCost });
        const value = paisa(Math.abs(qty) * line.unitCost);
        if (qty < 0) shortage += value;
        else excess += value;
      }
      return { ...line, appliedSystemQty: held, adjustedQty: qty };
    });
    this.props.shortageValue = taka(shortage);
    this.props.excessValue = taka(excess);
    this.props.status = 'applied';
    this.props.appliedBy = params.by;
    this.props.appliedAt = params.now;
    this.touch(params.now);
    return { adjustments, shortage: taka(shortage), excess: taka(excess) };
  }

  applied(voucherNumber: string | null): void {
    this.props.voucherNumber = voucherNumber;
  }

  cancel(reason: string, now: Date): void {
    this.assertCounting('cancelled');
    const why = text(reason, 500, 'reason', 'Count');
    if (!why) throw new DomainError('invalid_remarks', 'Give a reason');
    this.props.cancelReason = why;
    this.props.status = 'cancelled';
    this.touch(now);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_stock_count', 'The count was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<CountProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertCounting(action: string): void {
    if (this.props.status !== 'counting') {
      throw new DomainError('stock_count_state', `An ${this.props.status} count cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}
