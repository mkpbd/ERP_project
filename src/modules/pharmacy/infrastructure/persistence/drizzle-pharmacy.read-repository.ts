import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { SupplierDirectory } from '../../../../shared/application/contracts/supplier-directory.js';
import { displayName } from '../../application/catalogue.handlers.js';
import {
  PharmacyReadRepository,
  type DocumentFilter,
  type OrderSummary,
  type OrderView,
  type ProductRef,
  type ReceiveSummary,
  type ReceiveView,
  type StockCard,
  type StockFilter,
  type StockRow,
} from '../../application/purchase.messages.js';
import {
  brands,
  formations,
  generics,
  manufacturers,
  outlets,
  pharmacyLots,
  pharmacyMovements,
  pharmacyOrderLines,
  pharmacyOrders,
  pharmacyReceiveLines,
  pharmacyReceives,
  products,
  reorderLevels,
  strengths,
  units,
} from './pharmacy.schema.js';

const cents = (value: number) => Math.round(value * 100) / 100;

/** The columns a product reference is made of. */
export const productColumns = {
  productId: products.id,
  brandName: brands.name,
  formationName: formations.name,
  formationShortName: formations.shortName,
  strength: strengths.name,
  genericName: generics.name,
  unitName: units.name,
  manufacturerName: manufacturers.name,
};

export type ProductColumns = {
  productId: string;
  brandName: string;
  formationName: string;
  formationShortName: string | null;
  strength: string | null;
  genericName: string;
  unitName: string | null;
  manufacturerName: string;
};

export function productRef<T extends ProductColumns>(row: T) {
  const {
    brandName: _b,
    formationName: _f,
    formationShortName: _s,
    strength: _st,
    manufacturerName: _m,
    ...rest
  } = row;
  return { ...rest, displayName: displayName(row) } as Omit<
    T,
    'brandName' | 'formationName' | 'formationShortName' | 'strength' | 'manufacturerName'
  > &
    ProductRef;
}

/** Products with their names, for the given ids. */
export async function productsById(context: DbContext, ids: readonly string[]): Promise<Map<string, ProductColumns>> {
  if (ids.length === 0) return new Map();
  const rows = await context.db
    .select(productColumns)
    .from(products)
    .innerJoin(brands, eq(brands.id, products.brandId))
    .innerJoin(manufacturers, eq(manufacturers.id, brands.manufacturerId))
    .innerJoin(formations, eq(formations.id, products.formationId))
    .innerJoin(generics, eq(generics.id, products.genericId))
    .leftJoin(strengths, eq(strengths.id, products.strengthId))
    .leftJoin(units, eq(units.id, products.unitId))
    .where(inArray(products.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.productId, row]));
}

@Injectable()
export class DrizzlePharmacyReadRepository extends PharmacyReadRepository {
  constructor(
    private readonly context: DbContext,
    private readonly suppliers: SupplierDirectory,
  ) {
    super();
  }

  /** Each row with its supplier's name and address. */
  private async withSuppliers<T extends { supplierId: string }>(rows: readonly T[]) {
    const found = new Map((await this.suppliers.find(rows.map((row) => row.supplierId))).map((s) => [s.id, s]));
    return rows.map((row) => ({
      ...row,
      supplierName: found.get(row.supplierId)?.name ?? '',
      supplierAddress: found.get(row.supplierId)?.address ?? null,
    }));
  }

  private productsById(ids: readonly string[]) {
    return productsById(this.context, ids);
  }

  private orderHeaders() {
    return this.context.db
      .select({
        id: pharmacyOrders.id,
        number: pharmacyOrders.number,
        orderDate: pharmacyOrders.orderDate,
        supplierId: pharmacyOrders.supplierId,
        outletId: pharmacyOrders.outletId,
        outletName: outlets.name,
        status: pharmacyOrders.status,
        note: pharmacyOrders.note,
        closeReason: pharmacyOrders.closeReason,
        lineCount:
          sql<number>`(select count(*) from ${pharmacyOrderLines} where ${pharmacyOrderLines.orderId} = ${pharmacyOrders.id})`.mapWith(
            Number,
          ),
        version: pharmacyOrders.version,
      })
      .from(pharmacyOrders)
      .innerJoin(outlets, eq(outlets.id, pharmacyOrders.outletId));
  }

  async listOrders(filter: DocumentFilter): Promise<Page<OrderSummary>> {
    const where = and(
      filter.status ? eq(pharmacyOrders.status, filter.status as 'open') : undefined,
      filter.from ? gte(pharmacyOrders.orderDate, filter.from) : undefined,
      filter.to ? lte(pharmacyOrders.orderDate, filter.to) : undefined,
      filter.outletId ? eq(pharmacyOrders.outletId, filter.outletId) : undefined,
      filter.supplierId ? eq(pharmacyOrders.supplierId, filter.supplierId) : undefined,
      filter.q ? ilike(pharmacyOrders.number, `%${escapeLike(filter.q)}%`) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.orderHeaders()
        .where(where)
        .orderBy(desc(pharmacyOrders.orderDate), desc(pharmacyOrders.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(pharmacyOrders).where(where),
    ]);
    return toPage(
      (await this.withSuppliers(rows)).map(({ supplierAddress: _a, note: _n, closeReason: _c, ...row }) => row),
      total?.n ?? 0,
      filter,
    );
  }

  async getOrder(id: string): Promise<OrderView | null> {
    const [found] = await this.orderHeaders().where(eq(pharmacyOrders.id, id));
    if (!found) return null;
    const header = (await this.withSuppliers([found]))[0]!;
    const lines = await this.context.db
      .select()
      .from(pharmacyOrderLines)
      .where(eq(pharmacyOrderLines.orderId, id))
      .orderBy(asc(pharmacyOrderLines.position));
    const named = await this.productsById(lines.map((line) => line.productId));
    return {
      ...header,
      lines: lines.map((line) => ({
        ...productRef(named.get(line.productId)!),
        qty: line.qty,
        receivedQty: line.receivedQty,
      })),
    };
  }

  private receiveHeaders() {
    return this.context.db
      .select({
        id: pharmacyReceives.id,
        number: pharmacyReceives.number,
        receivedOn: pharmacyReceives.receivedOn,
        outletId: pharmacyReceives.outletId,
        outletName: outlets.name,
        supplierId: pharmacyReceives.supplierId,
        purchaseOrderId: pharmacyReceives.purchaseOrderId,
        purchaseOrderNumber: pharmacyOrders.number,
        supplierInvoiceNo: pharmacyReceives.supplierInvoiceNo,
        supplierInvoiceDate: pharmacyReceives.supplierInvoiceDate,
        challanNo: pharmacyReceives.challanNo,
        remarks: pharmacyReceives.remarks,
        status: pharmacyReceives.status,
        amount: pharmacyReceives.amount,
        discount: pharmacyReceives.discount,
        vat: pharmacyReceives.vat,
        total: pharmacyReceives.total,
        voucherNumber: pharmacyReceives.voucherNumber,
        createdBy: pharmacyReceives.createdBy,
        postedBy: pharmacyReceives.postedBy,
        postedAt: pharmacyReceives.postedAt,
        version: pharmacyReceives.version,
      })
      .from(pharmacyReceives)
      .innerJoin(outlets, eq(outlets.id, pharmacyReceives.outletId))
      .leftJoin(pharmacyOrders, eq(pharmacyOrders.id, pharmacyReceives.purchaseOrderId));
  }

  async listReceives(filter: DocumentFilter): Promise<Page<ReceiveSummary>> {
    const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
    const where = and(
      filter.status ? eq(pharmacyReceives.status, filter.status as 'draft') : undefined,
      filter.from ? gte(pharmacyReceives.receivedOn, filter.from) : undefined,
      filter.to ? lte(pharmacyReceives.receivedOn, filter.to) : undefined,
      filter.outletId ? eq(pharmacyReceives.outletId, filter.outletId) : undefined,
      filter.supplierId ? eq(pharmacyReceives.supplierId, filter.supplierId) : undefined,
      like
        ? or(
            ilike(pharmacyReceives.number, like),
            ilike(pharmacyReceives.supplierInvoiceNo, like),
            ilike(pharmacyReceives.challanNo, like),
          )
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.receiveHeaders()
        .where(where)
        .orderBy(desc(pharmacyReceives.receivedOn), desc(pharmacyReceives.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(pharmacyReceives).where(where),
    ]);
    return toPage(
      (await this.withSuppliers(rows)).map(
        ({
          supplierAddress: _a,
          supplierInvoiceDate: _d,
          remarks: _r,
          createdBy: _c,
          postedBy: _p,
          postedAt: _at,
          ...row
        }) => row,
      ),
      total?.n ?? 0,
      filter,
    );
  }

  async getReceive(id: string): Promise<ReceiveView | null> {
    const [found] = await this.receiveHeaders().where(eq(pharmacyReceives.id, id));
    if (!found) return null;
    const header = (await this.withSuppliers([found]))[0]!;
    const lines = await this.context.db
      .select()
      .from(pharmacyReceiveLines)
      .where(eq(pharmacyReceiveLines.receiveId, id))
      .orderBy(asc(pharmacyReceiveLines.position));
    const named = await this.productsById(lines.map((line) => line.productId));
    return {
      ...header,
      lines: lines.map(({ receiveId: _id, position: _position, lotId: _lot, productId, ...line }) => ({
        ...productRef(named.get(productId)!),
        ...line,
      })),
    };
  }

  async stock(filter: StockFilter): Promise<StockRow[]> {
    const lots = await this.context.db
      .select({
        productId: pharmacyMovements.productId,
        lotId: pharmacyMovements.lotId,
        batchNo: pharmacyLots.batchNo,
        expiryDate: pharmacyLots.expiryDate,
        saleRate: pharmacyLots.saleRate,
        qty: sql<number>`sum(${pharmacyMovements.qty})`.mapWith(Number),
        value: sql<number>`sum(${pharmacyMovements.qty} * ${pharmacyMovements.unitCost})`.mapWith(Number),
      })
      .from(pharmacyMovements)
      .innerJoin(pharmacyLots, eq(pharmacyLots.id, pharmacyMovements.lotId))
      .where(
        and(
          eq(pharmacyMovements.outletId, filter.outletId),
          filter.asOf ? lte(pharmacyMovements.movedOn, filter.asOf) : undefined,
          filter.productId ? eq(pharmacyMovements.productId, filter.productId) : undefined,
        ),
      )
      .groupBy(
        pharmacyMovements.productId,
        pharmacyMovements.lotId,
        pharmacyLots.batchNo,
        pharmacyLots.expiryDate,
        pharmacyLots.saleRate,
      )
      .having(sql`sum(${pharmacyMovements.qty}) <> 0`)
      .orderBy(asc(pharmacyLots.expiryDate), asc(pharmacyLots.batchNo), asc(pharmacyLots.saleRate));
    const levels = await this.context.db
      .select({ productId: reorderLevels.productId, level: reorderLevels.level })
      .from(reorderLevels)
      .where(eq(reorderLevels.outletId, filter.outletId));
    const levelOf = new Map(levels.map((row) => [row.productId, row.level]));
    const ids = filter.belowReorderOnly
      ? [...new Set([...lots.map((lot) => lot.productId), ...levelOf.keys()])]
      : [...new Set(lots.map((lot) => lot.productId))];
    const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
    const where: SQL | undefined = like
      ? or(ilike(brands.name, like), ilike(generics.name, like), ilike(products.barcode, like))
      : undefined;
    if (ids.length === 0) return [];
    const rows = await this.context.db
      .select(productColumns)
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .innerJoin(manufacturers, eq(manufacturers.id, brands.manufacturerId))
      .innerJoin(formations, eq(formations.id, products.formationId))
      .innerJoin(generics, eq(generics.id, products.genericId))
      .leftJoin(strengths, eq(strengths.id, products.strengthId))
      .leftJoin(units, eq(units.id, products.unitId))
      .where(and(inArray(products.id, ids), where))
      .orderBy(asc(brands.name), asc(formations.name), asc(strengths.name));
    return rows
      .map((row) => {
        const own = lots.filter((lot) => lot.productId === row.productId);
        const qty = own.reduce((sum, lot) => sum + lot.qty, 0);
        const reorderLevel = levelOf.get(row.productId) ?? 0;
        return {
          ...productRef(row),
          manufacturerName: row.manufacturerName,
          qty,
          value: cents(own.reduce((sum, lot) => sum + lot.value, 0)),
          saleValue: cents(own.reduce((sum, lot) => sum + lot.qty * lot.saleRate, 0)),
          reorderLevel,
          belowReorder: levelOf.has(row.productId) && qty <= reorderLevel,
          lots: own.map(({ productId: _id, ...lot }) => ({ ...lot, value: cents(lot.value) })),
        };
      })
      .filter((row) => !filter.belowReorderOnly || row.belowReorder);
  }

  async card(outletId: string, productId: string, from: string, to: string): Promise<StockCard | null> {
    const named = (await this.productsById([productId])).get(productId);
    if (!named) return null;
    const scope = and(eq(pharmacyMovements.outletId, outletId), eq(pharmacyMovements.productId, productId));
    const [[before], rows] = await Promise.all([
      this.context.db
        .select({ qty: sql<number>`coalesce(sum(${pharmacyMovements.qty}), 0)`.mapWith(Number) })
        .from(pharmacyMovements)
        .where(and(scope, lt(pharmacyMovements.movedOn, from))),
      this.context.db
        .select({
          movedOn: pharmacyMovements.movedOn,
          kind: pharmacyMovements.kind,
          documentNumber: pharmacyMovements.documentNumber,
          batchNo: pharmacyLots.batchNo,
          expiryDate: pharmacyLots.expiryDate,
          qty: pharmacyMovements.qty,
          unitCost: pharmacyMovements.unitCost,
        })
        .from(pharmacyMovements)
        .innerJoin(pharmacyLots, eq(pharmacyLots.id, pharmacyMovements.lotId))
        .where(and(scope, gte(pharmacyMovements.movedOn, from), lte(pharmacyMovements.movedOn, to)))
        .orderBy(
          asc(pharmacyMovements.movedOn),
          asc(pharmacyMovements.createdAt),
          asc(pharmacyMovements.documentNumber),
        ),
    ]);
    const opening = before?.qty ?? 0;
    let balance = opening;
    let totalIn = 0;
    let totalOut = 0;
    const cardRows = rows.map(({ qty, ...row }) => {
      balance += qty;
      if (qty > 0) totalIn += qty;
      else totalOut -= qty;
      return { ...row, in: qty > 0 ? qty : 0, out: qty < 0 ? -qty : 0, balance };
    });
    const ref = productRef(named);
    return { ...ref, opening, rows: cardRows, totalIn, totalOut, closing: balance };
  }

  async outletName(id: string): Promise<string | null> {
    const [row] = await this.context.db.select({ name: outlets.name }).from(outlets).where(eq(outlets.id, id));
    return row?.name ?? null;
  }
}
