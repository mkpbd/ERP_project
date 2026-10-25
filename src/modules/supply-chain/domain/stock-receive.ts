import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { paisa, taka, validAmount, validPercent, validQuantity, MAX_DOCUMENT_LINES } from './documents.js';

export type ReceiveStatus = 'draft' | 'posted';

export interface ReceiveLineInput {
  readonly variantId: string;
  readonly qty: number;
  readonly rate: number;
  readonly discountPercent: number;
  readonly vatPercent: number;
  readonly aitPercent: number;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly warrantyNote: string | null;
}

export interface ReceiveAmounts {
  /** Rate × quantity. */
  readonly amount: number;
  readonly discount: number;
  readonly vat: number;
  readonly ait: number;
  /** Amount − discount + VAT + AIT: what the line costs and is owed for. */
  readonly total: number;
}

export interface ReceiveLine extends ReceiveLineInput, ReceiveAmounts {}

export interface ReceiveHeader {
  readonly mainStoreId: string;
  readonly supplierId: string;
  readonly purchaseOrderId: string | null;
  readonly receivedOn: string;
  readonly supplierInvoiceNo: string | null;
  readonly supplierInvoiceDate: string | null;
  readonly challanNo: string | null;
  readonly remarks: string | null;
}

export interface ReceiveProps extends ReceiveHeader, ReceiveAmounts {
  id: string;
  number: string;
  status: ReceiveStatus;
  lines: ReceiveLine[];
  voucherId: string | null;
  voucherNumber: string | null;
  createdBy: string | null;
  postedBy: string | null;
  postedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** What receiving needs to know about an item variant. */
export interface ReceivableVariant {
  readonly isActive: boolean;
  readonly expiryRequired: boolean;
}

/**
 * Old stock receive arithmetic (AddEditStockReceivePage): discount, VAT and AIT are each a share of rate ×
 * quantity (VAT before the discount), here rounded to the paisa.
 */
export function receiveLineAmounts(
  line: Pick<ReceiveLineInput, 'qty' | 'rate' | 'discountPercent' | 'vatPercent' | 'aitPercent'>,
): ReceiveAmounts {
  const amount = paisa(line.rate * line.qty);
  const share = (percent: number) => Math.round((amount * percent) / 100);
  const discount = share(line.discountPercent);
  const vat = share(line.vatPercent);
  const ait = share(line.aitPercent);
  return {
    amount: taka(amount),
    discount: taka(discount),
    vat: taka(vat),
    ait: taka(ait),
    total: taka(amount - discount + vat + ait),
  };
}

function totals(lines: readonly ReceiveAmounts[]): ReceiveAmounts {
  const sum = (key: keyof ReceiveAmounts) => taka(lines.reduce((total, line) => total + paisa(line[key]), 0));
  return { amount: sum('amount'), discount: sum('discount'), vat: sum('vat'), ait: sum('ait'), total: sum('total') };
}

const text = (value: string | null, max: number, what: string, at: string) => {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length > max) throw new DomainError('invalid_receive', `${at}: the ${what} is at most ${max} characters`);
  return trimmed.length > 0 ? trimmed : null;
};

function validLines(lines: readonly ReceiveLineInput[]): ReceiveLine[] {
  if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
    throw new DomainError('invalid_lines', `A stock receive has 1 to ${MAX_DOCUMENT_LINES} lines`);
  }
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const at = `Line ${index + 1}`;
    validQuantity(line.qty, at);
    validAmount(line.rate, at);
    validPercent(line.discountPercent, at);
    validPercent(line.vatPercent, at);
    validPercent(line.aitPercent, at);
    const batchNo = text(line.batchNo, 50, 'batch number', at);
    const lot = `${line.variantId}|${batchNo?.toUpperCase() ?? ''}|${line.expiryDate ?? ''}`;
    if (seen.has(lot))
      throw new DomainError('duplicate_line', `${at}: the same item, batch and expiry is already on the receive`);
    seen.add(lot);
    return {
      ...line,
      batchNo,
      warrantyNote: text(line.warrantyNote, 300, 'warranty note', at),
      ...receiveLineAmounts(line),
    };
  });
}

/**
 * Old StockReceive ("stock record"): goods taken into a main store from a supplier, against a purchase order
 * or without one. A draft is edited freely; posting puts the goods in stock by lot, adds them to the order
 * and posts the purchase to accounts. A posted receive is not changed (returns come in step 7d).
 */
export class StockReceive {
  private constructor(private readonly props: ReceiveProps) {}

  static draft(params: {
    id: string;
    number: string;
    header: ReceiveHeader;
    lines: readonly ReceiveLineInput[];
    createdBy: string;
    now: Date;
  }): StockReceive {
    const lines = validLines(params.lines);
    return new StockReceive({
      id: params.id,
      number: params.number,
      ...validHeader(params.header),
      ...totals(lines),
      status: 'draft',
      lines,
      voucherId: null,
      voucherNumber: null,
      createdBy: params.createdBy,
      postedBy: null,
      postedAt: null,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: ReceiveProps): StockReceive {
    return new StockReceive({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get status(): ReceiveStatus {
    return this.props.status;
  }
  get header(): ReceiveHeader {
    return this.props;
  }
  get lines(): readonly ReceiveLine[] {
    return this.props.lines;
  }
  get total(): number {
    return this.props.total;
  }

  edit(changes: { header?: Partial<ReceiveHeader>; lines?: readonly ReceiveLineInput[] }, now: Date): void {
    this.assertDraft('edited');
    Object.assign(this.props, validHeader({ ...this.props, ...changes.header }));
    if (changes.lines) {
      this.props.lines = validLines(changes.lines);
      Object.assign(this.props, totals(this.props.lines));
    }
    this.touch(now);
  }

  /** Variant → quantity, for the purchase order. */
  quantities(): Map<string, number> {
    const quantities = new Map<string, number>();
    for (const line of this.props.lines) {
      quantities.set(line.variantId, Math.round(((quantities.get(line.variantId) ?? 0) + line.qty) * 1000) / 1000);
    }
    return quantities;
  }

  /**
   * Checks the lines against the item master (active; expiry given where the item needs one, and not before
   * the receive date; the old page enforced it only for lines typed in by hand) and marks the receive posted.
   */
  checkPostable(variants: ReadonlyMap<string, ReceivableVariant>): void {
    this.assertDraft('posted');
    for (const [index, line] of this.props.lines.entries()) {
      const at = `Line ${index + 1}`;
      const variant = variants.get(line.variantId);
      if (!variant) throw new DomainError('invalid_receive', `${at}: unknown item`);
      if (!variant.isActive) throw new DomainError('inactive_item', `${at}: the item is inactive`);
      if (variant.expiryRequired && !line.expiryDate) {
        throw new DomainError('expiry_required', `${at}: the item needs an expiry date`);
      }
      if (line.expiryDate && line.expiryDate <= this.props.receivedOn) {
        throw new DomainError('expired_lot', `${at}: the lot has expired by the receive date`);
      }
    }
  }

  post(params: {
    variants: ReadonlyMap<string, ReceivableVariant>;
    voucher: { id: string; number: string } | null;
    by: string;
    now: Date;
  }): void {
    this.checkPostable(params.variants);
    this.props.status = 'posted';
    this.props.voucherId = params.voucher?.id ?? null;
    this.props.voucherNumber = params.voucher?.number ?? null;
    this.props.postedBy = params.by;
    this.props.postedAt = params.now;
    this.touch(params.now);
  }

  assertDeletable(): void {
    this.assertDraft('deleted');
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_stock_receive', 'The receive was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<ReceiveProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertDraft(action: string): void {
    if (this.props.status !== 'draft') {
      throw new DomainError('stock_receive_state', `A posted receive cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}

function validHeader(header: ReceiveHeader): ReceiveHeader {
  const at = 'Receive';
  return {
    ...header,
    supplierInvoiceNo: text(header.supplierInvoiceNo, 50, 'invoice number', at),
    challanNo: text(header.challanNo, 50, 'challan number', at),
    remarks: text(header.remarks, 1000, 'remarks', at),
  };
}
