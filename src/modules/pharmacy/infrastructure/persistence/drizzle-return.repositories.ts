import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, lte } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  ReturnReadRepository,
  type ReturnFilter,
  type SaleReturnSummary,
  type SaleReturnView,
} from '../../application/return.messages.js';
import { ReturnPolicies, SaleReturnRepository, type SaleReturnRecord } from '../../domain/repositories.js';
import type { ReturnChannel, ReturnPolicy } from '../../domain/return-window.js';
import { productRef, productsById } from './drizzle-pharmacy.read-repository.js';
import {
  loyalMembers,
  outlets,
  pharmacyLots,
  pharmacySales,
  returnPolicies,
  saleReturnLines,
  saleReturns,
} from './pharmacy.schema.js';

@Injectable()
export class DrizzleReturnPolicies extends ReturnPolicies {
  constructor(private readonly context: DbContext) {
    super();
  }

  async policy(channel: ReturnChannel): Promise<ReturnPolicy | null> {
    const [row] = await this.context.db
      .select({ isEnabled: returnPolicies.isEnabled, days: returnPolicies.days })
      .from(returnPolicies)
      .where(eq(returnPolicies.channel, channel));
    return row ?? null;
  }

  async save(channel: ReturnChannel, policy: ReturnPolicy, by: string): Promise<void> {
    const values = { ...policy, updatedBy: by, updatedAt: new Date() };
    await this.context.db
      .insert(returnPolicies)
      .values({ channel, ...values })
      .onConflictDoUpdate({ target: returnPolicies.channel, set: values });
  }
}

@Injectable()
export class DrizzleSaleReturnRepository extends SaleReturnRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insert({ parts, ...saleReturn }: SaleReturnRecord): Promise<void> {
    await this.context.db.insert(saleReturns).values(saleReturn);
    await this.context.db.insert(saleReturnLines).values(
      parts.map((part, position) => ({
        returnId: saleReturn.id,
        position,
        saleLine: part.saleLine,
        productId: part.productId,
        lotId: part.lotId,
        qty: part.qty,
        saleRate: part.saleRate,
        amount: part.amount,
        discount: part.discount,
        refund: part.refund,
        unitCost: part.unitCost,
      })),
    );
  }
}

@Injectable()
export class DrizzleReturnReadRepository extends ReturnReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async policies(): Promise<Record<ReturnChannel, ReturnPolicy | null>> {
    const rows = await this.context.db.select().from(returnPolicies);
    const of = (channel: ReturnChannel) => {
      const row = rows.find((entry) => entry.channel === channel);
      return row ? { isEnabled: row.isEnabled, days: row.days } : null;
    };
    return { opd: of('opd'), ipd: of('ipd') };
  }

  private headers() {
    return this.context.db
      .select({
        id: saleReturns.id,
        number: saleReturns.number,
        returnedOn: saleReturns.returnedOn,
        saleId: saleReturns.saleId,
        saleNumber: pharmacySales.number,
        soldOn: pharmacySales.soldOn,
        customerName: pharmacySales.customerName,
        loyalMemberName: loyalMembers.name,
        outletName: outlets.name,
        reason: saleReturns.reason,
        amount: saleReturns.amount,
        discount: saleReturns.discount,
        refund: saleReturns.refund,
        dueReduced: saleReturns.dueReduced,
        cashRefund: saleReturns.cashRefund,
        voucherNumber: saleReturns.voucherNumber,
      })
      .from(saleReturns)
      .innerJoin(pharmacySales, eq(pharmacySales.id, saleReturns.saleId))
      .innerJoin(outlets, eq(outlets.id, saleReturns.outletId))
      .leftJoin(loyalMembers, eq(loyalMembers.id, pharmacySales.loyalMemberId));
  }

  async listReturns(filter: ReturnFilter): Promise<Page<SaleReturnSummary>> {
    const where = and(
      filter.saleId ? eq(saleReturns.saleId, filter.saleId) : undefined,
      filter.outletId ? eq(saleReturns.outletId, filter.outletId) : undefined,
      filter.from ? gte(saleReturns.returnedOn, filter.from) : undefined,
      filter.to ? lte(saleReturns.returnedOn, filter.to) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.headers()
        .where(where)
        .orderBy(desc(saleReturns.returnedOn), desc(saleReturns.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(saleReturns).where(where),
    ]);
    return toPage(
      rows.map(
        ({
          soldOn: _s,
          customerName: _c,
          loyalMemberName: _l,
          reason: _r,
          amount: _a,
          discount: _d,
          voucherNumber: _v,
          ...row
        }) => row,
      ),
      total?.n ?? 0,
      filter,
    );
  }

  async getReturn(id: string): Promise<SaleReturnView | null> {
    const [header] = await this.headers().where(eq(saleReturns.id, id));
    if (!header) return null;
    const lines = await this.context.db
      .select({
        saleLine: saleReturnLines.saleLine,
        productId: saleReturnLines.productId,
        batchNo: pharmacyLots.batchNo,
        expiryDate: pharmacyLots.expiryDate,
        qty: saleReturnLines.qty,
        saleRate: saleReturnLines.saleRate,
        amount: saleReturnLines.amount,
        discount: saleReturnLines.discount,
        refund: saleReturnLines.refund,
      })
      .from(saleReturnLines)
      .innerJoin(pharmacyLots, eq(pharmacyLots.id, saleReturnLines.lotId))
      .where(eq(saleReturnLines.returnId, id))
      .orderBy(asc(saleReturnLines.position));
    const named = await productsById(
      this.context,
      lines.map((line) => line.productId),
    );
    return {
      ...header,
      lines: lines.map(({ productId, ...line }) => ({ ...productRef(named.get(productId)!), ...line })),
    };
  }
}
