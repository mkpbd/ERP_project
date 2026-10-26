import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import {
  MAX_DOCUMENT_LINES,
  paisa,
  taka,
  text,
  validAmount,
  validPercent,
  validRate,
  validUnits,
} from './documents.js';

export type ReceiveStatus = 'draft' | 'posted';

export interface ReceiveLineInput {
  readonly productId: string;
  /** Units paid for (tablets, bottles), not packs. */
  readonly qty: number;
  /** Free units the supplier adds: into stock, at no extra cost (the line cost is spread over all units). */
  readonly bonusQty: number;
  /** Per unit, before discount and VAT. */
  readonly purchaseRate: number;
  /** Per unit: what the lot sells for. */
  readonly saleRate: number;
  readonly discountPercent: number;
  readonly vatPercent: number;
  readonly batchNo: string | null;
  readonly expiryDate: string;
}

export interface ReceiveAmounts {
  /** Purchase rate × quantity. */
  readonly amount: number;
  readonly discount: number;
  readonly vat: number;
  /** Amount − discount + VAT: what the line costs and is owed for. */
  readonly total: number;
}

export interface ReceiveLine extends ReceiveLineInput, ReceiveAmounts {}

export interface ReceiveHeader {
  readonly outletId: string;
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

/**
 * Old GRN arithmetic (StockReceiveDetail: TotalAmount = qty × purchase rate, GrossDiscount and VatInGrossAmount
 * each a share of it), here rounded to the paisa.
 */
export function receiveLineAmounts(
  line: Pick<ReceiveLineInput, 'qty' | 'purchaseRate' | 'discountPercent' | 'vatPercent'>,
): ReceiveAmounts {
  const amount = paisa(line.purchaseRate * line.qty);
  const share = (percent: number) => Math.round((amount * percent) / 100);
  const discount = share(line.discountPercent);
  const vat = share(line.vatPercent);
  return { amount: taka(amount), discount: taka(discount), vat: taka(vat), total: taka(amount - discount + vat) };
}

function totals(lines: readonly ReceiveAmounts[]): ReceiveAmounts {
  const sum = (key: keyof ReceiveAmounts) => taka(lines.reduce((total, line) => total + paisa(line[key]), 0));
  return { amount: sum('amount'), discount: sum('discount'), vat: sum('vat'), total: sum('total') };
}

function validLines(lines: readonly ReceiveLineInput[]): ReceiveLine[] {
  if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
    throw new DomainError('invalid_lines', `A stock receive has 1 to ${MAX_DOCUMENT_LINES} lines`);
  }
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const at = `Line ${index + 1}`;
    validUnits(line.qty, at);
    validUnits(line.bonusQty, `${at} (bonus)`, true);
    validRate(line.purchaseRate, at);
    validAmount(line.saleRate, at);
    validPercent(line.discountPercent, at);
    validPercent(line.vatPercent, at);
    const batchNo = text(line.batchNo, 50, 'batch number', at);
    const lot = `${line.productId}|${batchNo?.toUpperCase() ?? ''}|${line.expiryDate}|${line.saleRate}`;
    if (seen.has(lot)) {
      throw new DomainError('duplicate_line', `${at}: the same product, batch, expiry and sale rate is already on it`);
    }
    seen.add(lot);
    return { ...line, batchNo, ...receiveLineAmounts(line) };
  });
}

function validHeader(header: ReceiveHeader): ReceiveHeader {
  const at = 'Receive';
  if (header.supplierInvoiceDate && header.supplierInvoiceDate > header.receivedOn) {
    throw new DomainError('invalid_date', "The supplier's invoice is not dated after the receive");
  }
  return {
    ...header,
    supplierInvoiceNo: text(header.supplierInvoiceNo, 50, 'invoice number', at),
    challanNo: text(header.challanNo, 50, 'challan number', at),
    remarks: text(header.remarks, 1000, 'remarks', at),
  };
}

/** What receiving needs to know about a product. */
export interface ReceivableProduct {
  readonly isActive: boolean;
}

/**
 * Old pharmacy StockReceive (GRN): medicines taken into an outlet from a supplier, against a purchase order or
 * without one; bonus units come in free. A draft is edited freely; posting puts every line in stock in its lot (batch, expiry and sale
 * rate) at its own unit cost, adds it to the order and posts the purchase to accounts on the supplier's
 * sub-ledger (the old pharmacy posted nothing).
 */
export class PharmacyReceive {
  private constructor(private readonly props: ReceiveProps) {}

  static draft(params: {
    id: string;
    number: string;
    header: ReceiveHeader;
    lines: readonly ReceiveLineInput[];
    createdBy: string;
    now: Date;
  }): PharmacyReceive {
    const lines = validLines(params.lines);
    return new PharmacyReceive({
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

  static restore(props: ReceiveProps): PharmacyReceive {
    return new PharmacyReceive({ ...props, lines: [...props.lines] });
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

  /** Product → units, for the purchase order. */
  quantities(): Map<string, number> {
    const quantities = new Map<string, number>();
    for (const line of this.props.lines) {
      quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.qty);
    }
    return quantities;
  }

  /** Active products, and no lot expired by the receive date. */
  post(params: {
    products: ReadonlyMap<string, ReceivableProduct>;
    voucher: { id: string; number: string } | null;
    by: string;
    now: Date;
  }): void {
    this.assertDraft('posted');
    for (const [index, line] of this.props.lines.entries()) {
      const at = `Line ${index + 1}`;
      const product = params.products.get(line.productId);
      if (!product) throw new DomainError('invalid_receive', `${at}: unknown product`);
      if (!product.isActive) throw new DomainError('inactive_product', `${at}: the product is inactive`);
      if (line.expiryDate <= this.props.receivedOn) {
        throw new DomainError('expired_lot', `${at}: the lot has expired by the receive date`);
      }
    }
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
      throw new ConflictError('stale_pharmacy_receive', 'The receive was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<ReceiveProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertDraft(action: string): void {
    if (this.props.status !== 'draft') {
      throw new DomainError('pharmacy_receive_state', `A posted receive cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}
