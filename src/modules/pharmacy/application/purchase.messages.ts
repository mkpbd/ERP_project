import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { OrderHeader, OrderStatus } from '../domain/purchase-order.js';
import type { ReceiveHeader, ReceiveLineInput, ReceiveStatus } from '../domain/receive.js';

/** A product as documents show it. */
export interface ProductRef {
  readonly productId: string;
  readonly displayName: string;
  readonly genericName: string;
  readonly unitName: string | null;
}

export interface DocumentFilter extends PageRequest {
  readonly status?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly outletId?: string | undefined;
  readonly supplierId?: string | undefined;
  /** Number, supplier invoice or challan. */
  readonly q?: string | undefined;
}

export interface OrderSummary {
  readonly id: string;
  readonly number: string;
  readonly orderDate: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly outletId: string;
  readonly outletName: string;
  readonly status: OrderStatus;
  readonly lineCount: number;
  readonly version: number;
}

export interface OrderView extends OrderSummary {
  readonly note: string | null;
  readonly closeReason: string | null;
  readonly supplierAddress: string | null;
  readonly lines: (ProductRef & { readonly qty: number; readonly receivedQty: number })[];
}

export interface ReceiveSummary {
  readonly id: string;
  readonly number: string;
  readonly receivedOn: string;
  readonly outletId: string;
  readonly outletName: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly purchaseOrderId: string | null;
  readonly purchaseOrderNumber: string | null;
  readonly supplierInvoiceNo: string | null;
  readonly challanNo: string | null;
  readonly status: ReceiveStatus;
  readonly amount: number;
  readonly discount: number;
  readonly vat: number;
  readonly total: number;
  readonly voucherNumber: string | null;
  readonly version: number;
}

export interface ReceiveLineView extends ProductRef {
  readonly qty: number;
  readonly purchaseRate: number;
  readonly saleRate: number;
  readonly discountPercent: number;
  readonly vatPercent: number;
  readonly amount: number;
  readonly discount: number;
  readonly vat: number;
  readonly total: number;
  readonly batchNo: string | null;
  readonly expiryDate: string;
}

export interface ReceiveView extends ReceiveSummary {
  readonly supplierAddress: string | null;
  readonly supplierInvoiceDate: string | null;
  readonly remarks: string | null;
  readonly createdBy: string | null;
  readonly postedBy: string | null;
  readonly postedAt: Date | null;
  readonly lines: ReceiveLineView[];
}

export interface StockLot {
  readonly lotId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string;
  readonly saleRate: number;
  readonly qty: number;
  /** At cost. */
  readonly value: number;
}

export interface StockRow extends ProductRef {
  readonly manufacturerName: string;
  readonly qty: number;
  /** At cost (the receive's line total per unit, VAT included). */
  readonly value: number;
  /** At the lots' sale rates. */
  readonly saleValue: number;
  readonly reorderLevel: number;
  readonly belowReorder: boolean;
  readonly lots: StockLot[];
}

export interface StockFilter {
  readonly outletId: string;
  readonly productId?: string | undefined;
  /** Brand, generic or barcode. */
  readonly q?: string | undefined;
  /** Products at or below their reorder level at the outlet, including those with none left. */
  readonly belowReorderOnly?: boolean | undefined;
  readonly asOf?: string | undefined;
}

export interface StockCardRow {
  readonly movedOn: string;
  readonly kind: string;
  readonly documentNumber: string;
  readonly batchNo: string | null;
  readonly expiryDate: string;
  readonly in: number;
  readonly out: number;
  readonly unitCost: number;
  readonly balance: number;
}

export interface StockCard extends ProductRef {
  readonly opening: number;
  readonly rows: StockCardRow[];
  readonly totalIn: number;
  readonly totalOut: number;
  readonly closing: number;
}

export abstract class PharmacyReadRepository {
  abstract listOrders(filter: DocumentFilter): Promise<Page<OrderSummary>>;
  abstract getOrder(id: string): Promise<OrderView | null>;
  abstract listReceives(filter: DocumentFilter): Promise<Page<ReceiveSummary>>;
  abstract getReceive(id: string): Promise<ReceiveView | null>;
  abstract stock(filter: StockFilter): Promise<StockRow[]>;
  /** Null when the product does not exist. */
  abstract card(outletId: string, productId: string, from: string, to: string): Promise<StockCard | null>;
  abstract outletName(id: string): Promise<string | null>;
}

type OrderLineInput = { productId: string; qty: number };

export class CreateOrderCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly header: OrderHeader,
    readonly lines: readonly OrderLineInput[],
  ) {
    super();
  }
}

export class EditOrderCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly header: Partial<OrderHeader>,
    readonly lines: readonly OrderLineInput[] | undefined,
  ) {
    super();
  }
}

/** Cancel an order nothing has come against, or close a partly received one. */
export class EndOrderCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly action: 'cancel' | 'close',
    readonly reason: string,
  ) {
    super();
  }
}

export class CreateReceiveCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly header: ReceiveHeader,
    readonly lines: readonly ReceiveLineInput[],
  ) {
    super();
  }
}

export class EditReceiveCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly header: Partial<ReceiveHeader>,
    readonly lines: readonly ReceiveLineInput[] | undefined,
  ) {
    super();
  }
}

export class PostReceiveCommand extends Command<{ voucherNumber: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class DeleteReceiveCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export interface OpeningLineInput {
  readonly productId: string;
  readonly qty: number;
  readonly unitCost: number;
  readonly saleRate: number;
  readonly batchNo: string | null;
  readonly expiryDate: string;
}

export class EnterOpeningStockCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly outletId: string,
    readonly openedOn: string,
    readonly note: string | null,
    readonly lines: readonly OpeningLineInput[],
  ) {
    super();
  }
}

export class ListOrdersQuery extends Query<Page<OrderSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: DocumentFilter,
  ) {
    super();
  }
}

export class GetOrderQuery extends Query<OrderView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListReceivesQuery extends Query<Page<ReceiveSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: DocumentFilter,
  ) {
    super();
  }
}

export class GetReceiveQuery extends Query<ReceiveView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class GetStockQuery extends Query<StockRow[]> {
  constructor(
    readonly actor: Actor,
    readonly filter: StockFilter,
  ) {
    super();
  }
}

export class GetStockCardQuery extends Query<StockCard> {
  constructor(
    readonly actor: Actor,
    readonly outletId: string,
    readonly productId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super();
  }
}
