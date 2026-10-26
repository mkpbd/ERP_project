import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import type { ProductRef } from '../../application/purchase.messages.js';
import {
  SaleReadRepository,
  type MemberDues,
  type SaleFilter,
  type SaleSummary,
  type SaleView,
} from '../../application/sale.messages.js';
import { productRef, productsById } from './drizzle-pharmacy.read-repository.js';
import { loyalMembers, outlets, pharmacyLots, pharmacySaleLines, pharmacySales } from './pharmacy.schema.js';

const cents = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class DrizzleSaleReadRepository extends SaleReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private headers() {
    return this.context.db
      .select({
        id: pharmacySales.id,
        number: pharmacySales.number,
        soldOn: pharmacySales.soldOn,
        outletId: pharmacySales.outletId,
        outletName: outlets.name,
        customerName: pharmacySales.customerName,
        mobileNo: pharmacySales.mobileNo,
        loyalMemberId: pharmacySales.loyalMemberId,
        loyalMemberName: loyalMembers.name,
        amount: pharmacySales.amount,
        discount: pharmacySales.discount,
        total: pharmacySales.total,
        method: pharmacySales.method,
        reference: pharmacySales.reference,
        tendered: pharmacySales.tendered,
        paid: pharmacySales.paid,
        due: pharmacySales.due,
        collected: pharmacySales.collected,
        returned: pharmacySales.returned,
        status: pharmacySales.status,
        cancelReason: pharmacySales.cancelReason,
        cancelledOn: pharmacySales.cancelledOn,
        voucherNumber: pharmacySales.voucherNumber,
        soldBy: pharmacySales.soldBy,
        version: pharmacySales.version,
      })
      .from(pharmacySales)
      .innerJoin(outlets, eq(outlets.id, pharmacySales.outletId))
      .leftJoin(loyalMembers, eq(loyalMembers.id, pharmacySales.loyalMemberId));
  }

  async listSales(filter: SaleFilter): Promise<Page<SaleSummary>> {
    const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
    const where = and(
      filter.outletId ? eq(pharmacySales.outletId, filter.outletId) : undefined,
      filter.loyalMemberId ? eq(pharmacySales.loyalMemberId, filter.loyalMemberId) : undefined,
      filter.status ? eq(pharmacySales.status, filter.status as 'completed') : undefined,
      filter.from ? gte(pharmacySales.soldOn, filter.from) : undefined,
      filter.to ? lte(pharmacySales.soldOn, filter.to) : undefined,
      like
        ? or(
            ilike(pharmacySales.number, like),
            ilike(pharmacySales.customerName, like),
            ilike(pharmacySales.mobileNo, like),
          )
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.headers()
        .where(where)
        .orderBy(desc(pharmacySales.soldOn), desc(pharmacySales.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(pharmacySales).where(where),
    ]);
    return toPage(
      rows.map(
        ({
          amount: _a,
          discount: _d,
          method: _m,
          reference: _r,
          tendered: _t,
          cancelReason: _c,
          cancelledOn: _o,
          voucherNumber: _v,
          soldBy: _s,
          returned: _rt,
          ...row
        }) => row,
      ),
      total?.n ?? 0,
      filter,
    );
  }

  async getSale(id: string): Promise<SaleView | null> {
    const [header] = await this.headers().where(eq(pharmacySales.id, id));
    if (!header) return null;
    const lines = await this.context.db
      .select({
        productId: pharmacySaleLines.productId,
        lotId: pharmacySaleLines.lotId,
        batchNo: pharmacyLots.batchNo,
        expiryDate: pharmacyLots.expiryDate,
        qty: pharmacySaleLines.qty,
        saleRate: pharmacySaleLines.saleRate,
        amount: pharmacySaleLines.amount,
        discountPercent: pharmacySaleLines.discountPercent,
        discount: pharmacySaleLines.discount,
        total: pharmacySaleLines.total,
        returnedQty: pharmacySaleLines.returnedQty,
      })
      .from(pharmacySaleLines)
      .innerJoin(pharmacyLots, eq(pharmacyLots.id, pharmacySaleLines.lotId))
      .where(eq(pharmacySaleLines.saleId, id))
      .orderBy(asc(pharmacySaleLines.position));
    const named = await productsById(
      this.context,
      lines.map((line) => line.productId),
    );
    return {
      ...header,
      change: cents(header.tendered - header.paid),
      lines: lines.map(({ productId, ...line }) => ({ ...productRef(named.get(productId)!), ...line })),
    };
  }

  async memberDues(loyalMemberId: string): Promise<MemberDues | null> {
    const [member] = await this.context.db
      .select({ name: loyalMembers.name, contactNo: loyalMembers.contactNo })
      .from(loyalMembers)
      .where(eq(loyalMembers.id, loyalMemberId));
    if (!member) return null;
    const sales = await this.context.db
      .select({
        saleId: pharmacySales.id,
        number: pharmacySales.number,
        soldOn: pharmacySales.soldOn,
        total: pharmacySales.total,
        due: pharmacySales.due,
        /** Collected, and taken down by returns. */
        collected: sql<number>`${pharmacySales.collected} + ${pharmacySales.dueReturned}`.mapWith(Number),
      })
      .from(pharmacySales)
      .where(and(eq(pharmacySales.loyalMemberId, loyalMemberId), eq(pharmacySales.status, 'completed')))
      .orderBy(asc(pharmacySales.soldOn), asc(pharmacySales.number));
    const owing = sales.filter((sale) => sale.due > sale.collected);
    return {
      loyalMemberId,
      ...member,
      due: cents(owing.reduce((sum, sale) => sum + sale.due - sale.collected, 0)),
      sales: owing,
    };
  }

  async lotLabels(lotIds: readonly string[]) {
    if (lotIds.length === 0) return new Map<string, { batchNo: string | null; expiryDate: string }>();
    const rows = await this.context.db
      .select({ id: pharmacyLots.id, batchNo: pharmacyLots.batchNo, expiryDate: pharmacyLots.expiryDate })
      .from(pharmacyLots)
      .where(inArray(pharmacyLots.id, [...new Set(lotIds)]));
    return new Map(rows.map(({ id, ...label }) => [id, label]));
  }

  async productRefs(productIds: readonly string[]): Promise<Map<string, ProductRef>> {
    const named = await productsById(this.context, productIds);
    return new Map([...named].map(([id, row]) => [id, productRef(row)]));
  }
}
