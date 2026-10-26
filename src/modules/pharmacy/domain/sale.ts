import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { MAX_AMOUNT, paisa, taka, text } from './documents.js';
import { lineDiscount } from './discount.js';

export type PaymentMethod = 'cash' | 'card' | 'mobile';
export type SaleStatus = 'completed' | 'cancelled';

/** A lot part of a sale line, as allocated. */
export interface SalePart {
  readonly productId: string;
  readonly lotId: string;
  readonly qty: number;
  readonly saleRate: number;
  readonly unitCost: number;
  readonly discountPercent: number;
}

export interface SaleLine extends SalePart {
  readonly amount: number;
  readonly discount: number;
  readonly total: number;
  /** Units given back by returns. */
  readonly returnedQty: number;
}

/** A part of a return: a sale line (1-based) and the units given back from it, with what they are worth. */
export interface ReturnedPart {
  readonly saleLine: number;
  readonly productId: string;
  readonly lotId: string;
  readonly qty: number;
  readonly saleRate: number;
  readonly unitCost: number;
  readonly amount: number;
  readonly discount: number;
  readonly refund: number;
  /** Damaged or expired: written off, not put back into stock. */
  readonly damaged: boolean;
}

export interface SaleProps {
  id: string;
  number: string;
  outletId: string;
  soldOn: string;
  customerName: string | null;
  mobileNo: string | null;
  loyalMemberId: string | null;
  amount: number;
  discount: number;
  total: number;
  method: PaymentMethod;
  reference: string | null;
  tendered: number;
  paid: number;
  due: number;
  collected: number;
  returned: number;
  dueReturned: number;
  cost: number;
  status: SaleStatus;
  cancelReason: string | null;
  cancelledOn: string | null;
  voucherNumber: string | null;
  cancelVoucherNumber: string | null;
  soldBy: string | null;
  cancelledBy: string | null;
  lines: SaleLine[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const sum = <T>(rows: readonly T[], pick: (row: T) => number) =>
  taka(rows.reduce((total, row) => total + paisa(pick(row)), 0));

/**
 * Old pharmacy OPD invoice (CreatePharmacySale): medicines sold over the counter from an outlet, each lot part at
 * its sale rate less the product's discount. What the customer hands over pays it (cash may be more: the rest is
 * change); what is left unpaid is a due, allowed only for a loyal member. A sale with nothing collected against
 * its due may be cancelled; returns of some units come in step 8f.
 */
export class PharmacySale {
  private constructor(private readonly props: SaleProps) {}

  static make(params: {
    id: string;
    number: string;
    outletId: string;
    soldOn: string;
    customerName: string | null;
    mobileNo: string | null;
    loyalMemberId: string | null;
    parts: readonly SalePart[];
    method: PaymentMethod;
    reference: string | null;
    tendered: number;
    soldBy: string;
    now: Date;
  }): PharmacySale {
    if (params.parts.length === 0) throw new DomainError('invalid_lines', 'A sale sells something');
    if (!Number.isFinite(params.tendered) || params.tendered < 0 || params.tendered > MAX_AMOUNT) {
      throw new DomainError('invalid_amount', 'What is paid is 0 or more');
    }
    const lines = params.parts.map((part) => {
      const amount = taka(paisa(part.saleRate * part.qty));
      const discount = lineDiscount(amount, part.discountPercent);
      return { ...part, amount, discount, total: taka(paisa(amount) - paisa(discount)), returnedQty: 0 };
    });
    const total = sum(lines, (line) => line.total);
    const tendered = taka(paisa(params.tendered));
    const paid = Math.min(tendered, total);
    if (params.method !== 'cash' && tendered > total) {
      throw new DomainError('overpaid', 'Only cash is handed over beyond the total');
    }
    const due = taka(paisa(total) - paisa(paid));
    if (due > 0 && !params.loyalMemberId) {
      throw new DomainError('due_needs_member', 'Only a loyal member may leave a due');
    }
    const mobileNo = text(params.mobileNo, 20, 'mobile number', 'Sale');
    return new PharmacySale({
      id: params.id,
      number: params.number,
      outletId: params.outletId,
      soldOn: params.soldOn,
      customerName: text(params.customerName, 150, 'customer name', 'Sale'),
      mobileNo,
      loyalMemberId: params.loyalMemberId,
      amount: sum(lines, (line) => line.amount),
      discount: sum(lines, (line) => line.discount),
      total,
      method: params.method,
      reference: text(params.reference, 100, 'reference', 'Sale'),
      tendered,
      paid,
      due,
      collected: 0,
      returned: 0,
      dueReturned: 0,
      cost: sum(lines, (line) => line.unitCost * line.qty),
      status: 'completed',
      cancelReason: null,
      cancelledOn: null,
      voucherNumber: null,
      cancelVoucherNumber: null,
      soldBy: params.soldBy,
      cancelledBy: null,
      lines,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: SaleProps): PharmacySale {
    return new PharmacySale({ ...props, lines: [...props.lines] });
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
  get soldOn(): string {
    return this.props.soldOn;
  }
  get loyalMemberId(): string | null {
    return this.props.loyalMemberId;
  }
  get method(): PaymentMethod {
    return this.props.method;
  }
  /** Gross: units × sale rate. */
  get amount(): number {
    return this.props.amount;
  }
  get discount(): number {
    return this.props.discount;
  }
  get total(): number {
    return this.props.total;
  }
  get paid(): number {
    return this.props.paid;
  }
  get due(): number {
    return this.props.due;
  }
  get cost(): number {
    return this.props.cost;
  }
  /** Change handed back. */
  get change(): number {
    return taka(paisa(this.props.tendered) - paisa(this.props.paid));
  }
  get lines(): readonly SaleLine[] {
    return this.props.lines;
  }

  posted(voucherNumber: string | null): void {
    this.props.voucherNumber = voucherNumber;
  }

  cancel(params: { reason: string; on: string; by: string; now: Date }): void {
    if (this.props.status !== 'completed') throw new DomainError('sale_state', 'The sale is cancelled already');
    if (this.props.collected > 0) {
      throw new DomainError('sale_state', 'Dues were collected against the sale; return its medicines instead');
    }
    if (this.props.returned > 0 || this.props.lines.some((line) => line.returnedQty > 0)) {
      throw new DomainError('sale_state', 'Medicines were returned from the sale; return the rest instead');
    }
    if (params.on < this.props.soldOn)
      throw new DomainError('invalid_date', 'A sale is not cancelled before it was made');
    const reason = text(params.reason, 500, 'reason', 'Sale');
    if (!reason) throw new DomainError('invalid_remarks', 'Give a reason');
    this.props.status = 'cancelled';
    this.props.cancelReason = reason;
    this.props.cancelledOn = params.on;
    this.props.cancelledBy = params.by;
    this.props.version += 1;
    this.props.updatedAt = params.now;
  }

  /**
   * Medicines given back (old ProcessOpdProductReturn): units of sale lines (1-based), never more than sold less what
   * came back before. Each is worth its line's total per unit, so the discount given comes back with it. The refund
   * takes the sale's open due down first; the rest is paid back. Units marked damaged (or expired) are refunded all
   * the same but written off at cost instead of going back into stock. Returns the parts and how the refund splits.
   */
  giveBack(lines: readonly { line: number; qty: number; damaged?: boolean }[], now: Date) {
    if (this.props.status !== 'completed') throw new DomainError('sale_state', 'A cancelled sale takes no returns');
    if (lines.length === 0) throw new DomainError('invalid_lines', 'A return gives something back');
    const seen = new Set<number>();
    const parts: ReturnedPart[] = lines.map((entry, index) => {
      const at = `Line ${index + 1}`;
      const line = this.props.lines[entry.line - 1];
      if (!Number.isInteger(entry.line) || !line)
        throw new DomainError('invalid_line', `${at}: the sale has no line ${entry.line}`);
      if (seen.has(entry.line))
        throw new DomainError('duplicate_line', `${at}: sale line ${entry.line} is already given back here`);
      seen.add(entry.line);
      const left = line.qty - line.returnedQty;
      if (!Number.isInteger(entry.qty) || entry.qty <= 0 || entry.qty > left) {
        throw new DomainError('over_return', `${at}: ${left} of sale line ${entry.line} may still come back`);
      }
      // The line's share up to these units less its share before them: all returns of a line add up to its total.
      const share = (units: number) => Math.round((paisa(line.total) * units) / line.qty);
      const refund = taka(share(line.returnedQty + entry.qty) - share(line.returnedQty));
      const amount = taka(paisa(line.saleRate * entry.qty));
      return {
        saleLine: entry.line,
        productId: line.productId,
        lotId: line.lotId,
        qty: entry.qty,
        saleRate: line.saleRate,
        unitCost: line.unitCost,
        amount,
        discount: taka(paisa(amount) - paisa(refund)),
        refund,
        damaged: entry.damaged ?? false,
      };
    });
    this.props.lines = this.props.lines.map((line, index) => {
      const part = parts.find((entry) => entry.saleLine === index + 1);
      return part ? { ...line, returnedQty: line.returnedQty + part.qty } : line;
    });
    const refund = sum(parts, (part) => part.refund);
    const openDue = paisa(this.props.due) - paisa(this.props.collected) - paisa(this.props.dueReturned);
    const dueReduced = taka(Math.min(paisa(refund), Math.max(0, openDue)));
    this.props.returned = taka(paisa(this.props.returned) + paisa(refund));
    this.props.dueReturned = taka(paisa(this.props.dueReturned) + paisa(dueReduced));
    this.props.version += 1;
    this.props.updatedAt = now;
    return {
      parts,
      amount: sum(parts, (part) => part.amount),
      discount: sum(parts, (part) => part.discount),
      refund,
      dueReduced,
      paidBack: taka(paisa(refund) - paisa(dueReduced)),
      cost: sum(parts, (part) => part.unitCost * part.qty),
      damagedCost: sum(
        parts.filter((part) => part.damaged),
        (part) => part.unitCost * part.qty,
      ),
    };
  }

  /** A seller may undo their own sale, dated the day it was made, within a day of making it. */
  isOwnSameDay(userId: string, on: string, now: Date): boolean {
    return (
      this.props.soldBy === userId &&
      on === this.props.soldOn &&
      now.getTime() - this.props.createdAt.getTime() <= 24 * 60 * 60 * 1000
    );
  }

  cancelPosted(voucherNumber: string | null): void {
    this.props.cancelVoucherNumber = voucherNumber;
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_sale', 'The sale was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<SaleProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }
}

/** What is still owed on a loyal member's sale. */
export interface SaleDue {
  readonly saleId: string;
  readonly soldOn: string;
  readonly number: string;
  readonly due: number;
  /** Collected, and taken down by returns: what is no longer owed. */
  readonly collected: number;
}

/**
 * Old loyal member due collection: an amount paid against the member's dues, oldest sale first, never more than
 * all of them. Returns the part of the amount that goes to each sale.
 */
export function allocateCollection(amount: number, dues: readonly SaleDue[]): { saleId: string; amount: number }[] {
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) {
    throw new DomainError('invalid_amount', 'Collect more than 0, in taka and paisa');
  }
  const owed = dues
    .map((due) => ({ ...due, left: paisa(due.due) - paisa(due.collected) }))
    .filter((due) => due.left > 0)
    .sort((a, b) => a.soldOn.localeCompare(b.soldOn) || a.number.localeCompare(b.number));
  const total = owed.reduce((sum, due) => sum + due.left, 0);
  let left = paisa(amount);
  if (left > total) throw new DomainError('overpayment', `Only ${taka(total).toFixed(2)} is due from the member`);
  const parts: { saleId: string; amount: number }[] = [];
  for (const due of owed) {
    if (left <= 0) break;
    const take = Math.min(left, due.left);
    parts.push({ saleId: due.saleId, amount: taka(take) });
    left -= take;
  }
  return parts;
}
