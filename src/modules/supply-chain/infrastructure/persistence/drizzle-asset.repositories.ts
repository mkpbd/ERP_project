import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page, type PageRequest } from '../../../../shared/application/pagination.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  AssetReadRepository,
  type AssetFilter,
  type AssetSummary,
  type AssetView,
  type RunSummary,
} from '../../application/asset.handlers.js';
import {
  AssetRegister,
  DepreciationRepository,
  type DepreciableAsset,
  type DepreciationRecord,
  type NewAsset,
  type RunEntry,
  type RunRecord,
  type StockPlace,
} from '../../domain/repositories.js';
import {
  assetDepreciation,
  depreciationEntries,
  depreciationRuns,
  fixedAssets,
  items,
  itemVariants,
  mainStores,
  stockLots,
  storeDepartments,
  subStores,
  suppliers,
} from './supply-chain.schema.js';

const placeColumns = (place: StockPlace) => ({
  mainStoreId: 'mainStoreId' in place ? place.mainStoreId : null,
  subStoreId: 'subStoreId' in place ? place.subStoreId : null,
  departmentId: 'departmentId' in place ? place.departmentId : null,
});

const atPlace = (place: StockPlace): SQL =>
  'mainStoreId' in place
    ? eq(fixedAssets.mainStoreId, place.mainStoreId)
    : 'subStoreId' in place
      ? eq(fixedAssets.subStoreId, place.subStoreId)
      : eq(fixedAssets.departmentId, place.departmentId);

@Injectable()
export class DrizzleAssetRegister extends AssetRegister {
  constructor(private readonly context: DbContext) {
    super();
  }

  async add(assets: readonly NewAsset[]): Promise<void> {
    for (let start = 0; start < assets.length; start += 500) {
      await this.context.db.insert(fixedAssets).values(
        assets.slice(start, start + 500).map(({ place, ...asset }) => ({
          ...asset,
          ...placeColumns(place),
          status: 'in_stock' as const,
        })),
      );
    }
  }

  /** The `count` oldest in-stock pieces of the variant and lot at the place, locked. */
  private pieces(variantId: string, lotId: string, count: number, from: StockPlace) {
    return this.context.db
      .select({ id: fixedAssets.id })
      .from(fixedAssets)
      .where(
        and(
          eq(fixedAssets.variantId, variantId),
          eq(fixedAssets.lotId, lotId),
          eq(fixedAssets.status, 'in_stock'),
          atPlace(from),
        ),
      )
      .orderBy(asc(fixedAssets.assetNo))
      .limit(count)
      .for('update');
  }

  async relocate(variantId: string, lotId: string, count: number, from: StockPlace, to: StockPlace): Promise<number> {
    if (count <= 0) return 0;
    const ids = (await this.pieces(variantId, lotId, count, from)).map((row) => row.id);
    if (ids.length === 0) return 0;
    await this.context.db
      .update(fixedAssets)
      .set({ ...placeColumns(to), updatedAt: new Date() })
      .where(inArray(fixedAssets.id, ids));
    return ids.length;
  }

  async release(
    variantId: string,
    lotId: string,
    count: number,
    from: StockPlace,
    status: 'returned',
  ): Promise<number> {
    if (count <= 0) return 0;
    const ids = (await this.pieces(variantId, lotId, count, from)).map((row) => row.id);
    if (ids.length === 0) return 0;
    await this.context.db
      .update(fixedAssets)
      .set({ status, mainStoreId: null, subStoreId: null, departmentId: null, updatedAt: new Date() })
      .where(inArray(fixedAssets.id, ids));
    return ids.length;
  }
}

const profileColumns = {
  assetId: assetDepreciation.assetId,
  frequency: assetDepreciation.frequency,
  lifeMonths: assetDepreciation.lifeMonths,
  cost: assetDepreciation.cost,
  residual: assetDepreciation.residual,
  startDate: assetDepreciation.startDate,
  openingAccumulated: assetDepreciation.openingAccumulated,
  periodsDone: assetDepreciation.periodsDone,
  accumulated: assetDepreciation.accumulated,
  lastPeriodEnd: assetDepreciation.lastPeriodEnd,
  status: assetDepreciation.status,
};

@Injectable()
export class DrizzleDepreciationRepository extends DepreciationRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async assets(ids: readonly string[]): Promise<DepreciableAsset[]> {
    const rows = await this.context.db
      .select({
        id: fixedAssets.id,
        assetNo: fixedAssets.assetNo,
        cost: fixedAssets.cost,
        acquiredOn: fixedAssets.acquiredOn,
        status: fixedAssets.status,
        departmentId: fixedAssets.departmentId,
        charged: sql<boolean>`exists (select 1 from ${depreciationEntries} where ${depreciationEntries.assetId} = ${fixedAssets.id})`,
      })
      .from(fixedAssets)
      .where(inArray(fixedAssets.id, [...ids]))
      .for('update');
    if (rows.length !== new Set(ids).size) throw new NotFoundError('fixed_asset');
    return rows;
  }

  async save(records: readonly DepreciationRecord[], by: string): Promise<void> {
    const now = new Date();
    for (const record of records) {
      await this.context.db
        .insert(assetDepreciation)
        .values({ ...record, configuredBy: by, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: assetDepreciation.assetId, set: { ...record, updatedAt: now } });
    }
  }

  async due(asOf: string): Promise<(DepreciationRecord & { departmentId: string | null })[]> {
    return this.context.db
      .select({ ...profileColumns, departmentId: fixedAssets.departmentId })
      .from(assetDepreciation)
      .innerJoin(fixedAssets, eq(fixedAssets.id, assetDepreciation.assetId))
      .where(
        and(
          eq(assetDepreciation.status, 'active'),
          lte(assetDepreciation.startDate, asOf),
          inArray(fixedAssets.status, ['in_stock', 'out_for_service']),
        ),
      )
      .orderBy(asc(fixedAssets.assetNo))
      .for('update', { of: assetDepreciation });
  }

  async insertRun(run: RunRecord & { postedBy: string }, entries: readonly RunEntry[]): Promise<void> {
    await this.context.db.insert(depreciationRuns).values(run);
    for (let start = 0; start < entries.length; start += 1000) {
      await this.context.db
        .insert(depreciationEntries)
        .values(entries.slice(start, start + 1000).map((entry) => ({ ...entry, runId: run.id })));
    }
  }

  async latestPosted(): Promise<RunRecord | null> {
    const [row] = await this.context.db
      .select({
        id: depreciationRuns.id,
        number: depreciationRuns.number,
        asOf: depreciationRuns.asOf,
        status: depreciationRuns.status,
        assetCount: depreciationRuns.assetCount,
        total: depreciationRuns.total,
        voucherId: depreciationRuns.voucherId,
        voucherNumber: depreciationRuns.voucherNumber,
      })
      .from(depreciationRuns)
      .where(and(eq(depreciationRuns.status, 'posted'), eq(depreciationRuns.kind, 'periodic')))
      .orderBy(desc(depreciationRuns.asOf), desc(depreciationRuns.createdAt))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async entries(runId: string): Promise<RunEntry[]> {
    return this.context.db
      .select({
        assetId: depreciationEntries.assetId,
        periodIndex: depreciationEntries.periodIndex,
        periodEnd: depreciationEntries.periodEnd,
        amount: depreciationEntries.amount,
        departmentId: depreciationEntries.departmentId,
      })
      .from(depreciationEntries)
      .where(eq(depreciationEntries.runId, runId));
  }

  async profiles(assetIds: readonly string[]): Promise<DepreciationRecord[]> {
    if (assetIds.length === 0) return [];
    return this.context.db
      .select(profileColumns)
      .from(assetDepreciation)
      .where(inArray(assetDepreciation.assetId, [...new Set(assetIds)]))
      .for('update');
  }

  async markReversed(
    runId: string,
    reversal: { by: string; at: Date; reason: string; voucher: { id: string; number: string } | null },
  ): Promise<void> {
    await this.context.db.delete(depreciationEntries).where(eq(depreciationEntries.runId, runId));
    await this.context.db
      .update(depreciationRuns)
      .set({
        status: 'reversed',
        reversedBy: reversal.by,
        reversedAt: reversal.at,
        reverseReason: reversal.reason,
        reversalVoucherId: reversal.voucher?.id ?? null,
        reversalVoucherNumber: reversal.voucher?.number ?? null,
        updatedAt: reversal.at,
      })
      .where(eq(depreciationRuns.id, runId));
  }
}

const summaryColumns = {
  id: fixedAssets.id,
  assetNo: fixedAssets.assetNo,
  variantId: fixedAssets.variantId,
  itemName: items.name,
  variantName: itemVariants.name,
  status: fixedAssets.status,
  placeName: sql<string | null>`coalesce(${mainStores.name}, ${subStores.name}, ${storeDepartments.name})`,
  mainStoreId: fixedAssets.mainStoreId,
  subStoreId: fixedAssets.subStoreId,
  departmentId: fixedAssets.departmentId,
  cost: fixedAssets.cost,
  acquiredOn: fixedAssets.acquiredOn,
  sourceNumber: fixedAssets.sourceNumber,
  serialNo: fixedAssets.serialNo,
  accumulated: assetDepreciation.accumulated,
  depreciationStatus: assetDepreciation.status,
};

@Injectable()
export class DrizzleAssetReadRepository extends AssetReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private summaries() {
    return this.context.db
      .select(summaryColumns)
      .from(fixedAssets)
      .innerJoin(itemVariants, eq(itemVariants.id, fixedAssets.variantId))
      .innerJoin(items, eq(items.id, itemVariants.itemId))
      .leftJoin(mainStores, eq(mainStores.id, fixedAssets.mainStoreId))
      .leftJoin(subStores, eq(subStores.id, fixedAssets.subStoreId))
      .leftJoin(storeDepartments, eq(storeDepartments.id, fixedAssets.departmentId))
      .leftJoin(assetDepreciation, eq(assetDepreciation.assetId, fixedAssets.id));
  }

  private static view(row: Omit<AssetSummary, 'bookValue'>): AssetSummary {
    return { ...row, bookValue: Math.round((row.cost - (row.accumulated ?? 0)) * 100) / 100 };
  }

  async list(filter: AssetFilter): Promise<Page<AssetSummary>> {
    const where = and(
      filter.status ? eq(fixedAssets.status, filter.status as 'in_stock') : undefined,
      filter.variantId ? eq(fixedAssets.variantId, filter.variantId) : undefined,
      filter.mainStoreId ? eq(fixedAssets.mainStoreId, filter.mainStoreId) : undefined,
      filter.subStoreId ? eq(fixedAssets.subStoreId, filter.subStoreId) : undefined,
      filter.departmentId ? eq(fixedAssets.departmentId, filter.departmentId) : undefined,
      filter.q ? ilike(fixedAssets.assetNo, `%${escapeLike(filter.q)}%`) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.summaries().where(where).orderBy(asc(fixedAssets.assetNo)).limit(filter.pageSize).offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(fixedAssets).where(where),
    ]);
    return toPage(
      rows.map((row) => DrizzleAssetReadRepository.view(row)),
      total?.n ?? 0,
      filter,
    );
  }

  async get(id: string): Promise<AssetView | null> {
    const [row] = await this.summaries().where(eq(fixedAssets.id, id));
    if (!row) return null;
    const [[details], [depreciation], charges] = await Promise.all([
      this.context.db
        .select({
          batchNo: stockLots.batchNo,
          expiryDate: stockLots.expiryDate,
          supplierName: suppliers.name,
          note: fixedAssets.note,
        })
        .from(fixedAssets)
        .innerJoin(stockLots, eq(stockLots.id, fixedAssets.lotId))
        .leftJoin(suppliers, eq(suppliers.id, fixedAssets.supplierId))
        .where(eq(fixedAssets.id, id)),
      this.context.db.select(profileColumns).from(assetDepreciation).where(eq(assetDepreciation.assetId, id)),
      this.context.db
        .select({
          runNumber: depreciationRuns.number,
          periodEnd: depreciationEntries.periodEnd,
          amount: depreciationEntries.amount,
        })
        .from(depreciationEntries)
        .innerJoin(depreciationRuns, eq(depreciationRuns.id, depreciationEntries.runId))
        .where(eq(depreciationEntries.assetId, id))
        .orderBy(asc(depreciationEntries.periodIndex)),
    ]);
    return { ...DrizzleAssetReadRepository.view(row), ...details!, depreciation: depreciation ?? null, charges };
  }

  async assetNumbers(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({ id: fixedAssets.id, assetNo: fixedAssets.assetNo })
      .from(fixedAssets)
      .where(inArray(fixedAssets.id, [...ids]));
    return new Map(rows.map((row) => [row.id, row.assetNo]));
  }

  private runColumns() {
    return {
      id: depreciationRuns.id,
      number: depreciationRuns.number,
      asOf: depreciationRuns.asOf,
      status: depreciationRuns.status,
      assetCount: depreciationRuns.assetCount,
      total: depreciationRuns.total,
      voucherNumber: depreciationRuns.voucherNumber,
      reversalVoucherNumber: depreciationRuns.reversalVoucherNumber,
    };
  }

  async runs(request: PageRequest): Promise<Page<RunSummary>> {
    const [rows, [total]] = await Promise.all([
      this.context.db
        .select(this.runColumns())
        .from(depreciationRuns)
        .orderBy(desc(depreciationRuns.asOf), desc(depreciationRuns.createdAt))
        .limit(request.pageSize)
        .offset(offsetOf(request)),
      this.context.db.select({ n: count() }).from(depreciationRuns),
    ]);
    return toPage(rows, total?.n ?? 0, request);
  }

  async run(id: string) {
    const [row] = await this.context.db
      .select(this.runColumns())
      .from(depreciationRuns)
      .where(eq(depreciationRuns.id, id));
    if (!row) return null;
    const entries = await this.context.db
      .select({
        assetId: depreciationEntries.assetId,
        assetNo: fixedAssets.assetNo,
        periodIndex: depreciationEntries.periodIndex,
        periodEnd: depreciationEntries.periodEnd,
        amount: depreciationEntries.amount,
        departmentId: depreciationEntries.departmentId,
      })
      .from(depreciationEntries)
      .innerJoin(fixedAssets, eq(fixedAssets.id, depreciationEntries.assetId))
      .where(eq(depreciationEntries.runId, id))
      .orderBy(asc(fixedAssets.assetNo), asc(depreciationEntries.periodIndex));
    return { ...row, entries };
  }

  async describe(id: string, changes: { serialNo?: string | null; note?: string | null }): Promise<boolean> {
    const rows = await this.context.db
      .update(fixedAssets)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(fixedAssets.id, id))
      .returning({ id: fixedAssets.id });
    return rows.length > 0;
  }
}
