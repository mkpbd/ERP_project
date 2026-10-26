import { fileURLToPath } from 'node:url';
import { and, asc, eq, gte, inArray, isNotNull, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { placeOf, placeRecord } from '../../domain/places.js';
import type { StockPlace } from '../../domain/repositories.js';
import { atPlace } from '../persistence/drizzle-stock.repositories.js';
import {
  gatePasses,
  itemGroups,
  items,
  itemSubGroups,
  itemVariants,
  mainStores,
  STOCK_MOVEMENT_KINDS,
  stockLots,
  stockMovements,
  storeDepartments,
  subStores,
} from '../persistence/supply-chain.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const place = {
  mainStoreId: z.uuid().optional(),
  subStoreId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
};
const qty3 = (value: number) => Math.round(value * 1000) / 1000;
const cents = (value: number) => Math.round(value * 100) / 100;

type MovementKind = (typeof STOCK_MOVEMENT_KINDS)[number];

const KIND_LABELS: Record<MovementKind, string> = {
  opening: 'Opening stock',
  receive: 'Receive',
  issue: 'Issue',
  transfer: 'Transfer',
  consumption: 'Consumption',
  department_return: 'Department return',
  adjustment: 'Count adjustment',
  supplier_return: 'Return to supplier',
  discard: 'Written off',
  service_out: 'Out for service',
  service_return: 'Back from service',
};

/** The place given, or none (every place); several is an error. */
function optionalPlace(params: { mainStoreId?: string; subStoreId?: string; departmentId?: string }) {
  const given = [params.mainStoreId, params.subStoreId, params.departmentId].filter((id) => id !== undefined);
  return given.length === 0 ? null : placeOf(params);
}

function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
}

/** Today in the organisation's time zone. */
const todayIn = (timeZone: string, now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

function addDays(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

async function placeName(context: DbContext, ref: StockPlace): Promise<string> {
  const [row] =
    'mainStoreId' in ref
      ? await context.db.select({ name: mainStores.name }).from(mainStores).where(eq(mainStores.id, ref.mainStoreId))
      : 'subStoreId' in ref
        ? await context.db.select({ name: subStores.name }).from(subStores).where(eq(subStores.id, ref.subStoreId))
        : await context.db
            .select({ name: storeDepartments.name })
            .from(storeDepartments)
            .where(eq(storeDepartments.id, ref.departmentId));
  if (!row) throw new NotFoundError(placeRecord(ref));
  return row.name;
}

/** The name of the place a movement is at. */
const movementPlace = sql<string>`coalesce(${mainStores.name}, ${subStores.name}, ${storeDepartments.name})`;

interface Flow {
  qty: number;
  value: number;
}
const flow = (): Flow => ({ qty: 0, value: 0 });
const add = (target: Flow, qty: number, value: number) => {
  target.qty = qty3(target.qty + qty);
  target.value = cents(target.value + value);
};

/**
 * Old department "Summary", "Movement" and "Valuation" tabs and the store movement statement: per item, the
 * opening stock, what came in and went out in the period and the closing stock, in quantity and value; with the
 * period's totals by kind of movement.
 */
export function stockMovementReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'scm.stock-movement',
    title: 'Stock movement summary',
    group: 'Supply chain',
    description: "A store's opening stock, receipts, issues and closing stock per item over a period, with value.",
    params: z.strictObject({ ...place, groupId: z.uuid().optional(), from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const ref = placeOf(params);
      const before = sql<boolean>`${stockMovements.movedOn} < ${params.from}`;
      const inward = sql<boolean>`${stockMovements.qty} > 0`;
      const sums = await context.db
        .select({
          variantId: stockMovements.variantId,
          kind: stockMovements.kind,
          before,
          inward,
          qty: sql<number>`sum(${stockMovements.qty})`.mapWith(Number),
          value: sql<number>`sum(${stockMovements.qty} * ${stockMovements.unitCost})`.mapWith(Number),
        })
        .from(stockMovements)
        .where(and(atPlace(ref), lte(stockMovements.movedOn, params.to)))
        .groupBy(sql`1, 2, 3, 4`);
      const variantIds = [...new Set(sums.map((row) => row.variantId))];
      const variants =
        variantIds.length === 0
          ? []
          : await context.db
              .select({
                variantId: itemVariants.id,
                groupName: itemGroups.name,
                itemName: items.name,
                variantName: itemVariants.name,
                code: itemVariants.code,
                unit: items.unit,
              })
              .from(itemVariants)
              .innerJoin(items, eq(items.id, itemVariants.itemId))
              .innerJoin(itemSubGroups, eq(itemSubGroups.id, items.subGroupId))
              .innerJoin(itemGroups, eq(itemGroups.id, itemSubGroups.groupId))
              .where(
                and(
                  inArray(itemVariants.id, variantIds),
                  params.groupId ? eq(itemGroups.id, params.groupId) : undefined,
                ),
              )
              .orderBy(asc(itemGroups.name), asc(items.name), asc(itemVariants.name));
      const kept = new Set(variants.map((variant) => variant.variantId));
      const byKind = new Map<string, Flow & { kind: string; direction: 'in' | 'out' }>();
      const totals = { opening: flow(), in: flow(), out: flow(), closing: flow() };
      const rows = variants.map((variant) => {
        const row = { ...variant, opening: flow(), in: flow(), out: flow(), closing: flow() };
        for (const sum of sums.filter((entry) => entry.variantId === variant.variantId)) {
          if (sum.before) add(row.opening, sum.qty, sum.value);
          else if (sum.inward) add(row.in, sum.qty, sum.value);
          else add(row.out, -sum.qty, -sum.value);
          add(row.closing, sum.qty, sum.value);
        }
        for (const key of ['opening', 'in', 'out', 'closing'] as const) add(totals[key], row[key].qty, row[key].value);
        return row;
      });
      for (const sum of sums) {
        if (sum.before || !kept.has(sum.variantId)) continue;
        const direction = sum.inward ? 'in' : 'out';
        const key = `${direction}:${sum.kind}`;
        const entry = byKind.get(key) ?? { kind: KIND_LABELS[sum.kind], direction, ...flow() };
        add(entry, Math.abs(sum.qty), Math.abs(sum.value));
        byKind.set(key, entry);
      }
      return {
        store: await placeName(context, ref),
        rows: rows.filter((row) => row.opening.qty !== 0 || row.in.qty !== 0 || row.out.qty !== 0),
        byKind: [...byKind.values()].sort(
          (a, b) => a.direction.localeCompare(b.direction) || a.kind.localeCompare(b.kind),
        ),
        totals,
      };
    },
    describe: (params, data) => `${data.store} · ${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('stock-movement'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'groupName', header: 'Group', width: 16 },
        { key: 'itemName', header: 'Item', width: 24 },
        { key: 'variantName', header: 'Variant', width: 22 },
        { key: 'unit', header: 'Unit', width: 8 },
        { key: 'openingQty', header: 'Opening qty', format: 'decimal' },
        { key: 'openingValue', header: 'Opening value', format: 'money' },
        { key: 'inQty', header: 'In qty', format: 'decimal' },
        { key: 'inValue', header: 'In value', format: 'money' },
        { key: 'outQty', header: 'Out qty', format: 'decimal' },
        { key: 'outValue', header: 'Out value', format: 'money' },
        { key: 'closingQty', header: 'Closing qty', format: 'decimal' },
        { key: 'closingValue', header: 'Closing value', format: 'money' },
      ],
      rows: data.rows.map((row) => ({
        groupName: row.groupName,
        itemName: row.itemName,
        variantName: row.variantName,
        unit: row.unit,
        openingQty: row.opening.qty,
        openingValue: row.opening.value,
        inQty: row.in.qty,
        inValue: row.in.value,
        outQty: row.out.qty,
        outValue: row.out.value,
        closingQty: row.closing.qty,
        closingValue: row.closing.value,
      })),
    }),
  });
}

/** Old department "Expiry & Batch" tab and the near-expiry list: lots in stock that expire soon or have expired. */
export function expiryReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'scm.expiry',
    title: 'Expiring stock',
    group: 'Supply chain',
    description: 'Lots in stock that expire within a number of days (or have expired), by place, with value.',
    params: z.strictObject({
      ...place,
      asOf: day.optional(),
      withinDays: z.int().min(0).max(3650).default(90),
      includeExpired: z.boolean().default(true),
    }),
    async load(params, report) {
      const ref = optionalPlace(params);
      const asOf = params.asOf ?? todayIn(report.timeZone, report.generatedAt);
      const until = addDays(asOf, params.withinDays);
      const rows = await context.db
        .select({
          place: movementPlace,
          groupName: itemGroups.name,
          itemName: items.name,
          variantName: itemVariants.name,
          unit: items.unit,
          batchNo: stockLots.batchNo,
          expiryDate: stockLots.expiryDate,
          qty: sql<number>`sum(${stockMovements.qty})`.mapWith(Number),
          value: sql<number>`sum(${stockMovements.qty} * ${stockMovements.unitCost})`.mapWith(Number),
        })
        .from(stockMovements)
        .innerJoin(stockLots, eq(stockLots.id, stockMovements.lotId))
        .innerJoin(itemVariants, eq(itemVariants.id, stockMovements.variantId))
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .innerJoin(itemSubGroups, eq(itemSubGroups.id, items.subGroupId))
        .innerJoin(itemGroups, eq(itemGroups.id, itemSubGroups.groupId))
        .leftJoin(mainStores, eq(mainStores.id, stockMovements.mainStoreId))
        .leftJoin(subStores, eq(subStores.id, stockMovements.subStoreId))
        .leftJoin(storeDepartments, eq(storeDepartments.id, stockMovements.departmentId))
        .where(
          and(
            ref ? atPlace(ref) : undefined,
            lte(stockMovements.movedOn, asOf),
            isNotNull(stockLots.expiryDate),
            lte(stockLots.expiryDate, until),
            params.includeExpired ? undefined : gte(stockLots.expiryDate, asOf),
          ),
        )
        .groupBy(
          stockMovements.mainStoreId,
          stockMovements.subStoreId,
          stockMovements.departmentId,
          mainStores.name,
          subStores.name,
          storeDepartments.name,
          stockMovements.lotId,
          stockLots.batchNo,
          stockLots.expiryDate,
          itemGroups.name,
          items.name,
          itemVariants.name,
          items.unit,
        )
        .having(sql`sum(${stockMovements.qty}) > 0`)
        .orderBy(asc(stockLots.expiryDate), asc(movementPlace), asc(items.name), asc(itemVariants.name));
      const lots = rows.map((row) => {
        const daysLeft = daysBetween(asOf, row.expiryDate!);
        return { ...row, qty: qty3(row.qty), value: cents(row.value), daysLeft, expired: daysLeft < 0 };
      });
      const valueOf = (list: typeof lots) => cents(list.reduce((sum, lot) => sum + lot.value, 0));
      return {
        store: ref ? await placeName(context, ref) : 'Every store and department',
        asOf,
        until,
        lots,
        expiredValue: valueOf(lots.filter((lot) => lot.expired)),
        value: valueOf(lots),
      };
    },
    describe: (params, data) =>
      `${data.store} · expiring by ${data.until} (as of ${data.asOf})${params.includeExpired ? '' : ' · not yet expired'}`,
    pdf: { engine: 'html', template: template('expiry') },
    xlsx: (data) => ({
      columns: [
        { key: 'place', header: 'Store / department', width: 22 },
        { key: 'itemName', header: 'Item', width: 24 },
        { key: 'variantName', header: 'Variant', width: 22 },
        { key: 'batchNo', header: 'Batch', width: 14 },
        { key: 'expiryDate', header: 'Expiry', format: 'date' },
        { key: 'daysLeft', header: 'Days left', format: 'integer' },
        { key: 'qty', header: 'Quantity', format: 'decimal' },
        { key: 'unit', header: 'Unit', width: 8 },
        { key: 'value', header: 'Value', format: 'money' },
      ],
      rows: data.lots.map((lot) => ({ ...lot })),
    }),
  });
}

/**
 * Old receive, issue and transfer dashboards as a print: every stock document in a period, one line per
 * document and place, with how much came in or went out and its value.
 */
export function movementRegisterReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'scm.movement-register',
    title: 'Stock document register',
    group: 'Supply chain',
    description:
      'Every stock document (receive, issue, transfer, return, write-off…) in a period, with quantity and value.',
    params: z.strictObject({ ...place, kind: z.enum(STOCK_MOVEMENT_KINDS).optional(), from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const ref = optionalPlace(params);
      const where: SQL | undefined = and(
        ref ? atPlace(ref) : undefined,
        params.kind ? eq(stockMovements.kind, params.kind) : undefined,
        gte(stockMovements.movedOn, params.from),
        lte(stockMovements.movedOn, params.to),
      );
      const rows = await context.db
        .select({
          movedOn: stockMovements.movedOn,
          documentNumber: stockMovements.documentNumber,
          kind: stockMovements.kind,
          place: movementPlace,
          items: sql<number>`count(distinct ${stockMovements.variantId})`.mapWith(Number),
          qtyIn: sql<number>`coalesce(sum(${stockMovements.qty}) filter (where ${stockMovements.qty} > 0), 0)`.mapWith(
            Number,
          ),
          qtyOut:
            sql<number>`coalesce(-sum(${stockMovements.qty}) filter (where ${stockMovements.qty} < 0), 0)`.mapWith(
              Number,
            ),
          value: sql<number>`sum(${stockMovements.qty} * ${stockMovements.unitCost})`.mapWith(Number),
        })
        .from(stockMovements)
        .leftJoin(mainStores, eq(mainStores.id, stockMovements.mainStoreId))
        .leftJoin(subStores, eq(subStores.id, stockMovements.subStoreId))
        .leftJoin(storeDepartments, eq(storeDepartments.id, stockMovements.departmentId))
        .where(where)
        .groupBy(
          stockMovements.movedOn,
          stockMovements.documentId,
          stockMovements.documentNumber,
          stockMovements.kind,
          stockMovements.mainStoreId,
          stockMovements.subStoreId,
          stockMovements.departmentId,
          mainStores.name,
          subStores.name,
          storeDepartments.name,
        )
        .orderBy(asc(stockMovements.movedOn), asc(stockMovements.documentNumber), asc(movementPlace));
      const documents = rows.map((row) => ({
        ...row,
        kindLabel: KIND_LABELS[row.kind],
        qtyIn: qty3(row.qtyIn),
        qtyOut: qty3(row.qtyOut),
        valueIn: row.value > 0 ? cents(row.value) : 0,
        valueOut: row.value < 0 ? cents(-row.value) : 0,
      }));
      return {
        store: ref ? await placeName(context, ref) : 'Every store and department',
        documents,
        valueIn: cents(documents.reduce((sum, row) => sum + row.valueIn, 0)),
        valueOut: cents(documents.reduce((sum, row) => sum + row.valueOut, 0)),
      };
    },
    describe: (params, data) =>
      `${data.store}${params.kind ? ` · ${KIND_LABELS[params.kind]}` : ''} · ${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('movement-register') },
    xlsx: (data) => ({
      columns: [
        { key: 'movedOn', header: 'Date', format: 'date' },
        { key: 'documentNumber', header: 'Document', width: 18 },
        { key: 'kindLabel', header: 'Kind', width: 18 },
        { key: 'place', header: 'Store / department', width: 22 },
        { key: 'items', header: 'Items', format: 'integer' },
        { key: 'qtyIn', header: 'Qty in', format: 'decimal' },
        { key: 'qtyOut', header: 'Qty out', format: 'decimal' },
        { key: 'valueIn', header: 'Value in', format: 'money' },
        { key: 'valueOut', header: 'Value out', format: 'money' },
      ],
      rows: data.documents.map(({ kind: _kind, value: _value, ...row }) => ({ ...row })),
    }),
  });
}

const GATE_PASS_KINDS = { supplier_return: 'Return to supplier', maintenance: 'Maintenance', other: 'Other' } as const;

/** Old Gate Pass Register page: every gate pass in a period. */
export function gatePassRegisterReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'scm.gate-pass-register',
    title: 'Gate pass register',
    group: 'Supply chain',
    description: 'Every gate pass in a period: number, date, kind, party and the document it was issued for.',
    params: z.strictObject({
      kind: z.enum(['supplier_return', 'maintenance', 'other']).optional(),
      from: day,
      to: day,
    }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const rows = await context.db
        .select({
          number: gatePasses.number,
          passDate: gatePasses.passDate,
          kind: gatePasses.kind,
          partyName: gatePasses.partyName,
          reference: gatePasses.reference,
          note: gatePasses.note,
        })
        .from(gatePasses)
        .where(
          and(
            gte(gatePasses.passDate, params.from),
            lte(gatePasses.passDate, params.to),
            params.kind ? eq(gatePasses.kind, params.kind) : undefined,
          ),
        )
        .orderBy(asc(gatePasses.passDate), asc(gatePasses.number));
      return { passes: rows.map((row) => ({ ...row, kindLabel: GATE_PASS_KINDS[row.kind] })) };
    },
    describe: (params) => `${params.kind ? `${GATE_PASS_KINDS[params.kind]} · ` : ''}${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('gate-pass-register') },
    xlsx: (data) => ({
      columns: [
        { key: 'number', header: 'Gate pass', width: 16 },
        { key: 'passDate', header: 'Date', format: 'date' },
        { key: 'kindLabel', header: 'Kind', width: 18 },
        { key: 'partyName', header: 'Party', width: 26 },
        { key: 'reference', header: 'Reference', width: 18 },
        { key: 'note', header: 'Note', width: 30 },
      ],
      rows: data.passes.map(({ kind: _kind, ...row }) => ({ ...row })),
    }),
  });
}
