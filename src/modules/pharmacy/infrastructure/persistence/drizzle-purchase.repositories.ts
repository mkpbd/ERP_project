import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ConflictError, NotFoundError } from '../../../../shared/domain/errors.js';
import {
  foreignKeyViolationConstraint,
  uniqueViolationConstraint,
} from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { SupplierDirectory } from '../../../../shared/application/contracts/supplier-directory.js';
import { PharmacyOrder } from '../../domain/purchase-order.js';
import { PharmacyReceive } from '../../domain/receive.js';
import {
  OpeningRepository,
  OrderRepository,
  PharmacyFacts,
  PharmacyLedger,
  PharmacySequences,
  ReceiveRepository,
  type CatalogueProduct,
  type NewMovement,
  type OpeningRecord,
  type PayableSupplier,
} from '../../domain/repositories.js';
import {
  outlets,
  outletUsers,
  pharmacyLots,
  pharmacyMovements,
  pharmacyOpenings,
  pharmacyOrderLines,
  pharmacyOrders,
  pharmacyReceiveLines,
  pharmacyReceives,
  pharmacySequences,
  products,
} from './pharmacy.schema.js';

const REFERENCES: Record<string, string> = {
  pharmacy_purchase_orders_supplier_id_suppliers_id_fk: 'supplier',
  pharmacy_purchase_orders_outlet_id_pharmacy_outlets_id_fk: 'outlet',
  pharmacy_purchase_order_lines_product_id_pharmacy_products_id_fk: 'product',
  pharmacy_receives_outlet_id_pharmacy_outlets_id_fk: 'outlet',
  pharmacy_receives_supplier_id_suppliers_id_fk: 'supplier',
  pharmacy_receives_purchase_order_id_pharmacy_purchase_orders_id_fk: 'purchase_order',
  pharmacy_receive_lines_product_id_pharmacy_products_id_fk: 'product',
  pharmacy_openings_outlet_id_pharmacy_outlets_id_fk: 'outlet',
  pharmacy_movements_outlet_id_pharmacy_outlets_id_fk: 'outlet',
  pharmacy_movements_product_id_pharmacy_products_id_fk: 'product',
};
const UNIQUE: Record<string, { code: string; message: string }> = {
  pharmacy_receives_invoice_uq: {
    code: 'supplier_invoice_taken',
    message: "The supplier's invoice is already on another receive",
  },
};

/** Constraint names are cut to 63 bytes by PostgreSQL. */
const lookup = <T>(entries: Record<string, T>, constraint: string): T | undefined =>
  entries[constraint] ?? Object.entries(entries).find(([name]) => name.slice(0, 63) === constraint)?.[1];

async function translated<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const reference = foreignKeyViolationConstraint(error);
    if (reference !== null) throw new NotFoundError(lookup(REFERENCES, reference) ?? 'referenced_record');
    const unique = uniqueViolationConstraint(error);
    const conflict = unique === null ? undefined : lookup(UNIQUE, unique);
    if (conflict) throw new ConflictError(conflict.code, conflict.message);
    throw error;
  }
}

@Injectable()
export class DrizzlePharmacySequences extends PharmacySequences {
  constructor(private readonly context: DbContext) {
    super();
  }

  async next(kind: string, year: number): Promise<number> {
    const [row] = await this.context.db
      .insert(pharmacySequences)
      .values({ kind, year, last: 1 })
      .onConflictDoUpdate({
        target: [pharmacySequences.kind, pharmacySequences.year],
        set: { last: sql`${pharmacySequences.last} + 1` },
      })
      .returning({ last: pharmacySequences.last });
    return row!.last;
  }
}

@Injectable()
export class DrizzlePharmacyLedger extends PharmacyLedger {
  constructor(private readonly context: DbContext) {
    super();
  }

  async lot(productId: string, batchNo: string | null, expiryDate: string, saleRate: number): Promise<string> {
    const [created] = await translated(() =>
      this.context.db
        .insert(pharmacyLots)
        .values({ id: randomUUID(), productId, batchNo, expiryDate, saleRate })
        .onConflictDoNothing()
        .returning({ id: pharmacyLots.id }),
    );
    if (created) return created.id;
    const [existing] = await this.context.db
      .select({ id: pharmacyLots.id })
      .from(pharmacyLots)
      .where(
        and(
          eq(pharmacyLots.productId, productId),
          sql`coalesce(upper(${pharmacyLots.batchNo}), '') = ${batchNo?.toUpperCase() ?? ''}`,
          eq(pharmacyLots.expiryDate, expiryDate),
          eq(pharmacyLots.saleRate, saleRate),
        ),
      );
    return existing!.id;
  }

  async add(movements: readonly NewMovement[]): Promise<void> {
    if (movements.length === 0) return;
    await translated(() =>
      this.context.db
        .insert(pharmacyMovements)
        .values(movements.map((movement) => ({ id: randomUUID(), ...movement }))),
    );
  }
}

@Injectable()
export class DrizzlePharmacyFacts extends PharmacyFacts {
  constructor(
    private readonly context: DbContext,
    private readonly suppliers: SupplierDirectory,
  ) {
    super();
  }

  async products(ids: readonly string[]): Promise<Map<string, CatalogueProduct>> {
    const unique = [...new Set(ids)];
    const rows =
      unique.length === 0
        ? []
        : await this.context.db
            .select({ id: products.id, isActive: products.isActive })
            .from(products)
            .where(inArray(products.id, unique));
    if (rows.length !== unique.length) throw new NotFoundError('product');
    return new Map(rows.map(({ id, ...product }) => [id, product]));
  }

  async supplier(id: string): Promise<PayableSupplier | null> {
    const [supplier] = await this.suppliers.find([id]);
    return supplier ?? null;
  }

  async outletExists(id: string): Promise<boolean> {
    const [row] = await this.context.db.select({ id: outlets.id }).from(outlets).where(eq(outlets.id, id));
    return row !== undefined;
  }

  async worksAt(userId: string, outletId: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: outletUsers.id })
      .from(outletUsers)
      .where(and(eq(outletUsers.userId, userId), eq(outletUsers.outletId, outletId)));
    return row !== undefined;
  }

  async updatePurchasePrices(rates: ReadonlyMap<string, number>): Promise<void> {
    for (const [productId, rate] of rates) {
      await this.context.db
        .update(products)
        .set({ purchasePrice: Math.round(rate * 100) / 100, updatedAt: new Date() })
        .where(eq(products.id, productId));
    }
  }
}

@Injectable()
export class DrizzleOrderRepository extends OrderRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<PharmacyOrder | null> {
    const [row] = await this.context.db.select().from(pharmacyOrders).where(eq(pharmacyOrders.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(pharmacyOrderLines)
      .where(eq(pharmacyOrderLines.orderId, id))
      .orderBy(asc(pharmacyOrderLines.position));
    return PharmacyOrder.restore({
      ...row,
      lines: lines.map(({ orderId: _id, position: _position, ...line }) => line),
    });
  }

  async insert(order: PharmacyOrder): Promise<void> {
    const { lines, ...row } = order.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(pharmacyOrders).values(row);
      await this.saveLines(row.id, lines);
    });
  }

  async update(order: PharmacyOrder): Promise<void> {
    const { lines, ...row } = order.toSnapshot();
    await translated(async () => {
      await this.context.db.update(pharmacyOrders).set(row).where(eq(pharmacyOrders.id, row.id));
      await this.context.db.delete(pharmacyOrderLines).where(eq(pharmacyOrderLines.orderId, row.id));
      await this.saveLines(row.id, lines);
    });
  }

  private async saveLines(id: string, lines: ReturnType<PharmacyOrder['toSnapshot']>['lines']) {
    await this.context.db
      .insert(pharmacyOrderLines)
      .values(lines.map((line, position) => ({ ...line, orderId: id, position })));
  }
}

@Injectable()
export class DrizzleReceiveRepository extends ReceiveRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<PharmacyReceive | null> {
    const [row] = await this.context.db
      .select()
      .from(pharmacyReceives)
      .where(eq(pharmacyReceives.id, id))
      .for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(pharmacyReceiveLines)
      .where(eq(pharmacyReceiveLines.receiveId, id))
      .orderBy(asc(pharmacyReceiveLines.position));
    return PharmacyReceive.restore({
      ...row,
      lines: lines.map(({ receiveId: _id, position: _position, lotId: _lot, ...line }) => line),
    });
  }

  async insert(receive: PharmacyReceive): Promise<void> {
    const { lines, ...row } = receive.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(pharmacyReceives).values(row);
      await this.saveLines(row.id, lines);
    });
  }

  async update(receive: PharmacyReceive): Promise<void> {
    const { lines, ...row } = receive.toSnapshot();
    await translated(async () => {
      await this.context.db.update(pharmacyReceives).set(row).where(eq(pharmacyReceives.id, row.id));
      await this.context.db.delete(pharmacyReceiveLines).where(eq(pharmacyReceiveLines.receiveId, row.id));
      await this.saveLines(row.id, lines);
    });
  }

  async delete(id: string): Promise<void> {
    await this.context.db.delete(pharmacyReceives).where(eq(pharmacyReceives.id, id));
  }

  async setLots(receiveId: string, lotIds: readonly string[]): Promise<void> {
    for (const [position, lotId] of lotIds.entries()) {
      await this.context.db
        .update(pharmacyReceiveLines)
        .set({ lotId })
        .where(and(eq(pharmacyReceiveLines.receiveId, receiveId), eq(pharmacyReceiveLines.position, position)));
    }
  }

  private async saveLines(id: string, lines: ReturnType<PharmacyReceive['toSnapshot']>['lines']) {
    await this.context.db
      .insert(pharmacyReceiveLines)
      .values(lines.map((line, position) => ({ ...line, receiveId: id, position })));
  }
}

@Injectable()
export class DrizzleOpeningRepository extends OpeningRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insert(opening: OpeningRecord): Promise<void> {
    await translated(() => this.context.db.insert(pharmacyOpenings).values(opening));
  }
}
