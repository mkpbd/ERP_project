import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { MAX_DOCUMENT_LINES, text, validUnits } from './documents.js';

export type OrderStatus = 'open' | 'partly_received' | 'received' | 'closed' | 'cancelled';

export interface OrderLine {
  readonly productId: string;
  readonly qty: number;
  readonly receivedQty: number;
}

export interface OrderHeader {
  readonly supplierId: string;
  readonly outletId: string;
  readonly orderDate: string;
  readonly note: string | null;
}

export interface OrderProps extends OrderHeader {
  id: string;
  number: string;
  status: OrderStatus;
  closeReason: string | null;
  lines: OrderLine[];
  createdBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function validLines(lines: readonly { productId: string; qty: number }[]): OrderLine[] {
  if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
    throw new DomainError('invalid_lines', `A purchase order has 1 to ${MAX_DOCUMENT_LINES} lines`);
  }
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const at = `Line ${index + 1}`;
    if (seen.has(line.productId)) throw new DomainError('duplicate_line', `${at}: the product is already ordered`);
    seen.add(line.productId);
    return { productId: line.productId, qty: validUnits(line.qty, at), receivedQty: 0 };
  });
}

/**
 * Old Pharmacy PurchaseOrder: products ordered from a supplier for an outlet. It takes what posted receives
 * bring in (never more than ordered) and is received in full, or closed with what came; an order nothing has
 * come against may be edited or cancelled.
 */
export class PharmacyOrder {
  private constructor(private readonly props: OrderProps) {}

  static open(params: {
    id: string;
    number: string;
    header: OrderHeader;
    lines: readonly { productId: string; qty: number }[];
    createdBy: string;
    now: Date;
  }): PharmacyOrder {
    return new PharmacyOrder({
      id: params.id,
      number: params.number,
      ...params.header,
      note: text(params.header.note, 1000, 'note', 'Order'),
      status: 'open',
      closeReason: null,
      lines: validLines(params.lines),
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: OrderProps): PharmacyOrder {
    return new PharmacyOrder({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get status(): OrderStatus {
    return this.props.status;
  }
  get header(): OrderHeader {
    return this.props;
  }
  get lines(): readonly OrderLine[] {
    return this.props.lines;
  }

  edit(changes: { header?: Partial<OrderHeader>; lines?: readonly { productId: string; qty: number }[] }, now: Date) {
    this.assertUntouched('edited');
    const header = { ...this.props, ...changes.header };
    Object.assign(this.props, {
      supplierId: header.supplierId,
      outletId: header.outletId,
      orderDate: header.orderDate,
      note: text(header.note, 1000, 'note', 'Order'),
    });
    if (changes.lines) this.props.lines = validLines(changes.lines);
    this.touch(now);
  }

  cancel(reason: string, now: Date): void {
    this.assertUntouched('cancelled');
    this.props.closeReason = required(reason);
    this.props.status = 'cancelled';
    this.touch(now);
  }

  /** What a posted receive brings in (product → units). */
  receive(quantities: ReadonlyMap<string, number>, now: Date): void {
    if (this.props.status !== 'open' && this.props.status !== 'partly_received') {
      throw new DomainError('purchase_order_state', `A ${this.props.status.replace('_', ' ')} order takes no receives`);
    }
    for (const [productId, qty] of quantities) {
      const line = this.props.lines.find((entry) => entry.productId === productId);
      if (!line) throw new DomainError('not_ordered', 'A product received is not on the purchase order');
      if (line.receivedQty + qty > line.qty) {
        throw new DomainError('over_receipt', `More is received than ordered (${line.qty - line.receivedQty} to come)`);
      }
    }
    this.props.lines = this.props.lines.map((line) => ({
      ...line,
      receivedQty: line.receivedQty + (quantities.get(line.productId) ?? 0),
    }));
    this.props.status = this.props.lines.every((line) => line.receivedQty === line.qty)
      ? 'received'
      : 'partly_received';
    this.touch(now);
  }

  /** A partly received order is closed with what came. */
  close(reason: string, now: Date): void {
    if (this.props.status !== 'partly_received') {
      throw new DomainError('purchase_order_state', 'Only a partly received order is closed');
    }
    this.props.closeReason = required(reason);
    this.props.status = 'closed';
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
      throw new DomainError('purchase_order_state', `An order with receives against it cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}

function required(reason: string): string {
  const value = text(reason, 500, 'reason', 'Order');
  if (!value) throw new DomainError('invalid_remarks', 'Give a reason');
  return value;
}
