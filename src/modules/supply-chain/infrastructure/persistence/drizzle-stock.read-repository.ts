import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import type { DocumentFilter } from '../../application/purchase.messages.js';
import {
  StockReadRepository,
  type ReceiveSummary,
  type ReceiveView,
  type StockCard,
  type StockFilter,
  type StockRow,
} from '../../application/stock.messages.js';
import type { StoreRef } from '../../domain/repositories.js';
import {
  itemGroups,
  items,
  itemSubGroups,
  itemVariants,
  mainStores,
  purchaseOrders,
  stockLots,
  stockMovements,
  stockReceiveLines,
  stockReceives,
  subStores,
  suppliers,
} from './supply-chain.schema.js';

const inStore = (store: StoreRef): SQL =>
  'mainStoreId' in store
    ? eq(stockMovements.mainStoreId, store.mainStoreId)
    : eq(stockMovements.subStoreId, store.subStoreId);
const qty3 = (value: number) => Math.round(value * 1000) / 1000;
const cents = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class DrizzleStockReadRepository extends StockReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private receiveHeaders() {
    return this.context.db
      .select({
        id: stockReceives.id,
        number: stockReceives.number,
        receivedOn: stockReceives.receivedOn,
        mainStoreId: stockReceives.mainStoreId,
        mainStoreName: mainStores.name,
        supplierId: stockReceives.supplierId,
        supplierName: suppliers.name,
        supplierAddress: suppliers.address,
        purchaseOrderId: stockReceives.purchaseOrderId,
        purchaseOrderNumber: purchaseOrders.number,
        supplierInvoiceNo: stockReceives.supplierInvoiceNo,
        supplierInvoiceDate: stockReceives.supplierInvoiceDate,
        challanNo: stockReceives.challanNo,
        remarks: stockReceives.remarks,
        status: stockReceives.status,
        amount: stockReceives.amount,
        discount: stockReceives.discount,
        vat: stockReceives.vat,
        ait: stockReceives.ait,
        total: stockReceives.total,
        voucherId: stockReceives.voucherId,
        voucherNumber: stockReceives.voucherNumber,
        createdBy: stockReceives.createdBy,
        postedBy: stockReceives.postedBy,
        postedAt: stockReceives.postedAt,
        version: stockReceives.version,
      })
      .from(stockReceives)
      .innerJoin(mainStores, eq(mainStores.id, stockReceives.mainStoreId))
      .innerJoin(suppliers, eq(suppliers.id, stockReceives.supplierId))
      .leftJoin(purchaseOrders, eq(purchaseOrders.id, stockReceives.purchaseOrderId));
  }

  async listReceives(filter: DocumentFilter): Promise<Page<ReceiveSummary>> {
    const where = and(
      filter.status ? eq(stockReceives.status, filter.status as 'draft' | 'posted') : undefined,
      filter.from ? gte(stockReceives.receivedOn, filter.from) : undefined,
      filter.to ? lte(stockReceives.receivedOn, filter.to) : undefined,
      filter.mainStoreId ? eq(stockReceives.mainStoreId, filter.mainStoreId) : undefined,
      filter.supplierId ? eq(stockReceives.supplierId, filter.supplierId) : undefined,
      filter.q
        ? or(
            ilike(stockReceives.number, `%${escapeLike(filter.q)}%`),
            ilike(stockReceives.supplierInvoiceNo, `%${escapeLike(filter.q)}%`),
            ilike(stockReceives.challanNo, `%${escapeLike(filter.q)}%`),
          )
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.receiveHeaders()
        .where(where)
        .orderBy(desc(stockReceives.receivedOn), desc(stockReceives.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(stockReceives).where(where),
    ]);
    return toPage(
      rows.map(
        ({
          supplierAddress: _address,
          supplierInvoiceDate: _date,
          remarks: _remarks,
          createdBy: _by,
          postedBy: _postedBy,
          postedAt: _at,
          ...row
        }) => row,
      ),
      total?.n ?? 0,
      filter,
    );
  }

  async getReceive(id: string): Promise<ReceiveView | null> {
    const [header] = await this.receiveHeaders().where(eq(stockReceives.id, id));
    if (!header) return null;
    const lines = await this.context.db
      .select({
        variantId: itemVariants.id,
        variantName: itemVariants.name,
        code: itemVariants.code,
        itemName: items.name,
        unit: items.unit,
        qty: stockReceiveLines.qty,
        rate: stockReceiveLines.rate,
        discountPercent: stockReceiveLines.discountPercent,
        vatPercent: stockReceiveLines.vatPercent,
        aitPercent: stockReceiveLines.aitPercent,
        amount: stockReceiveLines.amount,
        discount: stockReceiveLines.discount,
        vat: stockReceiveLines.vat,
        ait: stockReceiveLines.ait,
        total: stockReceiveLines.total,
        batchNo: stockReceiveLines.batchNo,
        expiryDate: stockReceiveLines.expiryDate,
        warrantyNote: stockReceiveLines.warrantyNote,
      })
      .from(stockReceiveLines)
      .innerJoin(itemVariants, eq(itemVariants.id, stockReceiveLines.variantId))
      .innerJoin(items, eq(items.id, itemVariants.itemId))
      .where(eq(stockReceiveLines.receiveId, id))
      .orderBy(asc(stockReceiveLines.position));
    return { ...header, lines };
  }

  async stock(filter: StockFilter): Promise<StockRow[]> {
    const lots = await this.context.db
      .select({
        variantId: stockMovements.variantId,
        lotId: stockMovements.lotId,
        batchNo: stockLots.batchNo,
        expiryDate: stockLots.expiryDate,
        qty: sql<number>`sum(${stockMovements.qty})`.mapWith(Number),
        value: sql<number>`sum(${stockMovements.qty} * ${stockMovements.unitCost})`.mapWith(Number),
      })
      .from(stockMovements)
      .innerJoin(stockLots, eq(stockLots.id, stockMovements.lotId))
      .where(
        and(
          inStore(filter.store),
          filter.asOf ? lte(stockMovements.movedOn, filter.asOf) : undefined,
          filter.variantId ? eq(stockMovements.variantId, filter.variantId) : undefined,
        ),
      )
      .groupBy(stockMovements.variantId, stockMovements.lotId, stockLots.batchNo, stockLots.expiryDate)
      .having(sql`sum(${stockMovements.qty}) <> 0`)
      .orderBy(asc(stockLots.expiryDate), asc(stockLots.batchNo));
    const stocked = [...new Set(lots.map((lot) => lot.variantId))];
    const everything = filter.includeEmpty || filter.belowReorderOnly;
    if (!everything && stocked.length === 0) return [];
    const variants = await this.context.db
      .select({
        variantId: itemVariants.id,
        variantName: itemVariants.name,
        code: itemVariants.code,
        itemName: items.name,
        unit: items.unit,
        groupName: itemGroups.name,
        reorderLevel: itemVariants.reorderLevel,
      })
      .from(itemVariants)
      .innerJoin(items, eq(items.id, itemVariants.itemId))
      .innerJoin(itemSubGroups, eq(itemSubGroups.id, items.subGroupId))
      .innerJoin(itemGroups, eq(itemGroups.id, itemSubGroups.groupId))
      .where(
        and(
          everything
            ? and(eq(itemVariants.isActive, true), eq(items.isActive, true))
            : inArray(itemVariants.id, stocked),
          filter.variantId ? eq(itemVariants.id, filter.variantId) : undefined,
          filter.groupId ? eq(itemGroups.id, filter.groupId) : undefined,
          filter.q
            ? or(
                ilike(items.name, `%${escapeLike(filter.q)}%`),
                ilike(itemVariants.name, `%${escapeLike(filter.q)}%`),
                ilike(itemVariants.code, `%${escapeLike(filter.q)}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(itemGroups.name), asc(items.name), asc(itemVariants.name));
    return variants
      .map((variant) => {
        const own = lots.filter((lot) => lot.variantId === variant.variantId);
        const qty = qty3(own.reduce((sum, lot) => sum + lot.qty, 0));
        return {
          ...variant,
          qty,
          value: cents(own.reduce((sum, lot) => sum + lot.value, 0)),
          belowReorder: qty < variant.reorderLevel,
          lots: own.map(({ variantId: _id, ...lot }) => ({ ...lot, qty: qty3(lot.qty), value: cents(lot.value) })),
        };
      })
      .filter((row) => !filter.belowReorderOnly || row.belowReorder);
  }

  async card(store: StoreRef, variantId: string, from: string, to: string): Promise<StockCard | null> {
    const [variant] = await this.context.db
      .select({
        variantId: itemVariants.id,
        variantName: itemVariants.name,
        code: itemVariants.code,
        itemName: items.name,
        unit: items.unit,
      })
      .from(itemVariants)
      .innerJoin(items, eq(items.id, itemVariants.itemId))
      .where(eq(itemVariants.id, variantId));
    if (!variant) return null;
    const scope = and(inStore(store), eq(stockMovements.variantId, variantId));
    const [[before], rows] = await Promise.all([
      this.context.db
        .select({ qty: sql<number>`coalesce(sum(${stockMovements.qty}), 0)`.mapWith(Number) })
        .from(stockMovements)
        .where(and(scope, lt(stockMovements.movedOn, from))),
      this.context.db
        .select({
          movedOn: stockMovements.movedOn,
          kind: stockMovements.kind,
          documentNumber: stockMovements.documentNumber,
          batchNo: stockLots.batchNo,
          expiryDate: stockLots.expiryDate,
          qty: stockMovements.qty,
          unitCost: stockMovements.unitCost,
        })
        .from(stockMovements)
        .innerJoin(stockLots, eq(stockLots.id, stockMovements.lotId))
        .where(and(scope, gte(stockMovements.movedOn, from), lte(stockMovements.movedOn, to)))
        .orderBy(asc(stockMovements.movedOn), asc(stockMovements.createdAt), asc(stockMovements.documentNumber)),
    ]);
    const opening = qty3(before?.qty ?? 0);
    let balance = opening;
    let totalIn = 0;
    let totalOut = 0;
    const cardRows = rows.map(({ qty, ...row }) => {
      balance = qty3(balance + qty);
      if (qty > 0) totalIn = qty3(totalIn + qty);
      else totalOut = qty3(totalOut - qty);
      return { ...row, in: qty > 0 ? qty : 0, out: qty < 0 ? -qty : 0, balance };
    });
    return { ...variant, opening, rows: cardRows, totalIn, totalOut, closing: balance };
  }

  async storeName(store: StoreRef): Promise<string | null> {
    const [row] =
      'mainStoreId' in store
        ? await this.context.db
            .select({ name: mainStores.name })
            .from(mainStores)
            .where(eq(mainStores.id, store.mainStoreId))
        : await this.context.db
            .select({ name: subStores.name })
            .from(subStores)
            .where(eq(subStores.id, store.subStoreId));
    return row?.name ?? null;
  }
}
