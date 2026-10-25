import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import type { StoreRef } from '../domain/repositories.js';
import type { ReceiveHeader, ReceiveLineInput, ReceiveStatus } from '../domain/stock-receive.js';
import type { DocumentFilter, ItemRef } from './purchase.messages.js';

export interface ReceiveSummary {
  readonly id: string;
  readonly number: string;
  readonly receivedOn: string;
  readonly mainStoreId: string;
  readonly mainStoreName: string;
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
  readonly ait: number;
  readonly total: number;
  readonly voucherId: string | null;
  readonly voucherNumber: string | null;
  readonly version: number;
}

export interface ReceiveLineView extends ItemRef {
  readonly qty: number;
  readonly rate: number;
  readonly discountPercent: number;
  readonly vatPercent: number;
  readonly aitPercent: number;
  readonly amount: number;
  readonly discount: number;
  readonly vat: number;
  readonly ait: number;
  readonly total: number;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly warrantyNote: string | null;
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

export interface StockLotView {
  readonly lotId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly qty: number;
  readonly value: number;
}

export interface StockRow extends ItemRef {
  readonly groupName: string;
  readonly qty: number;
  /** Quantities at their own cost (the receive's line total per unit, VAT and AIT included as before). */
  readonly value: number;
  readonly reorderLevel: number;
  readonly belowReorder: boolean;
  readonly lots: StockLotView[];
}

export interface StockFilter {
  readonly store: StoreRef;
  readonly variantId?: string | undefined;
  readonly groupId?: string | undefined;
  /** Item, variant or code, partial. */
  readonly q?: string | undefined;
  readonly belowReorderOnly?: boolean | undefined;
  /** Include items with nothing in stock (to see what to reorder). */
  readonly includeEmpty?: boolean | undefined;
  /** On this date (inclusive); today when left out. */
  readonly asOf?: string | undefined;
}

export interface StockCardRow {
  readonly movedOn: string;
  readonly kind: string;
  readonly documentNumber: string;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly in: number;
  readonly out: number;
  readonly unitCost: number;
  readonly balance: number;
}

export interface StockCard extends ItemRef {
  readonly opening: number;
  readonly rows: StockCardRow[];
  readonly totalIn: number;
  readonly totalOut: number;
  readonly closing: number;
}

export abstract class StockReadRepository {
  abstract listReceives(filter: DocumentFilter): Promise<Page<ReceiveSummary>>;
  abstract getReceive(id: string): Promise<ReceiveView | null>;
  abstract stock(filter: StockFilter): Promise<StockRow[]>;
  /** Null when the variant does not exist. */
  abstract card(store: StoreRef, variantId: string, from: string, to: string): Promise<StockCard | null>;
  abstract storeName(store: StoreRef): Promise<string | null>;
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

export class CloseOrderCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export interface OpeningLine {
  readonly variantId: string;
  readonly qty: number;
  readonly unitCost: number;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
}

export class EnterOpeningStockCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly store: StoreRef,
    readonly openedOn: string,
    readonly note: string | null,
    readonly lines: readonly OpeningLine[],
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
    readonly store: StoreRef,
    readonly variantId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super();
  }
}
