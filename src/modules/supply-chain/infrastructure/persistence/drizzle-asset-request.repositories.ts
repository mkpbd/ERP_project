import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page, type PageRequest } from '../../../../shared/application/pagination.js';
import { ConflictError, NotFoundError } from '../../../../shared/domain/errors.js';
import { uniqueViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  AssetRequestReadRepository,
  type AssetDocumentKind,
  type AssetDocumentSummary,
  type AssetDocumentView,
} from '../../application/asset-request.handlers.js';
import {
  DiscardRequest,
  ScrapSale,
  ServiceRequest,
  type AssetDecision,
  type AssetFlow,
} from '../../domain/asset-requests.js';
import { AssetRequestRepository, type PurchaseApprovalLevel, type RequestPiece } from '../../domain/repositories.js';
import {
  assetApprovalLevels,
  assetDecisions,
  assetLocks,
  discardRequestLines,
  discardRequests,
  fixedAssets,
  items,
  itemVariants,
  scrapSales,
  serviceRequestLines,
  serviceRequests,
} from './supply-chain.schema.js';

@Injectable()
export class DrizzleAssetRequestRepository extends AssetRequestRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async levels(flow: AssetFlow): Promise<PurchaseApprovalLevel[]> {
    const rows = await this.context.db
      .select({
        order: assetApprovalLevels.levelOrder,
        name: assetApprovalLevels.name,
        roleId: assetApprovalLevels.roleId,
      })
      .from(assetApprovalLevels)
      .where(eq(assetApprovalLevels.flow, flow))
      .orderBy(asc(assetApprovalLevels.levelOrder));
    return rows.map((row) => ({ ...row, isFinal: false }));
  }

  async pieces(ids: readonly string[]): Promise<RequestPiece[]> {
    if (ids.length === 0) return [];
    const rows = await this.context.db
      .select({
        id: fixedAssets.id,
        assetNo: fixedAssets.assetNo,
        status: fixedAssets.status,
        variantId: fixedAssets.variantId,
        lotId: fixedAssets.lotId,
        cost: fixedAssets.cost,
        mainStoreId: fixedAssets.mainStoreId,
        subStoreId: fixedAssets.subStoreId,
        departmentId: fixedAssets.departmentId,
        inventoryGlAccountId: items.typeGlAccountId,
      })
      .from(fixedAssets)
      .innerJoin(itemVariants, eq(itemVariants.id, fixedAssets.variantId))
      .innerJoin(items, eq(items.id, itemVariants.itemId))
      .where(inArray(fixedAssets.id, [...ids]))
      .orderBy(asc(fixedAssets.assetNo))
      .for('update', { of: fixedAssets });
    if (rows.length !== new Set(ids).size) throw new NotFoundError('fixed_asset');
    return rows.map(({ mainStoreId, subStoreId, departmentId, ...row }) => ({
      ...row,
      place: mainStoreId ? { mainStoreId } : subStoreId ? { subStoreId } : departmentId ? { departmentId } : null,
    }));
  }

  async lock(ids: readonly string[], kind: 'service' | 'discard', requestId: string): Promise<void> {
    try {
      await this.context.db.insert(assetLocks).values(ids.map((assetId) => ({ assetId, kind, requestId })));
    } catch (error) {
      if (uniqueViolationConstraint(error) !== null) {
        throw new ConflictError('asset_busy', 'A piece is already on another open request');
      }
      throw error;
    }
  }

  async unlock(ids: readonly string[]): Promise<void> {
    if (ids.length > 0) await this.context.db.delete(assetLocks).where(inArray(assetLocks.assetId, [...ids]));
  }

  async setStatus(ids: readonly string[], status: 'in_stock' | 'out_for_service'): Promise<void> {
    if (ids.length > 0) {
      await this.context.db
        .update(fixedAssets)
        .set({ status, updatedAt: new Date() })
        .where(inArray(fixedAssets.id, [...ids]));
    }
  }

  async discard(ids: readonly string[]): Promise<void> {
    await this.context.db
      .update(fixedAssets)
      .set({ status: 'discarded', mainStoreId: null, subStoreId: null, departmentId: null, updatedAt: new Date() })
      .where(inArray(fixedAssets.id, [...ids]));
  }

  async markSold(ids: readonly string[]): Promise<void> {
    await this.context.db
      .update(fixedAssets)
      .set({ status: 'sold', updatedAt: new Date() })
      .where(inArray(fixedAssets.id, [...ids]));
  }

  private async decisions(documentId: string): Promise<AssetDecision[]> {
    return decisionsOf(this.context, documentId);
  }

  private async saveDecisions(documentId: string, decisions: readonly AssetDecision[]): Promise<void> {
    await this.context.db.delete(assetDecisions).where(eq(assetDecisions.documentId, documentId));
    if (decisions.length > 0) {
      await this.context.db
        .insert(assetDecisions)
        .values(decisions.map((decision, position) => ({ ...decision, documentId, position })));
    }
  }

  async findService(id: string): Promise<ServiceRequest | null> {
    const [row] = await this.context.db.select().from(serviceRequests).where(eq(serviceRequests.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(serviceRequestLines)
      .where(eq(serviceRequestLines.requestId, id))
      .orderBy(asc(serviceRequestLines.position));
    return ServiceRequest.restore({
      ...row,
      lines: lines.map(({ requestId: _id, position: _position, ...line }) => line),
      decisions: await this.decisions(id),
    });
  }

  async saveService(request: ServiceRequest, isNew: boolean): Promise<void> {
    const { lines, decisions, ...row } = request.toSnapshot();
    if (isNew) await this.context.db.insert(serviceRequests).values(row);
    else await this.context.db.update(serviceRequests).set(row).where(eq(serviceRequests.id, row.id));
    await this.context.db.delete(serviceRequestLines).where(eq(serviceRequestLines.requestId, row.id));
    await this.context.db
      .insert(serviceRequestLines)
      .values(lines.map((line, position) => ({ ...line, requestId: row.id, position })));
    await this.saveDecisions(row.id, decisions);
  }

  async findDiscard(id: string): Promise<DiscardRequest | null> {
    const [row] = await this.context.db.select().from(discardRequests).where(eq(discardRequests.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(discardRequestLines)
      .where(eq(discardRequestLines.requestId, id))
      .orderBy(asc(discardRequestLines.position));
    const { disposalRunId: _run, disposalVoucherNumber: _voucher, saleVoucherNumber: _sale, ...props } = row;
    return DiscardRequest.restore({
      ...props,
      lines: lines.map(({ requestId: _id, position: _position, bookValue: _book, ...line }) => line),
      decisions: await this.decisions(id),
    });
  }

  async saveDiscard(request: DiscardRequest, isNew: boolean): Promise<void> {
    const { lines, decisions, ...row } = request.toSnapshot();
    if (isNew) {
      await this.context.db.insert(discardRequests).values(row);
      await this.context.db
        .insert(discardRequestLines)
        .values(lines.map((line, position) => ({ ...line, requestId: row.id, position })));
    } else {
      await this.context.db.update(discardRequests).set(row).where(eq(discardRequests.id, row.id));
      for (const [position, line] of lines.entries()) {
        await this.context.db
          .update(discardRequestLines)
          .set({ rejected: line.rejected, saleAmount: line.saleAmount })
          .where(and(eq(discardRequestLines.requestId, row.id), eq(discardRequestLines.position, position)));
      }
    }
    await this.saveDecisions(row.id, decisions);
  }

  async recordDisposal(
    requestId: string,
    values: { runId: string | null; voucherNumber: string | null; bookValues: ReadonlyMap<string, number> },
  ): Promise<void> {
    await this.context.db
      .update(discardRequests)
      .set({ disposalRunId: values.runId, disposalVoucherNumber: values.voucherNumber })
      .where(eq(discardRequests.id, requestId));
    for (const [assetId, bookValue] of values.bookValues) {
      await this.context.db
        .update(discardRequestLines)
        .set({ bookValue })
        .where(and(eq(discardRequestLines.requestId, requestId), eq(discardRequestLines.assetId, assetId)));
    }
  }

  async recordSale(requestId: string, voucherNumber: string | null): Promise<void> {
    await this.context.db
      .update(discardRequests)
      .set({ saleVoucherNumber: voucherNumber })
      .where(eq(discardRequests.id, requestId));
  }

  async findScrap(id: string): Promise<ScrapSale | null> {
    const [row] = await this.context.db.select().from(scrapSales).where(eq(scrapSales.id, id)).for('update');
    if (!row) return null;
    const { voucherNumber: _voucher, ...props } = row;
    return ScrapSale.restore({ ...props, decisions: await this.decisions(id) });
  }

  async saveScrap(sale: ScrapSale, isNew: boolean, voucherNumber?: string | null): Promise<void> {
    const { decisions, ...row } = sale.toSnapshot();
    const values = { ...row, ...(voucherNumber !== undefined ? { voucherNumber } : {}) };
    if (isNew) await this.context.db.insert(scrapSales).values(values);
    else await this.context.db.update(scrapSales).set(values).where(eq(scrapSales.id, row.id));
    await this.saveDecisions(row.id, decisions);
  }
}

async function decisionsOf(context: DbContext, documentId: string): Promise<AssetDecision[]> {
  const rows = await context.db
    .select()
    .from(assetDecisions)
    .where(eq(assetDecisions.documentId, documentId))
    .orderBy(asc(assetDecisions.position));
  return rows.map(({ documentId: _id, position: _position, ...decision }) => decision);
}

interface Header {
  readonly table: PgTable;
  readonly id: PgColumn;
  readonly number: PgColumn;
  readonly date: PgColumn;
  readonly status: PgColumn;
  readonly currentLevel: PgColumn;
  readonly version: PgColumn;
  readonly party: PgColumn;
  /** The ladder the current level is on. */
  readonly flow: AssetFlow | SQL;
  readonly pending: readonly string[];
}

const HEADERS: Record<AssetDocumentKind, Header> = {
  service: {
    table: serviceRequests,
    id: serviceRequests.id,
    number: serviceRequests.number,
    date: serviceRequests.requestDate,
    status: serviceRequests.status,
    currentLevel: serviceRequests.currentLevel,
    version: serviceRequests.version,
    party: serviceRequests.sentTo,
    flow: 'service',
    pending: ['pending'],
  },
  discard: {
    table: discardRequests,
    id: discardRequests.id,
    number: discardRequests.number,
    date: discardRequests.requestDate,
    status: discardRequests.status,
    currentLevel: discardRequests.currentLevel,
    version: discardRequests.version,
    party: discardRequests.soldTo,
    flow: sql`case when ${discardRequests.status} = 'sale_pending' then 'discard_sale' else 'discard' end`,
    pending: ['pending', 'sale_pending'],
  },
  scrap_sale: {
    table: scrapSales,
    id: scrapSales.id,
    number: scrapSales.number,
    date: scrapSales.saleDate,
    status: scrapSales.status,
    currentLevel: scrapSales.currentLevel,
    version: scrapSales.version,
    party: scrapSales.buyer,
    flow: 'scrap_sale',
    pending: ['pending'],
  },
};

@Injectable()
export class DrizzleAssetRequestReadRepository extends AssetRequestReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private summaries(kind: AssetDocumentKind) {
    const header = HEADERS[kind];
    return this.context.db
      .select({
        id: header.id,
        number: header.number,
        date: header.date,
        status: header.status,
        currentLevel: header.currentLevel,
        currentLevelName: assetApprovalLevels.name,
        party: header.party,
        version: header.version,
      })
      .from(header.table)
      .leftJoin(
        assetApprovalLevels,
        and(
          typeof header.flow === 'string'
            ? eq(assetApprovalLevels.flow, header.flow)
            : sql`${assetApprovalLevels.flow} = ${header.flow}`,
          eq(assetApprovalLevels.levelOrder, header.currentLevel),
        ),
      )
      .$dynamic();
  }

  async list(
    kind: AssetDocumentKind,
    filter: PageRequest & { status?: string | undefined },
  ): Promise<Page<AssetDocumentSummary>> {
    const header = HEADERS[kind];
    const where: SQL | undefined = filter.status ? eq(header.status, filter.status) : undefined;
    const [rows, [total]] = await Promise.all([
      this.summaries(kind)
        .where(where)
        .orderBy(desc(header.date), desc(header.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(header.table).where(where),
    ]);
    return toPage(rows as AssetDocumentSummary[], total?.n ?? 0, filter);
  }

  async inbox(kind: AssetDocumentKind, roleIds: readonly string[]): Promise<AssetDocumentSummary[]> {
    const header = HEADERS[kind];
    const rows = await this.summaries(kind)
      .where(and(inArray(header.status, [...header.pending]), inArray(assetApprovalLevels.roleId, [...roleIds])))
      .orderBy(asc(header.date))
      .limit(500);
    return rows as AssetDocumentSummary[];
  }

  async get(kind: AssetDocumentKind, id: string): Promise<AssetDocumentView | null> {
    const header = HEADERS[kind];
    const [summary] = (await this.summaries(kind).where(eq(header.id, id))) as AssetDocumentSummary[];
    if (!summary) return null;
    const decisions = await decisionsOf(this.context, id);
    if (kind === 'scrap_sale') {
      const [row] = await this.context.db.select().from(scrapSales).where(eq(scrapSales.id, id));
      return {
        ...summary,
        kind,
        fields: {
          total: row!.total,
          buyerSupplierId: row!.buyerSupplierId,
          invoiceNo: row!.invoiceNo,
          voucherNumber: row!.voucherNumber,
        },
        lines: row!.lines,
        decisions,
      };
    }
    if (kind === 'service') {
      const [row] = await this.context.db
        .select({ note: serviceRequests.note, supplierId: serviceRequests.supplierId })
        .from(serviceRequests)
        .where(eq(serviceRequests.id, id));
      const lines = await this.context.db
        .select({
          assetId: serviceRequestLines.assetId,
          assetNo: fixedAssets.assetNo,
          serviceType: serviceRequestLines.serviceType,
          problem: serviceRequestLines.problem,
          cost: serviceRequestLines.cost,
          rejected: serviceRequestLines.rejected,
          returnedOn: serviceRequestLines.returnedOn,
          actualCost: serviceRequestLines.actualCost,
          receiptVoucherNumber: serviceRequestLines.receiptVoucherNumber,
        })
        .from(serviceRequestLines)
        .innerJoin(fixedAssets, eq(fixedAssets.id, serviceRequestLines.assetId))
        .where(eq(serviceRequestLines.requestId, id))
        .orderBy(asc(serviceRequestLines.position));
      return {
        ...summary,
        kind,
        fields: { note: row?.note ?? null, supplierId: row?.supplierId ?? null },
        lines,
        decisions,
      };
    }
    const [row] = await this.context.db
      .select({
        reason: discardRequests.reason,
        discardedOn: discardRequests.discardedOn,
        disposalVoucherNumber: discardRequests.disposalVoucherNumber,
        soldOn: discardRequests.soldOn,
        buyerSupplierId: discardRequests.buyerSupplierId,
        invoiceNo: discardRequests.invoiceNo,
        saleVoucherNumber: discardRequests.saleVoucherNumber,
      })
      .from(discardRequests)
      .where(eq(discardRequests.id, id));
    const lines = await this.context.db
      .select({
        assetId: discardRequestLines.assetId,
        assetNo: fixedAssets.assetNo,
        reason: discardRequestLines.reason,
        rejected: discardRequestLines.rejected,
        bookValue: discardRequestLines.bookValue,
        saleAmount: discardRequestLines.saleAmount,
      })
      .from(discardRequestLines)
      .innerJoin(fixedAssets, eq(fixedAssets.id, discardRequestLines.assetId))
      .where(eq(discardRequestLines.requestId, id))
      .orderBy(asc(discardRequestLines.position));
    return { ...summary, kind, fields: row ?? {}, lines, decisions };
  }
}
