import { fileURLToPath } from 'node:url';
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { productRef, productsById } from '../persistence/drizzle-pharmacy.read-repository.js';
import {
  outlets,
  pharmacyLots,
  pharmacyMovements,
  PHARMACY_MOVEMENT_KINDS,
  stockCountLines,
  stockCounts,
} from '../persistence/pharmacy.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const cents = (value: number) => Math.round(value * 100) / 100;
const percentOf = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 10_000) / 100);

type MovementKind = (typeof PHARMACY_MOVEMENT_KINDS)[number];

const KIND_LABELS: Record<MovementKind, string> = {
  opening: 'Opening stock',
  receive: 'Received from supplier',
  supplier_return: 'Returned to supplier',
  replacement: 'Replacement from supplier',
  transfer_out: 'Transferred out',
  transfer_in: 'Transferred in',
  sale: 'Sold',
  sale_cancel: 'Sale cancelled',
  sale_return: 'Returned by customer',
  count_adjustment: 'Stock count',
  ward_issue: 'Sent to a ward',
  ward_return: 'Returned from a ward',
  lot_correction: 'Lot corrected',
};

function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
}

async function outletName(context: DbContext, id: string): Promise<string> {
  const [row] = await context.db.select({ name: outlets.name }).from(outlets).where(eq(outlets.id, id));
  if (!row) throw new NotFoundError('outlet');
  return row.name;
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

interface Flow {
  qty: number;
  value: number;
}
const flow = (): Flow => ({ qty: 0, value: 0 });
const add = (target: Flow, qty: number, value: number) => {
  target.qty += qty;
  target.value = cents(target.value + value);
};

/**
 * Old Product Ledger (SpGetProductLedger, PrintProductLedgerDocument): one product at an outlet over a period, every
 * movement lot by lot with the running stock. The opening is the ledger before the period, so the closing is always
 * what the ledger holds (no "stock flow adjustment" line is needed).
 */
export function productLedgerReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'pharmacy.product-ledger',
    title: 'Product ledger',
    group: 'Pharmacy',
    description: "One product's stock card at an outlet: opening, every receipt and issue by lot, running stock.",
    params: z.strictObject({ outletId: z.uuid(), productId: z.uuid(), from: day, to: day }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const outlet = await outletName(context, params.outletId);
      const named = (await productsById(context, [params.productId])).get(params.productId);
      if (!named) throw new NotFoundError('product');
      const here = and(
        eq(pharmacyMovements.outletId, params.outletId),
        eq(pharmacyMovements.productId, params.productId),
      );
      const [before] = await context.db
        .select({
          qty: sql<number>`coalesce(sum(${pharmacyMovements.qty}), 0)`.mapWith(Number),
          value: sql<number>`coalesce(sum(${pharmacyMovements.qty} * ${pharmacyMovements.unitCost}), 0)`.mapWith(
            Number,
          ),
        })
        .from(pharmacyMovements)
        .where(and(here, lt(pharmacyMovements.movedOn, params.from)));
      const moves = await context.db
        .select({
          movedOn: pharmacyMovements.movedOn,
          kind: pharmacyMovements.kind,
          documentNumber: pharmacyMovements.documentNumber,
          qty: pharmacyMovements.qty,
          unitCost: pharmacyMovements.unitCost,
          batchNo: pharmacyLots.batchNo,
          expiryDate: pharmacyLots.expiryDate,
        })
        .from(pharmacyMovements)
        .innerJoin(pharmacyLots, eq(pharmacyLots.id, pharmacyMovements.lotId))
        .where(and(here, gte(pharmacyMovements.movedOn, params.from), lte(pharmacyMovements.movedOn, params.to)))
        .orderBy(asc(pharmacyMovements.movedOn), asc(pharmacyMovements.createdAt), asc(pharmacyMovements.id));
      const opening = { qty: before?.qty ?? 0, value: cents(before?.value ?? 0) };
      const totals = { in: flow(), out: flow(), closing: { ...opening } };
      const byKind = new Map<MovementKind, Flow>();
      let balance = opening.qty;
      const rows = moves.map((move) => {
        const value = cents(move.qty * move.unitCost);
        balance += move.qty;
        add(move.qty > 0 ? totals.in : totals.out, Math.abs(move.qty), Math.abs(value));
        add(totals.closing, move.qty, value);
        const kind = byKind.get(move.kind) ?? flow();
        add(kind, move.qty, value);
        byKind.set(move.kind, kind);
        return {
          ...move,
          particulars: KIND_LABELS[move.kind],
          inQty: move.qty > 0 ? move.qty : null,
          outQty: move.qty < 0 ? -move.qty : null,
          balance,
          value,
        };
      });
      return {
        outlet,
        product: { ...productRef(named), manufacturerName: named.manufacturerName },
        opening,
        rows,
        totals,
        byKind: PHARMACY_MOVEMENT_KINDS.filter((kind) => byKind.has(kind)).map((kind) => ({
          kind: KIND_LABELS[kind],
          ...byKind.get(kind)!,
        })),
      };
    },
    describe: (params, data) => `${data.product.displayName} · ${data.outlet} · ${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('product-ledger') },
    xlsx: (data) => ({
      columns: [
        { key: 'movedOn', header: 'Date', format: 'date' },
        { key: 'documentNumber', header: 'Document', width: 18 },
        { key: 'particulars', header: 'Particulars', width: 24 },
        { key: 'batchNo', header: 'Batch', width: 12 },
        { key: 'expiryDate', header: 'Expiry', format: 'date' },
        { key: 'inQty', header: 'In', format: 'integer' },
        { key: 'outQty', header: 'Out', format: 'integer' },
        { key: 'balance', header: 'Balance', format: 'integer' },
        { key: 'unitCost', header: 'Unit cost', format: 'decimal' },
        { key: 'value', header: 'Value', format: 'money' },
      ],
      rows: [
        { particulars: 'Opening stock', balance: data.opening.qty, value: data.opening.value },
        ...data.rows.map((row) => ({ ...row })),
      ],
    }),
  });
}

const BUCKETS = [
  'purchased',
  'transferIn',
  'customerReturns',
  'countGain',
  'sold',
  'transferOut',
  'supplierReturns',
  'countLoss',
] as const;
type Bucket = (typeof BUCKETS)[number];
const OUTWARD = new Set<Bucket>(['sold', 'transferOut', 'supplierReturns', 'countLoss']);

/** Null: moved between two lots of the product at one outlet, which leaves its stock as it was. */
function bucketOf(kind: MovementKind, inward: boolean): Bucket | null {
  switch (kind) {
    case 'opening':
    case 'receive':
    case 'replacement':
      return 'purchased';
    case 'transfer_in':
      return 'transferIn';
    case 'sale_return':
    case 'sale_cancel':
    case 'ward_return':
      return 'customerReturns';
    case 'sale':
    case 'ward_issue':
      return 'sold';
    case 'transfer_out':
      return 'transferOut';
    case 'supplier_return':
      return 'supplierReturns';
    case 'count_adjustment':
      return inward ? 'countGain' : 'countLoss';
    case 'lot_correction':
      return null;
  }
}

const GROUPINGS = { manufacturer: 'manufacturerName', formation: 'formationName', generic: 'genericName' } as const;

/**
 * Old Pharmacy Current Stock Report and its formation-wise copy (SpGetPharmacyCurrantStock): per product over a
 * period, the opening, each kind of receipt and issue and the closing, grouped by manufacturer, formation or generic,
 * with the opening and closing at cost.
 */
export function stockMovementReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'pharmacy.stock-movement',
    title: 'Medicine stock movement',
    group: 'Pharmacy',
    description:
      "An outlet's opening, purchases, transfers, returns, sales, count differences and closing per product over a period.",
    params: z.strictObject({
      outletId: z.uuid(),
      from: day,
      to: day,
      groupBy: z.enum(['manufacturer', 'formation', 'generic']).default('manufacturer'),
    }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const outlet = await outletName(context, params.outletId);
      const before = sql<boolean>`${pharmacyMovements.movedOn} < ${params.from}`;
      const inward = sql<boolean>`${pharmacyMovements.qty} > 0`;
      const sums = await context.db
        .select({
          productId: pharmacyMovements.productId,
          kind: pharmacyMovements.kind,
          before,
          inward,
          qty: sql<number>`sum(${pharmacyMovements.qty})`.mapWith(Number),
          value: sql<number>`sum(${pharmacyMovements.qty} * ${pharmacyMovements.unitCost})`.mapWith(Number),
        })
        .from(pharmacyMovements)
        .where(and(eq(pharmacyMovements.outletId, params.outletId), lte(pharmacyMovements.movedOn, params.to)))
        .groupBy(sql`1, 2, 3, 4`);
      const named = await productsById(
        context,
        sums.map((sum) => sum.productId),
      );
      const rows = new Map<
        string,
        { opening: Flow; closing: Flow; moves: Record<Bucket, number>; product: ReturnType<typeof productRef> }
      >();
      for (const sum of sums) {
        const row = rows.get(sum.productId) ?? {
          opening: flow(),
          closing: flow(),
          moves: Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0])) as Record<Bucket, number>,
          product: productRef(named.get(sum.productId)!),
        };
        rows.set(sum.productId, row);
        if (sum.before) add(row.opening, sum.qty, sum.value);
        else {
          const bucket = bucketOf(sum.kind, sum.inward);
          if (bucket) row.moves[bucket] += OUTWARD.has(bucket) ? -sum.qty : sum.qty;
        }
        add(row.closing, sum.qty, sum.value);
      }
      const field = GROUPINGS[params.groupBy];
      const lines = [...rows.entries()]
        .filter(([, row]) => row.opening.qty !== 0 || row.closing.qty !== 0 || BUCKETS.some((b) => row.moves[b] !== 0))
        .map(([productId, row]) => ({
          ...row.product,
          groupName: named.get(productId)![field],
          opening: row.opening,
          closing: row.closing,
          ...row.moves,
        }))
        .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.displayName.localeCompare(b.displayName));
      const groups: { name: string; rows: typeof lines; opening: number; closing: number }[] = [];
      for (const line of lines) {
        let group = groups.at(-1);
        if (group?.name !== line.groupName) {
          group = { name: line.groupName, rows: [], opening: 0, closing: 0 };
          groups.push(group);
        }
        group.rows.push(line);
        group.opening = cents(group.opening + line.opening.value);
        group.closing = cents(group.closing + line.closing.value);
      }
      return {
        outlet,
        groupBy: params.groupBy,
        groups,
        rows: lines,
        opening: cents(groups.reduce((total, group) => total + group.opening, 0)),
        closing: cents(groups.reduce((total, group) => total + group.closing, 0)),
      };
    },
    describe: (params, data) => `${data.outlet} · ${params.from} to ${params.to} · by ${params.groupBy}`,
    pdf: { engine: 'html', template: template('stock-movement'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'groupName', header: 'Group', width: 20 },
        { key: 'displayName', header: 'Product', width: 28 },
        { key: 'openingQty', header: 'Opening', format: 'integer' },
        { key: 'purchased', header: 'Purchased', format: 'integer' },
        { key: 'transferIn', header: 'Transfer in', format: 'integer' },
        { key: 'customerReturns', header: 'Customer returns', format: 'integer' },
        { key: 'countGain', header: 'Count +', format: 'integer' },
        { key: 'sold', header: 'Sold', format: 'integer' },
        { key: 'transferOut', header: 'Transfer out', format: 'integer' },
        { key: 'supplierReturns', header: 'Supplier returns', format: 'integer' },
        { key: 'countLoss', header: 'Count −', format: 'integer' },
        { key: 'closingQty', header: 'Closing', format: 'integer' },
        { key: 'openingValue', header: 'Opening value', format: 'money' },
        { key: 'closingValue', header: 'Closing value', format: 'money' },
      ],
      rows: data.rows.map(({ opening, closing, ...row }) => ({
        ...row,
        openingQty: opening.qty,
        openingValue: opening.value,
        closingQty: closing.qty,
        closingValue: closing.value,
      })),
    }),
  });
}

/**
 * Old expired and upcoming-expiry lists (PrintExpireProductDocument, PrintUpCommingExpireProductDocument, MIS
 * Expired Product Statement): lots still held that are expired or expire within the days given, at cost and at sale
 * rate, by outlet.
 */
export function expiryReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'pharmacy.expiry',
    title: 'Expired and expiring medicines',
    group: 'Pharmacy',
    description: 'Lots held that are expired or expire within the days given, with days left, at cost and sale rate.',
    params: z.strictObject({ outletId: z.uuid().optional(), days: z.int().min(0).max(365).default(90) }),
    async load(params, report) {
      const today = todayIn(report.timeZone, report.generatedAt);
      const until = addDays(today, params.days);
      const held = await context.db
        .select({
          outletName: outlets.name,
          productId: pharmacyMovements.productId,
          batchNo: pharmacyLots.batchNo,
          expiryDate: pharmacyLots.expiryDate,
          saleRate: pharmacyLots.saleRate,
          qty: sql<number>`sum(${pharmacyMovements.qty})`.mapWith(Number),
          value: sql<number>`sum(${pharmacyMovements.qty} * ${pharmacyMovements.unitCost})`.mapWith(Number),
        })
        .from(pharmacyMovements)
        .innerJoin(pharmacyLots, eq(pharmacyLots.id, pharmacyMovements.lotId))
        .innerJoin(outlets, eq(outlets.id, pharmacyMovements.outletId))
        .where(
          and(
            params.outletId ? eq(pharmacyMovements.outletId, params.outletId) : undefined,
            lte(pharmacyLots.expiryDate, until),
          ),
        )
        .groupBy(
          outlets.name,
          pharmacyMovements.productId,
          pharmacyMovements.lotId,
          pharmacyLots.batchNo,
          pharmacyLots.expiryDate,
          pharmacyLots.saleRate,
        )
        .having(sql`sum(${pharmacyMovements.qty}) > 0`)
        .orderBy(asc(pharmacyLots.expiryDate), asc(outlets.name));
      const named = await productsById(
        context,
        held.map((lot) => lot.productId),
      );
      const soon = addDays(today, 30);
      const bands = [
        { label: 'Expired', test: (expiry: string) => expiry <= today },
        { label: 'Expiring within 30 days', test: (expiry: string) => expiry <= soon },
        { label: `Expiring in 31 to ${params.days} days`, test: () => true },
      ];
      const groups = bands.map((band) => ({ label: band.label, rows: [] as unknown[], value: 0, saleValue: 0 }));
      let value = 0;
      let saleValue = 0;
      for (const lot of held) {
        const product = named.get(lot.productId)!;
        const row = {
          ...productRef(product),
          manufacturerName: product.manufacturerName,
          outletName: lot.outletName,
          batchNo: lot.batchNo,
          expiryDate: lot.expiryDate,
          daysLeft: daysBetween(today, lot.expiryDate),
          qty: lot.qty,
          value: cents(lot.value),
          saleValue: cents(lot.qty * lot.saleRate),
        };
        const group = groups[bands.findIndex((band) => band.test(lot.expiryDate))]!;
        group.rows.push(row);
        group.value = cents(group.value + row.value);
        group.saleValue = cents(group.saleValue + row.saleValue);
        value = cents(value + row.value);
        saleValue = cents(saleValue + row.saleValue);
      }
      return {
        outlet: params.outletId ? await outletName(context, params.outletId) : null,
        today,
        groups: groups.filter((group) => group.rows.length > 0),
        value,
        saleValue,
      };
    },
    describe: (params, data) => `${data.outlet ?? 'All outlets'} · as of ${data.today} · within ${params.days} days`,
    pdf: { engine: 'html', template: template('expiry'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'band', header: 'Status', width: 22 },
        { key: 'outletName', header: 'Outlet', width: 18 },
        { key: 'displayName', header: 'Product', width: 28 },
        { key: 'genericName', header: 'Generic', width: 20 },
        { key: 'manufacturerName', header: 'Manufacturer', width: 20 },
        { key: 'batchNo', header: 'Batch', width: 12 },
        { key: 'expiryDate', header: 'Expiry', format: 'date' },
        { key: 'daysLeft', header: 'Days left', format: 'integer' },
        { key: 'qty', header: 'Quantity', format: 'integer' },
        { key: 'value', header: 'Value at cost', format: 'money' },
        { key: 'saleValue', header: 'Value at sale rate', format: 'money' },
      ],
      rows: data.groups.flatMap((group) =>
        group.rows.map((row) => ({ band: group.label, ...(row as Record<string, unknown>) })),
      ),
    }),
  });
}

interface Cell {
  items: number | null;
  value: number | null;
  percent: number | null;
}
const cell = (items: number | null, value: number | null = null, percent: number | null = null): Cell => ({
  items,
  value,
  percent,
});

/**
 * Old Physical Inventory Report (spGetPharmacyPhysicalInventoryReport, PharmacyPhysicalInventoryDocument and its
 * Excel export): applied stock counts side by side, e.g. one per quarter. Lots and products counted, equal, over,
 * short, written off and expired still held, at cost and as a share of the stock counted, with the net deviation and
 * the lots most short.
 */
export function physicalInventoryReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'pharmacy.physical-inventory',
    title: 'Physical inventory summary',
    group: 'Pharmacy',
    description:
      'Applied stock counts side by side: equal, over, short, written off and expired, with the lots most short.',
    params: z.strictObject({
      countIds: z.array(z.uuid()).min(1).max(6),
      top: z.int().min(0).max(20).default(5),
    }),
    async load(params) {
      const headers = await context.db
        .select({
          id: stockCounts.id,
          number: stockCounts.number,
          countDate: stockCounts.countDate,
          status: stockCounts.status,
          outletName: outlets.name,
        })
        .from(stockCounts)
        .innerJoin(outlets, eq(outlets.id, stockCounts.outletId))
        .where(inArray(stockCounts.id, params.countIds));
      const missing = params.countIds.find((id) => !headers.some((header) => header.id === id));
      if (missing) throw new NotFoundError('stock_count');
      const notApplied = headers.find((header) => header.status !== 'applied');
      if (notApplied) {
        throw new DomainError(
          'stock_count_state',
          `${notApplied.number} is not applied; only applied counts are summed up`,
        );
      }
      const lines = await context.db
        .select({
          countId: stockCountLines.countId,
          productId: stockCountLines.productId,
          batchNo: pharmacyLots.batchNo,
          expiryDate: pharmacyLots.expiryDate,
          system: stockCountLines.appliedSystemQty,
          counted: stockCountLines.countedQty,
          adjusted: stockCountLines.adjustedQty,
          unitCost: stockCountLines.unitCost,
          writeOff: stockCountLines.writeOff,
        })
        .from(stockCountLines)
        .innerJoin(pharmacyLots, eq(pharmacyLots.id, stockCountLines.lotId))
        .where(inArray(stockCountLines.countId, params.countIds));
      const named = await productsById(
        context,
        lines.map((line) => line.productId),
      );
      const counts = [...headers].sort(
        (a, b) => a.countDate.localeCompare(b.countDate) || a.number.localeCompare(b.number),
      );
      const columns = counts.map((header) => {
        const mine = lines
          .filter((line) => line.countId === header.id)
          .map((line) => ({
            ...line,
            system: line.system ?? 0,
            counted: line.counted ?? 0,
            adjusted: line.adjusted ?? 0,
            expired: line.expiryDate <= header.countDate,
            deviation: cents((line.adjusted ?? 0) * line.unitCost),
          }));
        const valueOf = (pick: (line: (typeof mine)[number]) => number) =>
          cents(mine.reduce((total, line) => total + pick(line), 0));
        const stockValue = valueOf((line) => line.system * line.unitCost);
        const equal = mine.filter((line) => line.adjusted === 0);
        const over = mine.filter((line) => line.adjusted > 0);
        const short = mine.filter((line) => line.adjusted < 0 && !line.writeOff);
        const writtenOff = mine.filter((line) => line.adjusted < 0 && line.writeOff);
        const expired = mine.filter((line) => line.expired && line.counted > 0);
        const sumOf = (subset: typeof mine) =>
          cents(subset.reduce((total, line) => total + Math.abs(line.deviation), 0));
        const overValue = sumOf(over);
        const shortValue = sumOf(short);
        const writtenOffValue = sumOf(writtenOff);
        const expiredValue = cents(expired.reduce((total, line) => total + line.counted * line.unitCost, 0));
        const net = cents(overValue - shortValue - writtenOffValue);
        return {
          ...header,
          cells: {
            lots: cell(mine.length),
            products: cell(new Set(mine.map((line) => line.productId)).size),
            stockValue: cell(null, stockValue),
            equal: cell(
              equal.length,
              valueOf((line) => (line.adjusted === 0 ? line.system * line.unitCost : 0)),
            ),
            over: cell(over.length, overValue, percentOf(overValue, stockValue)),
            short: cell(short.length, -shortValue, percentOf(shortValue, stockValue)),
            writtenOff: cell(writtenOff.length, -writtenOffValue, percentOf(writtenOffValue, stockValue)),
            expired: cell(expired.length, expiredValue, percentOf(expiredValue, stockValue)),
            net: cell(null, net, percentOf(net, stockValue)),
          },
          top: [...short]
            .sort((a, b) => a.deviation - b.deviation)
            .slice(0, params.top)
            .map((line) => ({
              displayName: productRef(named.get(line.productId)!).displayName,
              batchNo: line.batchNo,
              expiryDate: line.expiryDate,
              system: line.system,
              counted: line.counted,
              adjusted: line.adjusted,
              value: line.deviation,
            })),
        };
      });
      const METRICS = [
        ['lots', 'Lots counted'],
        ['products', 'Products counted'],
        ['stockValue', 'Stock held at cost (ledger)'],
        ['equal', 'Equal'],
        ['over', 'Over (count gain)'],
        ['short', 'Short (count loss)'],
        ['writtenOff', 'Written off, expired or damaged'],
        ['expired', 'Expired still on the shelf'],
        ['net', 'Net deviation'],
      ] as const;
      return {
        counts: columns.map(({ cells: _cells, top: _top, ...header }) => header),
        metrics: METRICS.map(([key, label]) => ({ label, cells: columns.map((column) => column.cells[key]) })),
        tops: columns.map((column) => ({ number: column.number, outletName: column.outletName, rows: column.top })),
        top: params.top,
      };
    },
    describe: (_params, data) => data.counts.map((count) => `${count.number} (${count.outletName})`).join(' · '),
    pdf: { engine: 'html', template: template('physical-inventory'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'label', header: 'Figure', width: 30 },
        ...data.counts.flatMap((count, index) => [
          { key: `items${index}`, header: `${count.number} items`, format: 'integer' as const },
          { key: `value${index}`, header: `${count.number} value`, format: 'money' as const },
          { key: `percent${index}`, header: `${count.number} %`, format: 'decimal' as const },
        ]),
      ],
      rows: data.metrics.map((metric) => ({
        label: metric.label,
        ...Object.fromEntries(
          metric.cells.flatMap((entry, index) => [
            [`items${index}`, entry.items],
            [`value${index}`, entry.value],
            [`percent${index}`, entry.percent],
          ]),
        ),
      })),
    }),
  });
}
