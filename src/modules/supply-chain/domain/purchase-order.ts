import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { paisa, taka, validAmount, validLineSet, validPercent, validQuantity } from './documents.js';

export type OrderStatus = 'open' | 'partially_received' | 'received' | 'closed' | 'cancelled';

export interface OrderLineInput {
  readonly variantId: string;
  readonly qty: number;
  /** Agreed rate, kept on the order (the old order showed the item's latest purchase price instead). */
  readonly rate: number;
  readonly vatPercent: number;
}

export interface OrderLine extends OrderLineInput {
  /** Received on posted stock receives (step 7c). */
  readonly receivedQty: number;
}

export interface OrderHeader {
  readonly supplierId: string;
  readonly mainStoreId: string;
  readonly requisitionId: string | null;
  readonly comparativeStudyId: string | null;
  readonly orderDate: string;
  readonly expectedOn: string | null;
  readonly terms: string | null;
  readonly note: string | null;
}

export interface OrderProps extends OrderHeader {
  id: string;
  number: string;
  status: OrderStatus;
  lines: OrderLine[];
  cancelReason: string | null;
  createdBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** What an approved requisition allows: variant → approved quantity, less what other orders already take. */
export type OrderAllowance = ReadonlyMap<string, number>;

/** Line amount: rate × quantity plus VAT on it, each to the paisa. */
export function orderLineAmounts(line: Pick<OrderLineInput, 'qty' | 'rate' | 'vatPercent'>) {
  const base = paisa(line.rate * line.qty);
  const vat = Math.round((base * line.vatPercent) / 100);
  return { amount: taka(base), vat: taka(vat), total: taka(base + vat) };
}

export function orderTotals(lines: readonly OrderLineInput[]) {
  const sums = lines.map(orderLineAmounts).reduce(
    (sum, line) => ({
      amount: sum.amount + paisa(line.amount),
      vat: sum.vat + paisa(line.vat),
      total: sum.total + paisa(line.total),
    }),
    { amount: 0, vat: 0, total: 0 },
  );
  return { amount: taka(sums.amount), vat: taka(sums.vat), total: taka(sums.total) };
}

function validLines(lines: readonly OrderLineInput[], allowance: OrderAllowance | null): OrderLine[] {
  return validLineSet(lines, (line) => line.variantId, 'purchase order').map((line, index) => {
    const at = `Line ${index + 1}`;
    validQuantity(line.qty, at);
    validAmount(line.rate, at);
    validPercent(line.vatPercent, at);
    if (allowance) {
      const left = allowance.get(line.variantId);
      if (left === undefined) throw new DomainError('not_on_requisition', `${at}: the item is not on the requisition`);
      if (line.qty > left + 1e-9) {
        throw new DomainError('order_exceeds_requisition', `${at}: only ${left} is approved and not yet ordered`);
      }
    }
    return { ...line, receivedQty: 0 };
  });
}

/**
 * Old PurchaseOrder: one per approved requisition (enforced only by the screen). Here a requisition may be
 * split among suppliers, but all its orders together stay within the approved quantities. Orders are
 * edited or cancelled until something is received.
 */
export class PurchaseOrder {
  private constructor(private readonly props: OrderProps) {}

  static open(params: {
    id: string;
    number: string;
    header: OrderHeader;
    lines: readonly OrderLineInput[];
    allowance: OrderAllowance | null;
    createdBy: string;
    now: Date;
  }): PurchaseOrder {
    return new PurchaseOrder({
      id: params.id,
      number: params.number,
      ...params.header,
      status: 'open',
      lines: validLines(params.lines, params.allowance),
      cancelReason: null,
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: OrderProps): PurchaseOrder {
    return new PurchaseOrder({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get status(): OrderStatus {
    return this.props.status;
  }
  get requisitionId(): string | null {
    return this.props.requisitionId;
  }
  get lines(): readonly OrderLine[] {
    return this.props.lines;
  }

  /** `allowance` excludes this order's own lines. */
  edit(
    changes: {
      header?: Partial<Pick<OrderHeader, 'orderDate' | 'expectedOn' | 'terms' | 'note'>>;
      lines?: readonly OrderLineInput[];
    },
    allowance: OrderAllowance | null,
    now: Date,
  ): void {
    this.assertUntouched('edited');
    Object.assign(this.props, changes.header);
    if (changes.lines) this.props.lines = validLines(changes.lines, allowance);
    this.touch(now);
  }

  cancel(reason: string, now: Date): void {
    this.assertUntouched('cancelled');
    const text = reason.trim();
    if (text.length === 0 || text.length > 500)
      throw new DomainError('invalid_remarks', 'Give a reason (1-500 characters)');
    this.props.status = 'cancelled';
    this.props.cancelReason = text;
    this.touch(now);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_purchase_order', 'The order was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<OrderProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertUntouched(action: string): void {
    if (this.props.status !== 'open' || this.props.lines.some((line) => line.receivedQty > 0)) {
      throw new DomainError(
        'purchase_order_state',
        `A ${this.props.status.replace('_', ' ')} order cannot be ${action}`,
      );
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}
