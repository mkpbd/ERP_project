import { fileURLToPath } from 'node:url';
import { and, asc, eq, gte, inArray, lt, lte, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError } from '../../../../shared/domain/errors.js';
import { code39Svg } from '../../../../shared/infrastructure/reports/code39.js';
import {
  assetDepreciation,
  depreciationEntries,
  fixedAssets,
  gatePasses,
  itemGroups,
  items,
  itemSubGroups,
  itemVariants,
  mainStores,
  serviceRequestLines,
  serviceRequests,
  storeDepartments,
  subStores,
  suppliers,
} from '../persistence/supply-chain.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const cents = (value: number) => Math.round(value * 100) / 100;
const sumOf = <T>(rows: readonly T[], pick: (row: T) => number) => cents(rows.reduce((sum, row) => sum + pick(row), 0));

const todayIn = (timeZone: string, now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
}

const STATUS_LABELS = {
  in_stock: 'In use',
  out_for_service: 'Out for service',
  discarded: 'Written off',
  sold: 'Sold',
  returned: 'Returned to supplier',
} as const;
const GONE = ['discarded', 'sold', 'returned'] as const;

/** Where a piece is now. */
const assetPlace = sql<string | null>`coalesce(${mainStores.name}, ${subStores.name}, ${storeDepartments.name})`;

/** Depreciation charged to each piece up to `until` (opening balance included), or before `before`. */
async function accumulatedBy(
  context: DbContext,
  assetIds: readonly string[],
  bound: { until: string } | { before: string },
): Promise<Map<string, number>> {
  if (assetIds.length === 0) return new Map();
  const [profiles, charges] = await Promise.all([
    context.db
      .select({ assetId: assetDepreciation.assetId, opening: assetDepreciation.openingAccumulated })
      .from(assetDepreciation)
      .where(inArray(assetDepreciation.assetId, [...assetIds])),
    context.db
      .select({
        assetId: depreciationEntries.assetId,
        amount: sql<number>`sum(${depreciationEntries.amount})`.mapWith(Number),
      })
      .from(depreciationEntries)
      .where(
        and(
          inArray(depreciationEntries.assetId, [...assetIds]),
          'until' in bound
            ? lte(depreciationEntries.periodEnd, bound.until)
            : lt(depreciationEntries.periodEnd, bound.before),
        ),
      )
      .groupBy(depreciationEntries.assetId),
  ]);
  const totals = new Map(profiles.map((row) => [row.assetId, row.opening]));
  for (const row of charges) totals.set(row.assetId, cents((totals.get(row.assetId) ?? 0) + row.amount));
  return totals;
}

const assetColumns = {
  id: fixedAssets.id,
  assetNo: fixedAssets.assetNo,
  groupName: itemGroups.name,
  itemName: items.name,
  variantName: itemVariants.name,
  serialNo: fixedAssets.serialNo,
  place: assetPlace,
  status: fixedAssets.status,
  acquiredOn: fixedAssets.acquiredOn,
  sourceNumber: fixedAssets.sourceNumber,
  supplierName: suppliers.name,
  cost: fixedAssets.cost,
};

function assetQuery(context: DbContext) {
  return context.db
    .select(assetColumns)
    .from(fixedAssets)
    .innerJoin(itemVariants, eq(itemVariants.id, fixedAssets.variantId))
    .innerJoin(items, eq(items.id, itemVariants.itemId))
    .innerJoin(itemSubGroups, eq(itemSubGroups.id, items.subGroupId))
    .innerJoin(itemGroups, eq(itemGroups.id, itemSubGroups.groupId))
    .leftJoin(suppliers, eq(suppliers.id, fixedAssets.supplierId))
    .leftJoin(mainStores, eq(mainStores.id, fixedAssets.mainStoreId))
    .leftJoin(subStores, eq(subStores.id, fixedAssets.subStoreId))
    .leftJoin(storeDepartments, eq(storeDepartments.id, fixedAssets.departmentId))
    .$dynamic();
}

/**
 * Old Fixed Asset Register page and its print: every piece acquired by a date, where it is, its cost, the
 * depreciation charged by then and its book value; by item group.
 */
export function assetRegisterReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'scm.asset-register',
    title: 'Fixed asset register',
    group: 'Supply chain',
    description: 'Every fixed-asset piece with its place, cost, depreciation to a date and book value.',
    params: z.strictObject({
      asOf: day.optional(),
      groupId: z.uuid().optional(),
      departmentId: z.uuid().optional(),
      includeGone: z.boolean().default(false),
    }),
    async load(params, report) {
      const asOf = params.asOf ?? todayIn(report.timeZone, report.generatedAt);
      const rows = await assetQuery(context)
        .where(
          and(
            lte(fixedAssets.acquiredOn, asOf),
            params.groupId ? eq(itemGroups.id, params.groupId) : undefined,
            params.departmentId ? eq(fixedAssets.departmentId, params.departmentId) : undefined,
            params.includeGone ? undefined : notInArray(fixedAssets.status, [...GONE]),
          ),
        )
        .orderBy(asc(itemGroups.name), asc(fixedAssets.assetNo));
      const accumulated = await accumulatedBy(
        context,
        rows.map((row) => row.id),
        { until: asOf },
      );
      const assets = rows.map(({ id, ...row }) => {
        const charged = accumulated.get(id) ?? 0;
        return {
          ...row,
          statusLabel: STATUS_LABELS[row.status],
          accumulated: charged,
          bookValue: cents(row.cost - charged),
        };
      });
      const groups: { name: string; assets: typeof assets; cost: number; accumulated: number; bookValue: number }[] =
        [];
      for (const asset of assets) {
        const last = groups.at(-1);
        if (last?.name === asset.groupName) last.assets.push(asset);
        else groups.push({ name: asset.groupName, assets: [asset], cost: 0, accumulated: 0, bookValue: 0 });
      }
      for (const group of groups) {
        group.cost = sumOf(group.assets, (asset) => asset.cost);
        group.accumulated = sumOf(group.assets, (asset) => asset.accumulated);
        group.bookValue = sumOf(group.assets, (asset) => asset.bookValue);
      }
      return {
        asOf,
        groups,
        count: assets.length,
        cost: sumOf(groups, (group) => group.cost),
        accumulated: sumOf(groups, (group) => group.accumulated),
        bookValue: sumOf(groups, (group) => group.bookValue),
      };
    },
    describe: (params, data) =>
      `As of ${data.asOf} · ${data.count} pieces${params.includeGone ? ' · written off, sold and returned included' : ''}`,
    pdf: { engine: 'html', template: template('asset-register'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'assetNo', header: 'Asset no', width: 12 },
        { key: 'groupName', header: 'Group', width: 16 },
        { key: 'itemName', header: 'Item', width: 22 },
        { key: 'variantName', header: 'Variant', width: 18 },
        { key: 'serialNo', header: 'Serial no', width: 16 },
        { key: 'place', header: 'Store / department', width: 20 },
        { key: 'statusLabel', header: 'Status', width: 16 },
        { key: 'acquiredOn', header: 'Acquired', format: 'date' },
        { key: 'sourceNumber', header: 'Source', width: 16 },
        { key: 'supplierName', header: 'Supplier', width: 20 },
        { key: 'cost', header: 'Cost', format: 'money' },
        { key: 'accumulated', header: 'Accumulated depreciation', format: 'money' },
        { key: 'bookValue', header: 'Book value', format: 'money' },
      ],
      rows: data.groups.flatMap((group) => group.assets.map((asset) => ({ ...asset }))),
    }),
  });
}

/**
 * Old Asset Depreciation Reports (Summary, Schedule, Monthly tabs): per piece, depreciation brought forward,
 * charged in the period and carried forward, with the book value; the period's charge by month and by the
 * department the piece was in when charged.
 */
export function depreciationScheduleReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'scm.depreciation-schedule',
    title: 'Depreciation schedule',
    group: 'Supply chain',
    description:
      'Depreciation brought forward, charged in a period and carried forward per piece, by month and department.',
    params: z.strictObject({ from: day, to: day, groupId: z.uuid().optional() }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const rows = await assetQuery(context)
        .innerJoin(assetDepreciation, eq(assetDepreciation.assetId, fixedAssets.id))
        .where(
          and(lte(fixedAssets.acquiredOn, params.to), params.groupId ? eq(itemGroups.id, params.groupId) : undefined),
        )
        .orderBy(asc(itemGroups.name), asc(fixedAssets.assetNo));
      const ids = rows.map((row) => row.id);
      const [brought, carried, byMonth, byDepartment] = await Promise.all([
        accumulatedBy(context, ids, { before: params.from }),
        accumulatedBy(context, ids, { until: params.to }),
        ids.length === 0
          ? []
          : context.db
              .select({
                month: sql<string>`to_char(${depreciationEntries.periodEnd}, 'YYYY-MM')`,
                amount: sql<number>`sum(${depreciationEntries.amount})`.mapWith(Number),
              })
              .from(depreciationEntries)
              .where(
                and(
                  inArray(depreciationEntries.assetId, ids),
                  gte(depreciationEntries.periodEnd, params.from),
                  lte(depreciationEntries.periodEnd, params.to),
                ),
              )
              .groupBy(sql`1`)
              .orderBy(sql`1`),
        ids.length === 0
          ? []
          : context.db
              .select({
                department: sql<string>`coalesce(${storeDepartments.name}, 'In store')`,
                amount: sql<number>`sum(${depreciationEntries.amount})`.mapWith(Number),
              })
              .from(depreciationEntries)
              .leftJoin(storeDepartments, eq(storeDepartments.id, depreciationEntries.departmentId))
              .where(
                and(
                  inArray(depreciationEntries.assetId, ids),
                  gte(depreciationEntries.periodEnd, params.from),
                  lte(depreciationEntries.periodEnd, params.to),
                ),
              )
              .groupBy(sql`1`)
              .orderBy(sql`1`),
      ]);
      const assets = rows
        .map(({ id, ...row }) => {
          const opening = brought.get(id) ?? 0;
          const closing = carried.get(id) ?? 0;
          return {
            ...row,
            opening,
            charge: cents(closing - opening),
            closing,
            bookValue: cents(row.cost - closing),
          };
        })
        // Pieces gone before the period, with nothing charged in it, are not on the schedule.
        .filter((asset) => asset.charge !== 0 || !(GONE as readonly string[]).includes(asset.status));
      return {
        assets,
        months: byMonth.map((row) => ({ ...row, amount: cents(row.amount) })),
        departments: byDepartment.map((row) => ({ ...row, amount: cents(row.amount) })),
        cost: sumOf(assets, (asset) => asset.cost),
        opening: sumOf(assets, (asset) => asset.opening),
        charge: sumOf(assets, (asset) => asset.charge),
        closing: sumOf(assets, (asset) => asset.closing),
        bookValue: sumOf(assets, (asset) => asset.bookValue),
      };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('depreciation-schedule'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'assetNo', header: 'Asset no', width: 12 },
        { key: 'groupName', header: 'Group', width: 16 },
        { key: 'itemName', header: 'Item', width: 22 },
        { key: 'variantName', header: 'Variant', width: 18 },
        { key: 'place', header: 'Store / department', width: 20 },
        { key: 'cost', header: 'Cost', format: 'money' },
        { key: 'opening', header: 'Brought forward', format: 'money' },
        { key: 'charge', header: 'Charge', format: 'money' },
        { key: 'closing', header: 'Carried forward', format: 'money' },
        { key: 'bookValue', header: 'Book value', format: 'money' },
      ],
      rows: data.assets.map((asset) => ({ ...asset })),
    }),
  });
}

const SERVICE_STATUSES = ['pending', 'approved', 'closed', 'rejected'] as const;

/** Old Warranty & Maintenance dashboard and maintenance list: every piece sent out for service in a period. */
export function maintenanceRegisterReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'scm.maintenance-register',
    title: 'Maintenance register',
    group: 'Supply chain',
    description:
      'Pieces asked to go out for warranty repair or maintenance in a period, with the expected and actual cost.',
    params: z.strictObject({
      from: day,
      to: day,
      status: z.enum(SERVICE_STATUSES).optional(),
      serviceType: z.enum(['warranty', 'maintenance']).optional(),
    }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const rows = await context.db
        .select({
          number: serviceRequests.number,
          requestDate: serviceRequests.requestDate,
          status: serviceRequests.status,
          sentTo: serviceRequests.sentTo,
          gatePassNumber: gatePasses.number,
          assetNo: fixedAssets.assetNo,
          itemName: items.name,
          variantName: itemVariants.name,
          serviceType: serviceRequestLines.serviceType,
          problem: serviceRequestLines.problem,
          rejected: serviceRequestLines.rejected,
          cost: serviceRequestLines.cost,
          returnedOn: serviceRequestLines.returnedOn,
          actualCost: serviceRequestLines.actualCost,
          voucherNumber: serviceRequestLines.receiptVoucherNumber,
        })
        .from(serviceRequestLines)
        .innerJoin(serviceRequests, eq(serviceRequests.id, serviceRequestLines.requestId))
        .innerJoin(fixedAssets, eq(fixedAssets.id, serviceRequestLines.assetId))
        .innerJoin(itemVariants, eq(itemVariants.id, fixedAssets.variantId))
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .leftJoin(gatePasses, eq(gatePasses.id, serviceRequests.gatePassId))
        .where(
          and(
            gte(serviceRequests.requestDate, params.from),
            lte(serviceRequests.requestDate, params.to),
            params.status ? eq(serviceRequests.status, params.status) : undefined,
            params.serviceType ? eq(serviceRequestLines.serviceType, params.serviceType) : undefined,
          ),
        )
        .orderBy(asc(serviceRequests.requestDate), asc(serviceRequests.number), asc(serviceRequestLines.position));
      const lines = rows.map((row) => ({
        ...row,
        state: row.rejected
          ? 'Dropped'
          : row.returnedOn
            ? 'Back'
            : row.status === 'approved'
              ? 'Out'
              : row.status === 'pending'
                ? 'Waiting approval'
                : 'Rejected',
      }));
      const kept = lines.filter((line) => !line.rejected && line.status !== 'rejected');
      return {
        lines,
        out: lines.filter((line) => line.state === 'Out').length,
        expected: sumOf(kept, (line) => line.cost),
        actual: sumOf(kept, (line) => line.actualCost ?? 0),
      };
    },
    describe: (params) =>
      `${params.from} to ${params.to}${params.serviceType ? ` · ${params.serviceType}` : ''}${params.status ? ` · ${params.status}` : ''}`,
    pdf: { engine: 'html', template: template('maintenance-register'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'number', header: 'Request', width: 16 },
        { key: 'requestDate', header: 'Date', format: 'date' },
        { key: 'sentTo', header: 'Sent to', width: 22 },
        { key: 'gatePassNumber', header: 'Gate pass', width: 16 },
        { key: 'assetNo', header: 'Asset no', width: 12 },
        { key: 'itemName', header: 'Item', width: 22 },
        { key: 'serviceType', header: 'Type', width: 12 },
        { key: 'problem', header: 'Problem', width: 26 },
        { key: 'state', header: 'State', width: 16 },
        { key: 'returnedOn', header: 'Back on', format: 'date' },
        { key: 'cost', header: 'Expected cost', format: 'money' },
        { key: 'actualCost', header: 'Actual cost', format: 'money' },
        { key: 'voucherNumber', header: 'Voucher', width: 18 },
      ],
      rows: data.lines.map(({ rejected: _rejected, status: _status, ...line }) => ({ ...line })),
    }),
  });
}

const labelParams = z
  .strictObject({
    assetIds: z.array(z.uuid()).min(1).max(500).optional(),
    /** Every piece a receive or opening stock brought in. */
    sourceDocumentId: z.uuid().optional(),
  })
  .refine((params) => (params.assetIds === undefined) !== (params.sourceDocumentId === undefined), {
    message: 'Give the pieces or the document they came in on',
  });

async function labels(context: DbContext, params: z.infer<typeof labelParams>) {
  const rows = await context.db
    .select({ assetNo: fixedAssets.assetNo, itemName: items.name, variantName: itemVariants.name })
    .from(fixedAssets)
    .innerJoin(itemVariants, eq(itemVariants.id, fixedAssets.variantId))
    .innerJoin(items, eq(items.id, itemVariants.itemId))
    .where(
      params.assetIds
        ? inArray(fixedAssets.id, params.assetIds)
        : eq(fixedAssets.sourceDocumentId, params.sourceDocumentId!),
    )
    .orderBy(asc(fixedAssets.assetNo))
    .limit(500);
  return rows.map((row) => ({ ...row, barcode: code39Svg(row.assetNo) }));
}

/** Old PrintAssetStickerDocument: barcode stickers, three to a row on A4. */
export function assetStickersReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'scm.asset-stickers',
    title: 'Asset stickers',
    group: 'Supply chain',
    description: 'Code 39 barcode stickers for fixed-asset pieces, three to a row on A4.',
    params: labelParams,
    async load(params) {
      return { labels: await labels(context, params) };
    },
    describe: (_params, data) => `${data.labels.length} stickers`,
    pdf: { engine: 'html', template: template('asset-stickers'), bare: true },
  });
}

/** Old PrintAssetLabelDocument: one barcode label per page for a label printer (60 × 37 mm). */
export function assetLabelsReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'scm.asset-labels',
    title: 'Asset labels',
    group: 'Supply chain',
    description: 'Code 39 barcode labels for fixed-asset pieces, one per 60 × 37 mm label.',
    params: labelParams,
    async load(params) {
      return { labels: await labels(context, params) };
    },
    describe: (_params, data) => `${data.labels.length} labels`,
    pdf: { engine: 'html', template: template('asset-labels'), bare: true, paper: { width: '60mm', height: '37mm' } },
  });
}
