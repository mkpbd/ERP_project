import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, sql, sum, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  PurchaseReadRepository,
  type DocumentFilter,
  type OrderSummary,
  type OrderView,
  type RequisitionSummary,
  type RequisitionView,
  type StudySummary,
  type StudyView,
} from '../../application/purchase.messages.js';
import { orderLineAmounts, orderTotals } from '../../domain/purchase-order.js';
import {
  comparativeStudies,
  comparativeStudyApprovals,
  comparativeStudyQuotes,
  csApprovalLevels,
  items,
  itemVariants,
  mainStores,
  purchaseApprovalLevels,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequisitionApprovals,
  purchaseRequisitionLines,
  purchaseRequisitions,
  storeDepartments,
  subStores,
  suppliers,
} from './supply-chain.schema.js';

/** Common list conditions: status, date range, number (partial) and the given equality filters. */
function conditions(
  filter: DocumentFilter,
  columns: { status: PgColumn; date: PgColumn; number: PgColumn },
  equal: [PgColumn, string | undefined][],
): SQL | undefined {
  return and(
    filter.status ? eq(columns.status, filter.status) : undefined,
    filter.from ? gte(columns.date, filter.from) : undefined,
    filter.to ? lte(columns.date, filter.to) : undefined,
    filter.q ? ilike(columns.number, `%${escapeLike(filter.q)}%`) : undefined,
    ...equal.map(([column, value]) => (value ? eq(column, value) : undefined)),
  );
}

const itemColumns = {
  variantId: itemVariants.id,
  variantName: itemVariants.name,
  code: itemVariants.code,
  itemName: items.name,
  unit: items.unit,
};

@Injectable()
export class DrizzlePurchaseReadRepository extends PurchaseReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private requisitionSummaries() {
    return this.context.db
      .select({
        id: purchaseRequisitions.id,
        number: purchaseRequisitions.number,
        requisitionDate: purchaseRequisitions.requisitionDate,
        mainStoreId: purchaseRequisitions.mainStoreId,
        mainStoreName: mainStores.name,
        departmentName: storeDepartments.name,
        supplierName: suppliers.name,
        paymentTerm: purchaseRequisitions.paymentTerm,
        status: purchaseRequisitions.status,
        currentLevel: purchaseRequisitions.currentLevel,
        currentLevelName: purchaseApprovalLevels.name,
        lineCount: sql<number>`(select count(*) from ${purchaseRequisitionLines}
          where ${purchaseRequisitionLines.requisitionId} = ${purchaseRequisitions.id})`.mapWith(Number),
        version: purchaseRequisitions.version,
      })
      .from(purchaseRequisitions)
      .innerJoin(mainStores, eq(mainStores.id, purchaseRequisitions.mainStoreId))
      .leftJoin(storeDepartments, eq(storeDepartments.id, purchaseRequisitions.departmentId))
      .leftJoin(suppliers, eq(suppliers.id, purchaseRequisitions.supplierId))
      .leftJoin(
        purchaseApprovalLevels,
        and(
          eq(purchaseApprovalLevels.mainStoreId, purchaseRequisitions.mainStoreId),
          eq(purchaseApprovalLevels.levelOrder, purchaseRequisitions.currentLevel),
        ),
      );
  }

  async listRequisitions(filter: DocumentFilter): Promise<Page<RequisitionSummary>> {
    const where = conditions(
      filter,
      {
        status: purchaseRequisitions.status,
        date: purchaseRequisitions.requisitionDate,
        number: purchaseRequisitions.number,
      },
      [
        [purchaseRequisitions.mainStoreId, filter.mainStoreId],
        [purchaseRequisitions.supplierId, filter.supplierId],
      ],
    );
    const [rows, [total]] = await Promise.all([
      this.requisitionSummaries()
        .where(where)
        .orderBy(desc(purchaseRequisitions.requisitionDate), desc(purchaseRequisitions.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(purchaseRequisitions).where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async getRequisition(id: string): Promise<RequisitionView | null> {
    const [summary] = await this.requisitionSummaries().where(eq(purchaseRequisitions.id, id));
    if (!summary) return null;
    const [[header], lines, decisions, ordered] = await Promise.all([
      this.context.db
        .select({
          subStoreId: purchaseRequisitions.subStoreId,
          subStoreName: subStores.name,
          departmentId: purchaseRequisitions.departmentId,
          supplierId: purchaseRequisitions.supplierId,
          note: purchaseRequisitions.note,
          terms: purchaseRequisitions.terms,
          createdBy: purchaseRequisitions.createdBy,
          createdAt: purchaseRequisitions.createdAt,
        })
        .from(purchaseRequisitions)
        .leftJoin(subStores, eq(subStores.id, purchaseRequisitions.subStoreId))
        .where(eq(purchaseRequisitions.id, id)),
      this.context.db
        .select({
          ...itemColumns,
          requestedQty: purchaseRequisitionLines.requestedQty,
          approvedQty: purchaseRequisitionLines.approvedQty,
          description: purchaseRequisitionLines.description,
        })
        .from(purchaseRequisitionLines)
        .innerJoin(itemVariants, eq(itemVariants.id, purchaseRequisitionLines.variantId))
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .where(eq(purchaseRequisitionLines.requisitionId, id))
        .orderBy(asc(purchaseRequisitionLines.position)),
      this.context.db
        .select()
        .from(purchaseRequisitionApprovals)
        .where(eq(purchaseRequisitionApprovals.requisitionId, id))
        .orderBy(asc(purchaseRequisitionApprovals.levelOrder)),
      this.context.db
        .select({ variantId: purchaseOrderLines.variantId, qty: sum(purchaseOrderLines.qty).mapWith(Number) })
        .from(purchaseOrderLines)
        .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
        .where(and(eq(purchaseOrders.requisitionId, id), ne(purchaseOrders.status, 'cancelled')))
        .groupBy(purchaseOrderLines.variantId),
    ]);
    const orderedOf = new Map(ordered.map((row) => [row.variantId, row.qty]));
    return {
      ...summary,
      ...header!,
      lines: lines.map((line) => ({ ...line, orderedQty: orderedOf.get(line.variantId) ?? 0 })),
      decisions: decisions.map(({ requisitionId: _id, ...decision }) => decision),
    };
  }

  async requisitionInbox(roleIds: readonly string[]): Promise<RequisitionSummary[]> {
    return this.requisitionSummaries()
      .where(and(eq(purchaseRequisitions.status, 'pending'), inArray(purchaseApprovalLevels.roleId, [...roleIds])))
      .orderBy(asc(purchaseRequisitions.requisitionDate), asc(purchaseRequisitions.number))
      .limit(500);
  }

  private studySummaries() {
    return this.context.db
      .select({
        id: comparativeStudies.id,
        number: comparativeStudies.number,
        studyDate: comparativeStudies.studyDate,
        title: comparativeStudies.title,
        requisitionId: comparativeStudies.requisitionId,
        requisitionNumber: purchaseRequisitions.number,
        status: comparativeStudies.status,
        currentLevel: comparativeStudies.currentLevel,
        currentLevelName: csApprovalLevels.name,
        quoteCount: sql<number>`(select count(*) from ${comparativeStudyQuotes}
          where ${comparativeStudyQuotes.studyId} = ${comparativeStudies.id})`.mapWith(Number),
        version: comparativeStudies.version,
      })
      .from(comparativeStudies)
      .leftJoin(purchaseRequisitions, eq(purchaseRequisitions.id, comparativeStudies.requisitionId))
      .leftJoin(csApprovalLevels, eq(csApprovalLevels.levelOrder, comparativeStudies.currentLevel));
  }

  async listStudies(filter: DocumentFilter): Promise<Page<StudySummary>> {
    const where = conditions(
      filter,
      { status: comparativeStudies.status, date: comparativeStudies.studyDate, number: comparativeStudies.number },
      [[comparativeStudies.requisitionId, filter.requisitionId]],
    );
    const [rows, [total]] = await Promise.all([
      this.studySummaries()
        .where(where)
        .orderBy(desc(comparativeStudies.studyDate), desc(comparativeStudies.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(comparativeStudies).where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async getStudy(id: string): Promise<StudyView | null> {
    const [summary] = await this.studySummaries().where(eq(comparativeStudies.id, id));
    if (!summary) return null;
    const [[header], quotes, decisions] = await Promise.all([
      this.context.db
        .select({
          note: comparativeStudies.note,
          createdBy: comparativeStudies.createdBy,
          createdAt: comparativeStudies.createdAt,
        })
        .from(comparativeStudies)
        .where(eq(comparativeStudies.id, id)),
      this.context.db
        .select({
          id: comparativeStudyQuotes.id,
          supplierId: comparativeStudyQuotes.supplierId,
          supplierName: suppliers.name,
          variantId: comparativeStudyQuotes.variantId,
          variantName: itemVariants.name,
          itemName: items.name,
          unit: items.unit,
          manualName: comparativeStudyQuotes.manualName,
          qty: comparativeStudyQuotes.qty,
          unitPrice: comparativeStudyQuotes.unitPrice,
          vatPercent: comparativeStudyQuotes.vatPercent,
          aitPercent: comparativeStudyQuotes.aitPercent,
          vat: comparativeStudyQuotes.vat,
          ait: comparativeStudyQuotes.ait,
          total: comparativeStudyQuotes.total,
          selected: comparativeStudyQuotes.selected,
        })
        .from(comparativeStudyQuotes)
        .innerJoin(suppliers, eq(suppliers.id, comparativeStudyQuotes.supplierId))
        .leftJoin(itemVariants, eq(itemVariants.id, comparativeStudyQuotes.variantId))
        .leftJoin(items, eq(items.id, itemVariants.itemId))
        .where(eq(comparativeStudyQuotes.studyId, id))
        .orderBy(asc(comparativeStudyQuotes.position)),
      this.context.db
        .select()
        .from(comparativeStudyApprovals)
        .where(eq(comparativeStudyApprovals.studyId, id))
        .orderBy(asc(comparativeStudyApprovals.levelOrder)),
    ]);
    return {
      ...summary,
      ...header!,
      quotes: quotes.map(({ variantName, itemName, ...quote }) => ({
        ...quote,
        itemName: quote.manualName ?? `${itemName ?? ''} — ${variantName ?? ''}`,
      })),
      decisions: decisions.map(({ studyId: _id, ...decision }) => decision),
    };
  }

  async studyInbox(staffId: string): Promise<StudySummary[]> {
    return this.studySummaries()
      .where(and(eq(comparativeStudies.status, 'pending'), eq(csApprovalLevels.approverStaffId, staffId)))
      .orderBy(asc(comparativeStudies.studyDate), asc(comparativeStudies.number))
      .limit(500);
  }

  private orderHeaders() {
    return this.context.db
      .select({
        id: purchaseOrders.id,
        number: purchaseOrders.number,
        orderDate: purchaseOrders.orderDate,
        expectedOn: purchaseOrders.expectedOn,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        supplierAddress: suppliers.address,
        supplierContactNo: suppliers.contactNo,
        mainStoreId: purchaseOrders.mainStoreId,
        mainStoreName: mainStores.name,
        requisitionId: purchaseOrders.requisitionId,
        requisitionNumber: purchaseRequisitions.number,
        comparativeStudyId: purchaseOrders.comparativeStudyId,
        comparativeStudyNumber: comparativeStudies.number,
        status: purchaseOrders.status,
        terms: purchaseOrders.terms,
        note: purchaseOrders.note,
        cancelReason: purchaseOrders.cancelReason,
        createdBy: purchaseOrders.createdBy,
        createdAt: purchaseOrders.createdAt,
        version: purchaseOrders.version,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .innerJoin(mainStores, eq(mainStores.id, purchaseOrders.mainStoreId))
      .leftJoin(purchaseRequisitions, eq(purchaseRequisitions.id, purchaseOrders.requisitionId))
      .leftJoin(comparativeStudies, eq(comparativeStudies.id, purchaseOrders.comparativeStudyId));
  }

  private async orderLines(orderIds: readonly string[]) {
    if (orderIds.length === 0) return [];
    return this.context.db
      .select({
        orderId: purchaseOrderLines.orderId,
        ...itemColumns,
        qty: purchaseOrderLines.qty,
        rate: purchaseOrderLines.rate,
        vatPercent: purchaseOrderLines.vatPercent,
        receivedQty: purchaseOrderLines.receivedQty,
      })
      .from(purchaseOrderLines)
      .innerJoin(itemVariants, eq(itemVariants.id, purchaseOrderLines.variantId))
      .innerJoin(items, eq(items.id, itemVariants.itemId))
      .where(inArray(purchaseOrderLines.orderId, [...orderIds]))
      .orderBy(asc(purchaseOrderLines.orderId), asc(purchaseOrderLines.position));
  }

  async listOrders(filter: DocumentFilter): Promise<Page<OrderSummary>> {
    const where = conditions(
      filter,
      { status: purchaseOrders.status, date: purchaseOrders.orderDate, number: purchaseOrders.number },
      [
        [purchaseOrders.mainStoreId, filter.mainStoreId],
        [purchaseOrders.supplierId, filter.supplierId],
        [purchaseOrders.requisitionId, filter.requisitionId],
      ],
    );
    const [rows, [total]] = await Promise.all([
      this.orderHeaders()
        .where(where)
        .orderBy(desc(purchaseOrders.orderDate), desc(purchaseOrders.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(purchaseOrders).where(where),
    ]);
    const lines = await this.orderLines(rows.map((row) => row.id));
    const items = rows.map(
      ({
        supplierAddress: _a,
        supplierContactNo: _c,
        terms: _t,
        note: _n,
        cancelReason: _r,
        createdBy: _b,
        createdAt: _at,
        ...row
      }) => ({
        ...row,
        ...orderTotals(lines.filter((line) => line.orderId === row.id)),
      }),
    );
    return toPage(items, total?.n ?? 0, filter);
  }

  async getOrder(id: string): Promise<OrderView | null> {
    const [header] = await this.orderHeaders().where(eq(purchaseOrders.id, id));
    if (!header) return null;
    const lines = await this.orderLines([id]);
    return {
      ...header,
      ...orderTotals(lines),
      lines: lines.map(({ orderId: _id, ...line }) => ({ ...line, ...orderLineAmounts(line) })),
    };
  }
}
