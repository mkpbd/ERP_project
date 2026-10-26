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
      return { ...part, amount, discount, total: taka(paisa(amount) - paisa(discount)) };
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
