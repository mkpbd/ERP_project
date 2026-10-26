import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { foreignKeyViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import type { DiscountPolicy, ProductDiscount } from '../../domain/discount.js';
import { DiscountRules, SaleRepository, type CollectionRecord } from '../../domain/repositories.js';
import { PharmacySale, type SaleDue } from '../../domain/sale.js';
import {
  discountPolicy,
  dueCollectionLines,
  dueCollections,
  loyalMembers,
  pharmacySaleLines,
  pharmacySales,
  productDiscounts,
} from './pharmacy.schema.js';

@Injectable()
export class DrizzleDiscountRules extends DiscountRules {
  constructor(private readonly context: DbContext) {
    super();
  }

  async policy(): Promise<DiscountPolicy | null> {
    const [row] = await this.context.db
      .select({
        allowedByDefault: discountPolicy.allowedByDefault,
        opdPercent: discountPolicy.opdPercent,
        ipdPercent: discountPolicy.ipdPercent,
      })
      .from(discountPolicy)
      .where(eq(discountPolicy.id, 1));
    return row ?? null;
  }

  async savePolicy(policy: DiscountPolicy, by: string): Promise<void> {
    const values = { ...policy, updatedBy: by, updatedAt: new Date() };
    await this.context.db
      .insert(discountPolicy)
      .values({ id: 1, ...values })
      .onConflictDoUpdate({ target: discountPolicy.id, set: values });
  }

  async productRules(productIds: readonly string[]): Promise<Map<string, ProductDiscount>> {
    if (productIds.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        productId: productDiscounts.productId,
        isAllowed: productDiscounts.isAllowed,
        opdPercent: productDiscounts.opdPercent,
        ipdPercent: productDiscounts.ipdPercent,
      })
      .from(productDiscounts)
      .where(inArray(productDiscounts.productId, [...new Set(productIds)]));
    return new Map(rows.map(({ productId, ...rule }) => [productId, rule]));
  }
}

@Injectable()
export class DrizzleSaleRepository extends SaleRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<PharmacySale | null> {
    const [row] = await this.context.db.select().from(pharmacySales).where(eq(pharmacySales.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(pharmacySaleLines)
      .where(eq(pharmacySaleLines.saleId, id))
      .orderBy(asc(pharmacySaleLines.position));
    return PharmacySale.restore({
      ...row,
      lines: lines.map(({ saleId: _id, position: _position, ...line }) => line),
    });
  }

  async insert(sale: PharmacySale): Promise<void> {
    const { lines, ...row } = sale.toSnapshot();
    try {
      await this.context.db.insert(pharmacySales).values(row);
    } catch (error) {
      if (foreignKeyViolationConstraint(error)?.includes('loyal_member')) throw new NotFoundError('loyal_member');
      throw error;
    }
    await this.context.db
      .insert(pharmacySaleLines)
      .values(lines.map((line, position) => ({ ...line, saleId: row.id, position })));
  }

  async update(sale: PharmacySale): Promise<void> {
    const { lines, ...row } = sale.toSnapshot();
    await this.context.db.update(pharmacySales).set(row).where(eq(pharmacySales.id, row.id));
    for (const [position, line] of lines.entries()) {
      await this.context.db
        .update(pharmacySaleLines)
        .set({ returnedQty: line.returnedQty })
        .where(and(eq(pharmacySaleLines.saleId, row.id), eq(pharmacySaleLines.position, position)));
    }
  }

  async memberIsActive(loyalMemberId: string): Promise<boolean | null> {
    const [row] = await this.context.db
      .select({ isActive: loyalMembers.isActive })
      .from(loyalMembers)
      .where(eq(loyalMembers.id, loyalMemberId));
    return row?.isActive ?? null;
  }

  async memberDues(loyalMemberId: string): Promise<SaleDue[]> {
    return this.context.db
      .select({
        saleId: pharmacySales.id,
        soldOn: pharmacySales.soldOn,
        number: pharmacySales.number,
        due: pharmacySales.due,
        collected: sql<number>`${pharmacySales.collected} + ${pharmacySales.dueReturned}`.mapWith(Number),
      })
      .from(pharmacySales)
      .where(
        and(
          eq(pharmacySales.loyalMemberId, loyalMemberId),
          eq(pharmacySales.status, 'completed'),
          sql`${pharmacySales.due} > ${pharmacySales.collected} + ${pharmacySales.dueReturned}`,
        ),
      )
      .orderBy(asc(pharmacySales.soldOn), asc(pharmacySales.number))
      .for('update');
  }

  async insertCollection({ lines, ...collection }: CollectionRecord): Promise<void> {
    await this.context.db.insert(dueCollections).values(collection);
    await this.context.db
      .insert(dueCollectionLines)
      .values(lines.map((line) => ({ ...line, collectionId: collection.id })));
    for (const line of lines) {
      await this.context.db
        .update(pharmacySales)
        .set({
          collected: sql`${pharmacySales.collected} + ${line.amount}`,
          version: sql`${pharmacySales.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(pharmacySales.id, line.saleId));
    }
  }
}
