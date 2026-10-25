import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ConflictError, NotFoundError } from '../../../../shared/domain/errors.js';
import {
  foreignKeyViolationConstraint,
  uniqueViolationConstraint,
} from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  CatalogueFacts,
  OpeningRepository,
  ReceiveRepository,
  StockLedger,
  type CatalogueVariant,
  type NewMovement,
  type OpeningRecord,
  type PayableSupplier,
  type StockPlace,
} from '../../domain/repositories.js';
import type { LotBalance } from '../../domain/allocation.js';
import { StockReceive } from '../../domain/stock-receive.js';
import {
  items,
  itemVariants,
  stockLots,
  stockMovements,
  stockOpenings,
  stockReceiveLines,
  stockReceives,
  suppliers,
} from './supply-chain.schema.js';

const REFERENCES: Record<string, string> = {
  stock_receives_main_store_id_main_stores_id_fk: 'main_store',
  stock_receives_supplier_id_suppliers_id_fk: 'supplier',
  stock_receives_purchase_order_id_purchase_orders_id_fk: 'purchase_order',
  stock_receive_lines_variant_id_item_variants_id_fk: 'item_variant',
  stock_openings_main_store_id_main_stores_id_fk: 'main_store',
  stock_openings_sub_store_id_sub_stores_id_fk: 'sub_store',
  stock_movements_main_store_id_main_stores_id_fk: 'main_store',
  stock_movements_sub_store_id_sub_stores_id_fk: 'sub_store',
};
const UNIQUE: Record<string, { code: string; message: string }> = {
  stock_receives_invoice_uq: {
    code: 'supplier_invoice_taken',
    message: "The supplier's invoice is already on another receive",
  },
  stock_receives_challan_uq: {
    code: 'supplier_challan_taken',
    message: "The supplier's challan is already on another receive",
  },
};

async function translated<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const reference = foreignKeyViolationConstraint(error);
    if (reference !== null) throw new NotFoundError(REFERENCES[reference] ?? 'referenced_record');
    const unique = uniqueViolationConstraint(error);
    const conflict = unique === null ? undefined : UNIQUE[unique];
    if (conflict) throw new ConflictError(conflict.code, conflict.message);
    throw error;
  }
}

const placeColumns = (place: StockPlace) => ({
  mainStoreId: 'mainStoreId' in place ? place.mainStoreId : null,
  subStoreId: 'subStoreId' in place ? place.subStoreId : null,
  departmentId: 'departmentId' in place ? place.departmentId : null,
});

/** The movements of one place. */
export const atPlace = (place: StockPlace) =>
  'mainStoreId' in place
    ? eq(stockMovements.mainStoreId, place.mainStoreId)
    : 'subStoreId' in place
      ? eq(stockMovements.subStoreId, place.subStoreId)
      : eq(stockMovements.departmentId, place.departmentId);

@Injectable()
export class DrizzleStockLedger extends StockLedger {
  constructor(private readonly context: DbContext) {
    super();
  }

  async lot(variantId: string, batchNo: string | null, expiryDate: string | null): Promise<string> {
    const [created] = await translated(() =>
      this.context.db
        .insert(stockLots)
        .values({ id: randomUUID(), variantId, batchNo, expiryDate })
        .onConflictDoNothing()
        .returning({ id: stockLots.id }),
    );
    if (created) return created.id;
    const [existing] = await this.context.db
      .select({ id: stockLots.id })
      .from(stockLots)
      .where(
        and(
          eq(stockLots.variantId, variantId),
          batchNo === null ? isNull(stockLots.batchNo) : sql`upper(${stockLots.batchNo}) = upper(${batchNo})`,
          expiryDate === null ? isNull(stockLots.expiryDate) : eq(stockLots.expiryDate, expiryDate),
        ),
      );
    return existing!.id;
  }

  async balances(place: StockPlace, variantIds: readonly string[]): Promise<Map<string, LotBalance[]>> {
    const balances = new Map<string, LotBalance[]>();
    if (variantIds.length === 0) return balances;
    const rows = await this.context.db
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
      .where(and(atPlace(place), inArray(stockMovements.variantId, [...new Set(variantIds)])))
      .groupBy(stockMovements.variantId, stockMovements.lotId, stockLots.batchNo, stockLots.expiryDate)
      .having(sql`sum(${stockMovements.qty}) > 0`);
    for (const { variantId, ...lot } of rows) balances.set(variantId, [...(balances.get(variantId) ?? []), lot]);
    return balances;
  }

  async lotCost(lotId: string): Promise<number> {
    const [row] = await this.context.db
      .select({
        cost: sql<number>`coalesce(sum(${stockMovements.qty} * ${stockMovements.unitCost}) / nullif(sum(${stockMovements.qty}), 0), 0)`.mapWith(
          Number,
        ),
      })
      .from(stockMovements)
      .where(and(eq(stockMovements.lotId, lotId), inArray(stockMovements.kind, ['opening', 'receive'])));
    return Math.round((row?.cost ?? 0) * 10_000) / 10_000;
  }

  async reverse(documentId: string, on: string): Promise<void> {
    const rows = await this.context.db.select().from(stockMovements).where(eq(stockMovements.documentId, documentId));
    if (rows.length === 0) return;
    await this.context.db
      .insert(stockMovements)
      .values(
        rows.map(({ id: _id, createdAt: _at, ...row }) => ({ ...row, id: randomUUID(), qty: -row.qty, movedOn: on })),
      );
  }

  async add(movements: readonly NewMovement[]): Promise<void> {
    if (movements.length === 0) return;
    await translated(() =>
      this.context.db.insert(stockMovements).values(
        movements.map(({ store, ...movement }) => ({
          id: randomUUID(),
          ...placeColumns(store),
          ...movement,
        })),
      ),
    );
  }
}

@Injectable()
export class DrizzleCatalogueFacts extends CatalogueFacts {
  constructor(private readonly context: DbContext) {
    super();
  }

  async variants(ids: readonly string[]): Promise<Map<string, CatalogueVariant>> {
    const unique = [...new Set(ids)];
    const rows =
      unique.length === 0
        ? []
        : await this.context.db
            .select({
              id: itemVariants.id,
              isActive: sql<boolean>`${itemVariants.isActive} and ${items.isActive}`,
              expiryRequired: itemVariants.expiryRequired,
              inventoryGlAccountId: items.typeGlAccountId,
            })
            .from(itemVariants)
            .innerJoin(items, eq(items.id, itemVariants.itemId))
            .where(inArray(itemVariants.id, unique));
    if (rows.length !== unique.length) throw new NotFoundError('item_variant');
    return new Map(rows.map(({ id, ...variant }) => [id, variant]));
  }

  async supplier(id: string): Promise<PayableSupplier | null> {
    const [row] = await this.context.db
      .select({
        name: suppliers.name,
        isActive: suppliers.isActive,
        glAccountId: suppliers.glAccountId,
        subLedgerId: suppliers.subLedgerId,
      })
      .from(suppliers)
      .where(eq(suppliers.id, id));
    return row ?? null;
  }

  async updatePurchasePrices(rates: ReadonlyMap<string, number>): Promise<void> {
    for (const [variantId, rate] of rates) {
      await this.context.db
        .update(itemVariants)
        .set({ purchasePrice: rate, updatedAt: new Date() })
        .where(eq(itemVariants.id, variantId));
    }
  }
}

@Injectable()
export class DrizzleReceiveRepository extends ReceiveRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<StockReceive | null> {
    const [row] = await this.context.db.select().from(stockReceives).where(eq(stockReceives.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(stockReceiveLines)
      .where(eq(stockReceiveLines.receiveId, id))
      .orderBy(asc(stockReceiveLines.position));
    return StockReceive.restore({
      ...row,
      lines: lines.map(({ receiveId: _id, position: _position, lotId: _lot, ...line }) => line),
    });
  }

  async insert(receive: StockReceive): Promise<void> {
    const { lines, ...row } = receive.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(stockReceives).values(row);
      await this.saveLines(row.id, lines);
    });
  }

  async update(receive: StockReceive): Promise<void> {
    const { lines, ...row } = receive.toSnapshot();
    await translated(async () => {
      await this.context.db.update(stockReceives).set(row).where(eq(stockReceives.id, row.id));
      await this.context.db.delete(stockReceiveLines).where(eq(stockReceiveLines.receiveId, row.id));
      await this.saveLines(row.id, lines);
    });
  }

  async delete(id: string): Promise<void> {
    await this.context.db.delete(stockReceives).where(eq(stockReceives.id, id));
  }

  async setLots(receiveId: string, lotIds: readonly string[]): Promise<void> {
    for (const [position, lotId] of lotIds.entries()) {
      await this.context.db
        .update(stockReceiveLines)
        .set({ lotId })
        .where(and(eq(stockReceiveLines.receiveId, receiveId), eq(stockReceiveLines.position, position)));
    }
  }

  private async saveLines(id: string, lines: ReturnType<StockReceive['toSnapshot']>['lines']) {
    await this.context.db
      .insert(stockReceiveLines)
      .values(lines.map((line, position) => ({ ...line, receiveId: id, position })));
  }
}

@Injectable()
export class DrizzleOpeningRepository extends OpeningRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insert({ store, ...opening }: OpeningRecord): Promise<void> {
    const { departmentId: _department, ...columns } = placeColumns(store);
    await translated(() => this.context.db.insert(stockOpenings).values({ ...opening, ...columns }));
  }
}
