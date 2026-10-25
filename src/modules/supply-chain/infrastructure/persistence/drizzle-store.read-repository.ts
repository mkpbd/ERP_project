import { Injectable } from '@nestjs/common';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, gte, ilike, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import type { ItemRef } from '../../application/purchase.messages.js';
import {
  StoreReadRepository,
  type IndentSummary,
  type IndentView,
  type IssueSummary,
  type IssueView,
  type MovedPart,
  type RequestSummary,
  type RequestView,
  type StoreFilter,
  type TransferSummary,
  type TransferView,
} from '../../application/store.messages.js';
import type { TransferKind } from '../../domain/store-documents.js';
import {
  items,
  itemVariants,
  mainStores,
  purchaseRequisitions,
  stockLots,
  stockMovements,
  stockTransferLines,
  stockTransfers,
  storeDepartments,
  storeIndentApprovalLevels,
  storeIndentApprovals,
  storeIndentLines,
  storeIndents,
  storeIssues,
  storeRequestLines,
  storeRequests,
  subStores,
} from './supply-chain.schema.js';

const itemColumns = {
  variantId: itemVariants.id,
  variantName: itemVariants.name,
  code: itemVariants.code,
  itemName: items.name,
  unit: items.unit,
};

function conditions(
  filter: StoreFilter,
  columns: { status?: PgColumn; date: PgColumn; number: PgColumn },
  equal: [PgColumn, string | undefined][],
): SQL | undefined {
  return and(
    filter.status && columns.status ? eq(columns.status, filter.status) : undefined,
    filter.from ? gte(columns.date, filter.from) : undefined,
    filter.to ? lte(columns.date, filter.to) : undefined,
    filter.q ? ilike(columns.number, `%${escapeLike(filter.q)}%`) : undefined,
    ...equal.map(([column, value]) => (value ? eq(column, value) : undefined)),
  );
}

const fromMain = alias(mainStores, 'from_main');
const fromSub = alias(subStores, 'from_sub');
const toMain = alias(mainStores, 'to_main');
const toSub = alias(subStores, 'to_sub');

@Injectable()
export class DrizzleStoreReadRepository extends StoreReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private indentSummaries() {
    return this.context.db
      .select({
        id: storeIndents.id,
        number: storeIndents.number,
        indentDate: storeIndents.indentDate,
        subStoreId: storeIndents.subStoreId,
        subStoreName: subStores.name,
        departmentId: storeIndents.departmentId,
        departmentName: storeDepartments.name,
        priority: storeIndents.priority,
        status: storeIndents.status,
        currentLevel: storeIndents.currentLevel,
        currentLevelName: storeIndentApprovalLevels.name,
        lineCount: sql<number>`(select count(*) from ${storeIndentLines}
          where ${storeIndentLines.indentId} = ${storeIndents.id})`.mapWith(Number),
        version: storeIndents.version,
      })
      .from(storeIndents)
      .innerJoin(subStores, eq(subStores.id, storeIndents.subStoreId))
      .leftJoin(storeDepartments, eq(storeDepartments.id, storeIndents.departmentId))
      .leftJoin(
        storeIndentApprovalLevels,
        and(
          eq(storeIndentApprovalLevels.subStoreId, storeIndents.subStoreId),
          eq(storeIndentApprovalLevels.levelOrder, storeIndents.currentLevel),
        ),
      );
  }

  async listIndents(filter: StoreFilter): Promise<Page<IndentSummary>> {
    const where = conditions(
      filter,
      { status: storeIndents.status, date: storeIndents.indentDate, number: storeIndents.number },
      [
        [storeIndents.subStoreId, filter.subStoreId],
        [storeIndents.departmentId, filter.departmentId],
      ],
    );
    const [rows, [total]] = await Promise.all([
      this.indentSummaries()
        .where(where)
        .orderBy(desc(storeIndents.indentDate), desc(storeIndents.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(storeIndents).where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async getIndent(id: string): Promise<IndentView | null> {
    const [summary] = await this.indentSummaries().where(eq(storeIndents.id, id));
    if (!summary) return null;
    const [[header], lines, decisions] = await Promise.all([
      this.context.db
        .select({
          note: storeIndents.note,
          createdBy: storeIndents.createdBy,
          createdAt: storeIndents.createdAt,
          acknowledgedBy: storeIndents.acknowledgedBy,
          acknowledgedAt: storeIndents.acknowledgedAt,
        })
        .from(storeIndents)
        .where(eq(storeIndents.id, id)),
      this.context.db
        .select({
          ...itemColumns,
          qty: storeIndentLines.qty,
          approvedQty: storeIndentLines.approvedQty,
          servedQty: storeIndentLines.servedQty,
          remarks: storeIndentLines.remarks,
        })
        .from(storeIndentLines)
        .innerJoin(itemVariants, eq(itemVariants.id, storeIndentLines.variantId))
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .where(eq(storeIndentLines.indentId, id))
        .orderBy(asc(storeIndentLines.position)),
      this.context.db
        .select()
        .from(storeIndentApprovals)
        .where(eq(storeIndentApprovals.indentId, id))
        .orderBy(asc(storeIndentApprovals.levelOrder)),
    ]);
    return { ...summary, ...header!, lines, decisions: decisions.map(({ indentId: _id, ...decision }) => decision) };
  }

  async indentInbox(roleIds: readonly string[]): Promise<IndentSummary[]> {
    return this.indentSummaries()
      .where(and(eq(storeIndents.status, 'pending'), inArray(storeIndentApprovalLevels.roleId, [...roleIds])))
      .orderBy(asc(storeIndents.indentDate), asc(storeIndents.number))
      .limit(500);
  }

  private requestSummaries() {
    return this.context.db
      .select({
        id: storeRequests.id,
        number: storeRequests.number,
        requestDate: storeRequests.requestDate,
        subStoreId: storeRequests.subStoreId,
        subStoreName: subStores.name,
        mainStoreId: storeRequests.mainStoreId,
        mainStoreName: mainStores.name,
        status: storeRequests.status,
        purchaseRequisitionId: storeRequests.purchaseRequisitionId,
        purchaseRequisitionNumber: purchaseRequisitions.number,
        version: storeRequests.version,
      })
      .from(storeRequests)
      .innerJoin(subStores, eq(subStores.id, storeRequests.subStoreId))
      .innerJoin(mainStores, eq(mainStores.id, storeRequests.mainStoreId))
      .leftJoin(purchaseRequisitions, eq(purchaseRequisitions.id, storeRequests.purchaseRequisitionId));
  }

  async listRequests(filter: StoreFilter): Promise<Page<RequestSummary>> {
    const where = conditions(
      filter,
      { status: storeRequests.status, date: storeRequests.requestDate, number: storeRequests.number },
      [
        [storeRequests.subStoreId, filter.subStoreId],
        [storeRequests.mainStoreId, filter.mainStoreId],
      ],
    );
    const [rows, [total]] = await Promise.all([
      this.requestSummaries()
        .where(where)
        .orderBy(desc(storeRequests.requestDate), desc(storeRequests.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(storeRequests).where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async getRequest(id: string): Promise<RequestView | null> {
    const [summary] = await this.requestSummaries().where(eq(storeRequests.id, id));
    if (!summary) return null;
    const [[header], lines] = await Promise.all([
      this.context.db
        .select({ note: storeRequests.note, createdBy: storeRequests.createdBy, createdAt: storeRequests.createdAt })
        .from(storeRequests)
        .where(eq(storeRequests.id, id)),
      this.context.db
        .select({ ...itemColumns, qty: storeRequestLines.qty, servedQty: storeRequestLines.servedQty })
        .from(storeRequestLines)
        .innerJoin(itemVariants, eq(itemVariants.id, storeRequestLines.variantId))
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .where(eq(storeRequestLines.requestId, id))
        .orderBy(asc(storeRequestLines.position)),
    ]);
    return { ...summary, ...header!, lines };
  }

  private issueSummaries() {
    return this.context.db
      .select({
        id: storeIssues.id,
        number: storeIssues.number,
        issueDate: storeIssues.issueDate,
        subStoreId: storeIssues.subStoreId,
        subStoreName: subStores.name,
        departmentId: storeIssues.departmentId,
        departmentName: storeDepartments.name,
        indentId: storeIssues.indentId,
        indentNumber: storeIndents.number,
      })
      .from(storeIssues)
      .innerJoin(subStores, eq(subStores.id, storeIssues.subStoreId))
      .innerJoin(storeDepartments, eq(storeDepartments.id, storeIssues.departmentId))
      .leftJoin(storeIndents, eq(storeIndents.id, storeIssues.indentId));
  }

  async listIssues(filter: StoreFilter): Promise<Page<IssueSummary>> {
    const where = conditions(filter, { date: storeIssues.issueDate, number: storeIssues.number }, [
      [storeIssues.subStoreId, filter.subStoreId],
      [storeIssues.departmentId, filter.departmentId],
    ]);
    const [rows, [total]] = await Promise.all([
      this.issueSummaries()
        .where(where)
        .orderBy(desc(storeIssues.issueDate), desc(storeIssues.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(storeIssues).where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  /** The lots a document took out of its store, at their cost. */
  private async parts(documentId: string): Promise<{ parts: MovedPart[]; value: number }> {
    const rows = await this.context.db
      .select({
        ...itemColumns,
        batchNo: stockLots.batchNo,
        expiryDate: stockLots.expiryDate,
        qty: sql<number>`-${stockMovements.qty}`.mapWith(Number),
        unitCost: stockMovements.unitCost,
      })
      .from(stockMovements)
      .innerJoin(stockLots, eq(stockLots.id, stockMovements.lotId))
      .innerJoin(itemVariants, eq(itemVariants.id, stockMovements.variantId))
      .innerJoin(items, eq(items.id, itemVariants.itemId))
      .where(and(eq(stockMovements.documentId, documentId), lt(stockMovements.qty, 0)))
      .orderBy(asc(items.name), asc(itemVariants.name), asc(stockLots.expiryDate));
    const value = Math.round(rows.reduce((sum, part) => sum + part.qty * part.unitCost, 0) * 100) / 100;
    return { parts: rows, value };
  }

  async getIssue(id: string): Promise<IssueView | null> {
    const [summary] = await this.issueSummaries().where(eq(storeIssues.id, id));
    if (!summary) return null;
    const [[header], moved] = await Promise.all([
      this.context.db
        .select({
          receivedByStaffId: storeIssues.receivedByStaffId,
          note: storeIssues.note,
          issuedBy: storeIssues.issuedBy,
          createdAt: storeIssues.createdAt,
        })
        .from(storeIssues)
        .where(eq(storeIssues.id, id)),
      this.parts(id),
    ]);
    return { ...summary, ...header!, ...moved };
  }

  private transferSummaries() {
    return this.context.db
      .select({
        id: stockTransfers.id,
        number: stockTransfers.number,
        kind: stockTransfers.kind,
        transferDate: stockTransfers.transferDate,
        fromName: sql<string>`coalesce(${fromMain.name}, ${fromSub.name})`,
        toName: sql<string>`coalesce(${toMain.name}, ${toSub.name})`,
        fromMainStoreId: stockTransfers.fromMainStoreId,
        fromSubStoreId: stockTransfers.fromSubStoreId,
        toMainStoreId: stockTransfers.toMainStoreId,
        toSubStoreId: stockTransfers.toSubStoreId,
        requestId: stockTransfers.requestId,
        requestNumber: storeRequests.number,
        status: stockTransfers.status,
        version: stockTransfers.version,
      })
      .from(stockTransfers)
      .leftJoin(fromMain, eq(fromMain.id, stockTransfers.fromMainStoreId))
      .leftJoin(fromSub, eq(fromSub.id, stockTransfers.fromSubStoreId))
      .leftJoin(toMain, eq(toMain.id, stockTransfers.toMainStoreId))
      .leftJoin(toSub, eq(toSub.id, stockTransfers.toSubStoreId))
      .leftJoin(storeRequests, eq(storeRequests.id, stockTransfers.requestId));
  }

  async listTransfers(filter: StoreFilter & { kind?: TransferKind | undefined }): Promise<Page<TransferSummary>> {
    const where = and(
      conditions(
        filter,
        { status: stockTransfers.status, date: stockTransfers.transferDate, number: stockTransfers.number },
        [
          [stockTransfers.kind, filter.kind],
          [stockTransfers.requestId, filter.requestId],
        ],
      ),
      filter.subStoreId
        ? or(eq(stockTransfers.fromSubStoreId, filter.subStoreId), eq(stockTransfers.toSubStoreId, filter.subStoreId))
        : undefined,
      filter.mainStoreId
        ? or(
            eq(stockTransfers.fromMainStoreId, filter.mainStoreId),
            eq(stockTransfers.toMainStoreId, filter.mainStoreId),
          )
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.transferSummaries()
        .where(where)
        .orderBy(desc(stockTransfers.transferDate), desc(stockTransfers.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(stockTransfers).where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async getTransfer(id: string): Promise<TransferView | null> {
    const [summary] = await this.transferSummaries().where(eq(stockTransfers.id, id));
    if (!summary) return null;
    const [[header], lines, moved] = await Promise.all([
      this.context.db
        .select({
          note: stockTransfers.note,
          rejectReason: stockTransfers.rejectReason,
          sentBy: stockTransfers.sentBy,
          decidedBy: stockTransfers.decidedBy,
          decidedAt: stockTransfers.decidedAt,
        })
        .from(stockTransfers)
        .where(eq(stockTransfers.id, id)),
      this.context.db
        .select({
          ...itemColumns,
          qty: stockTransferLines.qty,
          acceptedQty: stockTransferLines.acceptedQty,
          lotId: stockTransferLines.lotId,
        })
        .from(stockTransferLines)
        .innerJoin(itemVariants, eq(itemVariants.id, stockTransferLines.variantId))
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .where(eq(stockTransferLines.transferId, id))
        .orderBy(asc(stockTransferLines.position)),
      this.parts(id),
    ]);
    return { ...summary, ...header!, lines, ...moved };
  }

  async items(variantIds: readonly string[]): Promise<Map<string, ItemRef>> {
    if (variantIds.length === 0) return new Map();
    const rows = await this.context.db
      .select(itemColumns)
      .from(itemVariants)
      .innerJoin(items, eq(items.id, itemVariants.itemId))
      .where(inArray(itemVariants.id, [...variantIds]));
    return new Map(rows.map((row) => [row.variantId, row]));
  }
}
