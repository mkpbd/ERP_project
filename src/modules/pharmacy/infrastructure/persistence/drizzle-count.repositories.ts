import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  CountReadRepository,
  type CountFilter,
  type CountSummary,
  type CountView,
} from '../../application/count.messages.js';
import { StockCountRepository, type HeldLot } from '../../domain/repositories.js';
import { StockCount } from '../../domain/stock-count.js';
import { productRef, productsById } from './drizzle-pharmacy.read-repository.js';
import {
  brands,
  outlets,
  pharmacyLots,
  pharmacyMovements,
  products,
  stockCountLines,
  stockCounts,
} from './pharmacy.schema.js';

const cents = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class DrizzleStockCountRepository extends StockCountRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<StockCount | null> {
    const [row] = await this.context.db.select().from(stockCounts).where(eq(stockCounts.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(stockCountLines)
      .where(eq(stockCountLines.countId, id))
      .orderBy(asc(stockCountLines.position));
    return StockCount.restore({
      ...row,
      lines: lines.map(({ countId: _id, position: _position, ...line }) => line),
    });
  }

  async insert(stockCount: StockCount): Promise<void> {
    const { lines, ...row } = stockCount.toSnapshot();
    await this.context.db.insert(stockCounts).values(row);
    await this.saveLines(row.id, lines);
  }

  async update(stockCount: StockCount): Promise<void> {
    const { lines, ...row } = stockCount.toSnapshot();
    await this.context.db.update(stockCounts).set(row).where(eq(stockCounts.id, row.id));
    await this.context.db.delete(stockCountLines).where(eq(stockCountLines.countId, row.id));
    await this.saveLines(row.id, lines);
  }

  private async saveLines(id: string, lines: ReturnType<StockCount['toSnapshot']>['lines']) {
    // Large counts go in slices to stay under the statement parameter limit.
    for (let start = 0; start < lines.length; start += 500) {
      await this.context.db
        .insert(stockCountLines)
        .values(
          lines.slice(start, start + 500).map((line, offset) => ({ ...line, countId: id, position: start + offset })),
        );
    }
  }

  async lotsAsOf(outletId: string, asOf: string, productIds?: readonly string[]): Promise<HeldLot[]> {
    return (
      this.context.db
        .select({
          productId: pharmacyMovements.productId,
          lotId: pharmacyMovements.lotId,
          qty: sql<number>`sum(${pharmacyMovements.qty})`.mapWith(Number),
          value: sql<number>`sum(${pharmacyMovements.qty} * ${pharmacyMovements.unitCost})`.mapWith(Number),
        })
        .from(pharmacyMovements)
        .innerJoin(pharmacyLots, eq(pharmacyLots.id, pharmacyMovements.lotId))
        .innerJoin(products, eq(products.id, pharmacyMovements.productId))
        .innerJoin(brands, eq(brands.id, products.brandId))
        .where(
          and(
            eq(pharmacyMovements.outletId, outletId),
            lte(pharmacyMovements.movedOn, asOf),
            productIds ? inArray(pharmacyMovements.productId, [...productIds]) : undefined,
          ),
        )
        .groupBy(
          brands.name,
          pharmacyMovements.productId,
          pharmacyMovements.lotId,
          pharmacyLots.expiryDate,
          pharmacyLots.batchNo,
        )
        .having(sql`sum(${pharmacyMovements.qty}) <> 0`)
        // Shelf order: by brand, then the earliest expiry first.
        .orderBy(
          asc(brands.name),
          asc(pharmacyMovements.productId),
          asc(pharmacyLots.expiryDate),
          asc(pharmacyLots.batchNo),
        )
    );
  }

  async balancesAsOf(outletId: string, lotIds: readonly string[], asOf: string): Promise<Map<string, number>> {
    if (lotIds.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        lotId: pharmacyMovements.lotId,
        qty: sql<number>`sum(${pharmacyMovements.qty})`.mapWith(Number),
      })
      .from(pharmacyMovements)
      .where(
        and(
          eq(pharmacyMovements.outletId, outletId),
          inArray(pharmacyMovements.lotId, [...new Set(lotIds)]),
          lte(pharmacyMovements.movedOn, asOf),
        ),
      )
      .groupBy(pharmacyMovements.lotId);
    return new Map(rows.map((row) => [row.lotId, row.qty]));
  }
}

@Injectable()
export class DrizzleCountReadRepository extends CountReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private headers() {
    const lines = sql<number>`(select count(*) from ${stockCountLines} where ${stockCountLines.countId} = ${stockCounts.id})`;
    const counted = sql<number>`(select count(*) from ${stockCountLines} where ${stockCountLines.countId} = ${stockCounts.id} and ${stockCountLines.countedQty} is not null)`;
    return this.context.db
      .select({
        id: stockCounts.id,
        number: stockCounts.number,
        countDate: stockCounts.countDate,
        outletId: stockCounts.outletId,
        outletName: outlets.name,
        status: stockCounts.status,
        lineCount: lines.mapWith(Number),
        countedLines: counted.mapWith(Number),
        shortageValue: stockCounts.shortageValue,
        excessValue: stockCounts.excessValue,
        writtenOffValue: stockCounts.writtenOffValue,
        note: stockCounts.note,
        voucherNumber: stockCounts.voucherNumber,
        cancelReason: stockCounts.cancelReason,
        createdBy: stockCounts.createdBy,
        appliedBy: stockCounts.appliedBy,
        appliedAt: stockCounts.appliedAt,
        version: stockCounts.version,
      })
      .from(stockCounts)
      .innerJoin(outlets, eq(outlets.id, stockCounts.outletId));
  }

  async listCounts(filter: CountFilter): Promise<Page<CountSummary>> {
    const where = and(
      filter.outletId ? eq(stockCounts.outletId, filter.outletId) : undefined,
      filter.status ? eq(stockCounts.status, filter.status as 'counting') : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.headers()
        .where(where)
        .orderBy(desc(stockCounts.countDate), desc(stockCounts.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(stockCounts).where(where),
    ]);
    return toPage(
      rows.map(
        ({ note: _n, voucherNumber: _v, cancelReason: _c, createdBy: _b, appliedBy: _a, appliedAt: _t, ...row }) => row,
      ),
      total?.n ?? 0,
      filter,
    );
  }

  async getCount(id: string): Promise<CountView | null> {
    const [header] = await this.headers().where(eq(stockCounts.id, id));
    if (!header) return null;
    const lines = await this.context.db
      .select({
        position: stockCountLines.position,
        productId: stockCountLines.productId,
        lotId: stockCountLines.lotId,
        batchNo: pharmacyLots.batchNo,
        expiryDate: pharmacyLots.expiryDate,
        systemQty: stockCountLines.systemQty,
        countedQty: stockCountLines.countedQty,
        unitCost: stockCountLines.unitCost,
        note: stockCountLines.note,
        writeOff: stockCountLines.writeOff,
        appliedSystemQty: stockCountLines.appliedSystemQty,
        adjustedQty: stockCountLines.adjustedQty,
      })
      .from(stockCountLines)
      .innerJoin(pharmacyLots, eq(pharmacyLots.id, stockCountLines.lotId))
      .where(eq(stockCountLines.countId, id))
      .orderBy(asc(stockCountLines.position));
    const named = await productsById(
      this.context,
      lines.map((line) => line.productId),
    );
    return {
      ...header,
      lines: lines.map(({ position, productId, ...line }) => ({
        ...productRef(named.get(productId)!),
        line: position + 1,
        ...line,
        expired: line.expiryDate <= header.countDate,
        adjustedValue: line.adjustedQty === null ? null : cents(line.adjustedQty * line.unitCost),
      })),
    };
  }
}
