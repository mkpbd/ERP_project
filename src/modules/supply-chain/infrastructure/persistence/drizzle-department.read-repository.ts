import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, lt, lte, sql, type SQL } from 'drizzle-orm';
import { alias, type PgColumn, type PgTable } from 'drizzle-orm/pg-core';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  DepartmentReadRepository,
  type DepartmentDocumentKind,
  type DocumentLineView,
  type DocumentSummary,
  type DocumentView,
} from '../../application/department.messages.js';
import type { MovedPart, StoreFilter } from '../../application/store.messages.js';
import {
  departmentAdjustmentLines,
  departmentAdjustments,
  departmentConsumptionLines,
  departmentConsumptions,
  departmentReturnLines,
  departmentReturns,
  gatePasses,
  items,
  itemVariants,
  mainStores,
  stockLots,
  stockMovements,
  storeDepartments,
  subStores,
  supplierReturnLines,
  supplierReturns,
  suppliers,
} from './supply-chain.schema.js';

type Filter = StoreFilter & { supplierId?: string | undefined };

interface Header {
  readonly table: PgTable;
  readonly id: PgColumn;
  readonly number: PgColumn;
  readonly date: PgColumn;
  readonly status: PgColumn;
  readonly version: SQL | PgColumn;
  readonly party: SQL | PgColumn;
  readonly store: SQL | PgColumn;
  readonly note: SQL | PgColumn;
  readonly filters: (filter: Filter) => (SQL | undefined)[];
}

const replacement = alias(itemVariants, 'replacement');

const HEADERS: Record<DepartmentDocumentKind, Header> = {
  consumption: {
    table: departmentConsumptions,
    id: departmentConsumptions.id,
    number: departmentConsumptions.number,
    date: departmentConsumptions.consumedOn,
    status: departmentConsumptions.status,
    version: departmentConsumptions.version,
    party: storeDepartments.name,
    store: sql<null>`null`,
    note: sql<string | null>`coalesce(${departmentConsumptions.cancelReason}, ${departmentConsumptions.note})`,
    filters: (filter) => [
      filter.departmentId ? eq(departmentConsumptions.departmentId, filter.departmentId) : undefined,
    ],
  },
  return: {
    table: departmentReturns,
    id: departmentReturns.id,
    number: departmentReturns.number,
    date: departmentReturns.returnDate,
    status: departmentReturns.status,
    version: departmentReturns.version,
    party: storeDepartments.name,
    store: subStores.name,
    note: departmentReturns.reason,
    filters: (filter) => [
      filter.departmentId ? eq(departmentReturns.departmentId, filter.departmentId) : undefined,
      filter.subStoreId ? eq(departmentReturns.subStoreId, filter.subStoreId) : undefined,
    ],
  },
  adjustment: {
    table: departmentAdjustments,
    id: departmentAdjustments.id,
    number: departmentAdjustments.number,
    date: departmentAdjustments.countedOn,
    status: departmentAdjustments.status,
    version: departmentAdjustments.version,
    party: storeDepartments.name,
    store: sql<null>`null`,
    note: departmentAdjustments.reason,
    filters: (filter) => [
      filter.departmentId ? eq(departmentAdjustments.departmentId, filter.departmentId) : undefined,
    ],
  },
  supplier_return: {
    table: supplierReturns,
    id: supplierReturns.id,
    number: supplierReturns.number,
    date: supplierReturns.returnDate,
    status: supplierReturns.status,
    version: supplierReturns.version,
    party: suppliers.name,
    store: mainStores.name,
    note: supplierReturns.reason,
    filters: (filter) => [
      filter.supplierId ? eq(supplierReturns.supplierId, filter.supplierId) : undefined,
      filter.mainStoreId ? eq(supplierReturns.mainStoreId, filter.mainStoreId) : undefined,
    ],
  },
  gate_pass: {
    table: gatePasses,
    id: gatePasses.id,
    number: gatePasses.number,
    date: gatePasses.passDate,
    status: gatePasses.kind,
    version: sql<number>`1`,
    party: gatePasses.partyName,
    store: gatePasses.reference,
    note: gatePasses.note,
    filters: () => [],
  },
};

const itemColumns = {
  variantId: itemVariants.id,
  variantName: itemVariants.name,
  code: itemVariants.code,
  itemName: items.name,
  unit: items.unit,
};

@Injectable()
export class DrizzleDepartmentReadRepository extends DepartmentReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private summaries(kind: DepartmentDocumentKind) {
    const header = HEADERS[kind];
    const query = this.context.db
      .select({
        id: header.id,
        number: header.number,
        date: header.date,
        status: header.status,
        partyName: header.party,
        storeName: header.store,
        version: header.version,
        note: header.note,
      })
      .from(header.table)
      .$dynamic();
    switch (kind) {
      case 'consumption':
        return query.innerJoin(storeDepartments, eq(storeDepartments.id, departmentConsumptions.departmentId));
      case 'return':
        return query
          .innerJoin(storeDepartments, eq(storeDepartments.id, departmentReturns.departmentId))
          .innerJoin(subStores, eq(subStores.id, departmentReturns.subStoreId));
      case 'adjustment':
        return query.innerJoin(storeDepartments, eq(storeDepartments.id, departmentAdjustments.departmentId));
      case 'supplier_return':
        return query
          .innerJoin(suppliers, eq(suppliers.id, supplierReturns.supplierId))
          .innerJoin(mainStores, eq(mainStores.id, supplierReturns.mainStoreId));
      case 'gate_pass':
        return query;
    }
  }

  async list(kind: DepartmentDocumentKind, filter: Filter): Promise<Page<DocumentSummary>> {
    const header = HEADERS[kind];
    const where = and(
      filter.status ? eq(header.status, filter.status) : undefined,
      filter.from ? gte(header.date, filter.from) : undefined,
      filter.to ? lte(header.date, filter.to) : undefined,
      filter.q ? ilike(header.number, `%${escapeLike(filter.q)}%`) : undefined,
      ...header.filters(filter),
    );
    const [rows, [total]] = await Promise.all([
      this.summaries(kind)
        .where(where)
        .orderBy(desc(header.date), desc(header.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(header.table).where(where),
    ]);
    return toPage(
      (rows as (DocumentSummary & { note: unknown })[]).map(({ note: _note, ...row }) => row),
      total?.n ?? 0,
      filter,
    );
  }

  async get(kind: DepartmentDocumentKind, id: string): Promise<DocumentView | null> {
    const header = HEADERS[kind];
    const [row] = (await this.summaries(kind).where(eq(header.id, id))) as (DocumentSummary & {
      note: string | null;
    })[];
    if (!row) return null;
    const [lines, moved, fields] = await Promise.all([this.lines(kind, id), this.parts(id), this.fields(kind, id)]);
    return { ...row, kind, fields, lines, ...moved };
  }

  private async lines(kind: DepartmentDocumentKind, id: string): Promise<DocumentLineView[]> {
    const lot = { lotId: stockLots.id, batchNo: stockLots.batchNo, expiryDate: stockLots.expiryDate };
    switch (kind) {
      case 'consumption':
      case 'return': {
        const table = kind === 'consumption' ? departmentConsumptionLines : departmentReturnLines;
        const owner =
          kind === 'consumption' ? departmentConsumptionLines.consumptionId : departmentReturnLines.returnId;
        return this.context.db
          .select({ ...itemColumns, qty: table.qty, ...lot })
          .from(table)
          .innerJoin(itemVariants, eq(itemVariants.id, table.variantId))
          .innerJoin(items, eq(items.id, itemVariants.itemId))
          .leftJoin(stockLots, eq(stockLots.id, table.lotId))
          .where(eq(owner, id))
          .orderBy(asc(table.position));
      }
      case 'adjustment':
        return this.context.db
          .select({
            ...itemColumns,
            qty: departmentAdjustmentLines.physicalQty,
            ...lot,
            systemQty: departmentAdjustmentLines.systemQty,
            physicalQty: departmentAdjustmentLines.physicalQty,
            adjustQty: departmentAdjustmentLines.adjustQty,
          })
          .from(departmentAdjustmentLines)
          .innerJoin(itemVariants, eq(itemVariants.id, departmentAdjustmentLines.variantId))
          .innerJoin(items, eq(items.id, itemVariants.itemId))
          .innerJoin(stockLots, eq(stockLots.id, departmentAdjustmentLines.lotId))
          .where(eq(departmentAdjustmentLines.adjustmentId, id))
          .orderBy(asc(departmentAdjustmentLines.position));
      case 'supplier_return':
        return this.context.db
          .select({
            ...itemColumns,
            qty: supplierReturnLines.qty,
            ...lot,
            unitCost: supplierReturnLines.unitCost,
            receivedQty: supplierReturnLines.receivedQty,
            replacementName: replacement.name,
          })
          .from(supplierReturnLines)
          .innerJoin(itemVariants, eq(itemVariants.id, supplierReturnLines.variantId))
          .innerJoin(items, eq(items.id, itemVariants.itemId))
          .leftJoin(stockLots, eq(stockLots.id, supplierReturnLines.lotId))
          .leftJoin(replacement, eq(replacement.id, supplierReturnLines.replacementVariantId))
          .where(eq(supplierReturnLines.returnId, id))
          .orderBy(asc(supplierReturnLines.position));
      case 'gate_pass':
        return [];
    }
  }

  private async fields(kind: DepartmentDocumentKind, id: string): Promise<Record<string, string | number | null>> {
    if (kind === 'supplier_return') {
      const [row] = await this.context.db
        .select({
          sentVoucherNumber: supplierReturns.sentVoucherNumber,
          settledOn: supplierReturns.settledOn,
          settledVoucherNumber: supplierReturns.settledVoucherNumber,
          gatePassNumber: gatePasses.number,
        })
        .from(supplierReturns)
        .leftJoin(gatePasses, eq(gatePasses.id, supplierReturns.gatePassId))
        .where(eq(supplierReturns.id, id));
      return row ?? {};
    }
    if (kind === 'return') {
      const [row] = await this.context.db
        .select({ receivedOn: departmentReturns.receivedOn })
        .from(departmentReturns)
        .where(eq(departmentReturns.id, id));
      return row ?? {};
    }
    if (kind === 'adjustment') {
      const [row] = await this.context.db
        .select({ decisionRemarks: departmentAdjustments.decisionRemarks })
        .from(departmentAdjustments)
        .where(eq(departmentAdjustments.id, id));
      return row ?? {};
    }
    return {};
  }

  /** What the document took out of a place, by lot and cost. */
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
}
