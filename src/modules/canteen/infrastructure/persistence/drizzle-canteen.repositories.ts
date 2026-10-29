import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  CanteenReadRepository,
  type MemberStatement,
  type SaleFilter,
  type SaleView,
} from '../../application/canteen.messages.js';
import {
  CanteenRepository,
  type CollectionRow,
  type Member,
  type Outlet,
  type SaleRow,
} from '../../domain/repositories.js';
import type { CanteenItem, PricedLine } from '../../domain/sale.js';
import {
  canteenCollections,
  canteenGroups,
  canteenItems,
  canteenMembers,
  canteenOutletUsers,
  canteenOutlets,
  canteenSaleLines,
  canteenSales,
  canteenSequences,
} from './canteen.schema.js';

const cents = (value: number) => Math.round(value * 100) / 100;

function saleRow(row: typeof canteenSales.$inferSelect): SaleRow {
  const { createdAt: _created, updatedAt: _updated, ...rest } = row;
  return rest;
}

@Injectable()
export class DrizzleCanteenRepository extends CanteenRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async nextSerial(kind: string, year: number): Promise<number> {
    const [row] = await this.context.db
      .insert(canteenSequences)
      .values({ kind, year, last: 1 })
      .onConflictDoUpdate({
        target: [canteenSequences.kind, canteenSequences.year],
        set: { last: sql`${canteenSequences.last} + 1` },
      })
      .returning({ last: canteenSequences.last });
    return row!.last;
  }

  async items(ids: readonly string[]): Promise<Map<string, CanteenItem>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        id: canteenItems.id,
        name: canteenItems.name,
        unit: canteenItems.unit,
        rate: canteenItems.rate,
        staffRate: canteenItems.staffRate,
        vatPercent: canteenItems.vatPercent,
        stockVariantId: canteenItems.stockVariantId,
        stockQty: canteenItems.stockQty,
        isActive: canteenItems.isActive,
      })
      .from(canteenItems)
      .where(inArray(canteenItems.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async outlet(id: string): Promise<Outlet | null> {
    const [row] = await this.context.db
      .select({
        id: canteenOutlets.id,
        name: canteenOutlets.name,
        storeDepartmentId: canteenOutlets.storeDepartmentId,
        isActive: canteenOutlets.isActive,
      })
      .from(canteenOutlets)
      .where(eq(canteenOutlets.id, id));
    return row ?? null;
  }

  async isOutletUser(outletId: string, userId: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ userId: canteenOutletUsers.userId })
      .from(canteenOutletUsers)
      .where(and(eq(canteenOutletUsers.outletId, outletId), eq(canteenOutletUsers.userId, userId)));
    return !!row;
  }

  async setOutletUsers(outletId: string, userIds: readonly string[]): Promise<void> {
    await this.context.db.delete(canteenOutletUsers).where(eq(canteenOutletUsers.outletId, outletId));
    if (userIds.length) {
      await this.context.db.insert(canteenOutletUsers).values(userIds.map((userId) => ({ outletId, userId })));
    }
  }

  async memberForUpdate(id: string): Promise<Member | null> {
    const [row] = await this.context.db
      .select({
        id: canteenMembers.id,
        name: canteenMembers.name,
        mobileNo: canteenMembers.mobileNo,
        isActive: canteenMembers.isActive,
      })
      .from(canteenMembers)
      .where(eq(canteenMembers.id, id))
      .for('update');
    return row ?? null;
  }

  async memberBalance(id: string): Promise<number> {
    const [dues] = await this.context.db
      .select({ total: sql<number>`coalesce(sum(${canteenSales.due}), 0)`.mapWith(Number) })
      .from(canteenSales)
      .where(and(eq(canteenSales.memberId, id), ne(canteenSales.status, 'cancelled')));
    const [paid] = await this.context.db
      .select({ total: sql<number>`coalesce(sum(${canteenCollections.amount}), 0)`.mapWith(Number) })
      .from(canteenCollections)
      .where(eq(canteenCollections.memberId, id));
    return cents((dues?.total ?? 0) - (paid?.total ?? 0));
  }

  async insertSale(sale: SaleRow, lines: readonly PricedLine[]): Promise<void> {
    await this.context.db.insert(canteenSales).values(sale);
    await this.context.db
      .insert(canteenSaleLines)
      .values(lines.map((line, index) => ({ ...line, saleId: sale.id, position: index + 1 })));
  }

  async saleForUpdate(id: string): Promise<SaleRow | null> {
    const [row] = await this.context.db.select().from(canteenSales).where(eq(canteenSales.id, id)).for('update');
    return row ? saleRow(row) : null;
  }

  async cancelSale(id: string, reason: string, by: string, at: Date, version: number): Promise<void> {
    await this.context.db
      .update(canteenSales)
      .set({ status: 'cancelled', cancelReason: reason, cancelledBy: by, cancelledAt: at, version, updatedAt: at })
      .where(eq(canteenSales.id, id));
  }

  async insertCollection(collection: CollectionRow): Promise<void> {
    await this.context.db.insert(canteenCollections).values(collection);
  }
}

@Injectable()
export class DrizzleCanteenReadRepository extends CanteenReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async sales(filter: SaleFilter): Promise<Page<SaleRow & { outletName: string }>> {
    const conditions: SQL[] = [];
    if (filter.outletId) conditions.push(eq(canteenSales.outletId, filter.outletId));
    if (filter.memberId) conditions.push(eq(canteenSales.memberId, filter.memberId));
    if (filter.from) conditions.push(gte(canteenSales.soldOn, filter.from));
    if (filter.to) conditions.push(lte(canteenSales.soldOn, filter.to));
    if (filter.status) conditions.push(eq(canteenSales.status, filter.status));
    const where = conditions.length ? and(...conditions) : undefined;
    const [total] = await this.context.db.select({ n: count() }).from(canteenSales).where(where);
    const rows = await this.context.db
      .select({ sale: canteenSales, outletName: canteenOutlets.name })
      .from(canteenSales)
      .innerJoin(canteenOutlets, eq(canteenOutlets.id, canteenSales.outletId))
      .where(where)
      .orderBy(desc(canteenSales.soldAt))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    return toPage(
      rows.map((row) => ({ ...saleRow(row.sale), outletName: row.outletName })),
      total?.n ?? 0,
      filter,
    );
  }

  async sale(id: string): Promise<SaleView | null> {
    const [row] = await this.context.db
      .select({ sale: canteenSales, outletName: canteenOutlets.name, memberName: canteenMembers.name })
      .from(canteenSales)
      .innerJoin(canteenOutlets, eq(canteenOutlets.id, canteenSales.outletId))
      .leftJoin(canteenMembers, eq(canteenMembers.id, canteenSales.memberId))
      .where(eq(canteenSales.id, id));
    if (!row) return null;
    const lines = await this.context.db
      .select({
        itemId: canteenSaleLines.itemId,
        itemName: canteenItems.name,
        unit: canteenItems.unit,
        qty: canteenSaleLines.qty,
        rate: canteenSaleLines.rate,
        amount: canteenSaleLines.amount,
        vat: canteenSaleLines.vat,
      })
      .from(canteenSaleLines)
      .innerJoin(canteenItems, eq(canteenItems.id, canteenSaleLines.itemId))
      .where(eq(canteenSaleLines.saleId, id))
      .orderBy(asc(canteenSaleLines.position));
    return { ...saleRow(row.sale), outletName: row.outletName, memberName: row.memberName, lines };
  }

  async outletUsers(outletId: string): Promise<string[]> {
    const rows = await this.context.db
      .select({ userId: canteenOutletUsers.userId })
      .from(canteenOutletUsers)
      .where(eq(canteenOutletUsers.outletId, outletId));
    return rows.map((row) => row.userId);
  }

  async memberStatement(memberId: string): Promise<MemberStatement | null> {
    const [member] = await this.context.db
      .select({ id: canteenMembers.id, name: canteenMembers.name, mobileNo: canteenMembers.mobileNo })
      .from(canteenMembers)
      .where(eq(canteenMembers.id, memberId));
    if (!member) return null;
    const sales = await this.context.db
      .select({ on: canteenSales.soldOn, number: canteenSales.number, due: canteenSales.due, at: canteenSales.soldAt })
      .from(canteenSales)
      .where(
        and(eq(canteenSales.memberId, memberId), ne(canteenSales.status, 'cancelled'), sql`${canteenSales.due} > 0`),
      );
    const collections = await this.context.db
      .select({
        on: canteenCollections.receivedOn,
        number: canteenCollections.number,
        amount: canteenCollections.amount,
        at: canteenCollections.createdAt,
      })
      .from(canteenCollections)
      .where(eq(canteenCollections.memberId, memberId));
    const moves = [
      ...sales.map((entry) => ({
        on: entry.on,
        at: entry.at,
        number: entry.number,
        kind: 'sale' as const,
        debit: entry.due,
        credit: 0,
      })),
      ...collections.map((entry) => ({
        on: entry.on,
        at: entry.at,
        number: entry.number,
        kind: 'collection' as const,
        debit: 0,
        credit: entry.amount,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    let balance = 0;
    const entries = moves.map(({ at: _at, ...entry }) => {
      balance = cents(balance + entry.debit - entry.credit);
      return { ...entry, balance };
    });
    return { member, entries, balance };
  }

  async dues(): Promise<{ id: string; name: string; mobileNo: string; balance: number }[]> {
    const rows = await this.context.db
      .select({
        id: canteenMembers.id,
        name: canteenMembers.name,
        mobileNo: canteenMembers.mobileNo,
        balance:
          sql<number>`(select coalesce(sum(${canteenSales.due}), 0) from ${canteenSales} where ${canteenSales.memberId} = ${canteenMembers.id} and ${canteenSales.status} <> 'cancelled') - (select coalesce(sum(${canteenCollections.amount}), 0) from ${canteenCollections} where ${canteenCollections.memberId} = ${canteenMembers.id})`.mapWith(
            Number,
          ),
      })
      .from(canteenMembers);
    return rows.filter((row) => row.balance > 0).sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  }

  itemSales(from: string, to: string, outletId: string | null) {
    const conditions = [
      ne(canteenSales.status, 'cancelled'),
      gte(canteenSales.soldOn, from),
      lte(canteenSales.soldOn, to),
    ];
    if (outletId) conditions.push(eq(canteenSales.outletId, outletId));
    return this.context.db
      .select({
        itemName: canteenItems.name,
        groupName: canteenGroups.name,
        qty: sql<number>`sum(${canteenSaleLines.qty})`.mapWith(Number),
        amount: sql<number>`sum(${canteenSaleLines.amount})`.mapWith(Number),
        vat: sql<number>`sum(${canteenSaleLines.vat})`.mapWith(Number),
      })
      .from(canteenSaleLines)
      .innerJoin(canteenSales, eq(canteenSales.id, canteenSaleLines.saleId))
      .innerJoin(canteenItems, eq(canteenItems.id, canteenSaleLines.itemId))
      .innerJoin(canteenGroups, eq(canteenGroups.id, canteenItems.groupId))
      .where(and(...conditions))
      .groupBy(canteenItems.name, canteenGroups.name)
      .orderBy(asc(canteenGroups.name), asc(canteenItems.name));
  }

  async collection(id: string): Promise<CollectionRow | null> {
    const [row] = await this.context.db.select().from(canteenCollections).where(eq(canteenCollections.id, id));
    if (!row) return null;
    const { createdAt: _created, ...rest } = row;
    return rest;
  }
}
