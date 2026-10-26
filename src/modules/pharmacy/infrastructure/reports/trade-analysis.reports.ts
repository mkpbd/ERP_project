import { fileURLToPath } from 'node:url';
import { and, asc, eq, gte, lte, ne, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { SupplierDirectory } from '../../../../shared/application/contracts/supplier-directory.js';
import type { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { productRef, productsById } from '../persistence/drizzle-pharmacy.read-repository.js';
import {
  brands,
  dueCollectionLines,
  dueCollections,
  manufacturers,
  outlets,
  pharmacyReceives,
  pharmacySaleLines,
  pharmacySales,
  products,
  saleReturnLines,
  saleReturns,
  supplierPaymentLines,
  supplierPayments,
  supplierReturns,
} from '../persistence/pharmacy.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const cents = (value: number) => Math.round(value * 100) / 100;
const sumOf = (column: AnyColumn | SQL) => sql<number>`coalesce(sum(${column}), 0)`.mapWith(Number);

function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
}

async function outletName(context: DbContext, id: string | undefined): Promise<string | null> {
  if (id === undefined) return null;
  const [row] = await context.db.select({ name: outlets.name }).from(outlets).where(eq(outlets.id, id));
  if (!row) throw new NotFoundError('outlet');
  return row.name;
}

async function userNames(users: UserDirectory, ids: readonly (string | null)[]): Promise<Map<string, string>> {
  const known = [...new Set(ids.filter((id): id is string => id !== null))];
  if (known.length === 0) return new Map();
  return new Map((await users.findSummaries(known)).map((user) => [user.id, user.displayName]));
}

const period = { from: day, to: day };

/**
 * Old Pharmacy Purchase Summary and Purchase Summary Date Wise (SpGetPharmacyPurchaseSummary...): posted receives
 * over a period per supplier — amount, discount, VAT, total, what was paid against them by the end of the period and
 * what is still due — with the goods sent back to the supplier in the period; optionally receive by receive.
 */
export function purchaseSummaryReport(context: DbContext, suppliers: SupplierDirectory): ReportDefinition {
  return defineReport({
    key: 'pharmacy.purchase-summary',
    title: 'Medicine purchase summary',
    group: 'Pharmacy',
    description: 'Receives per supplier over a period: amount, discount, VAT, total, paid, due and returns.',
    params: z.strictObject({
      ...period,
      outletId: z.uuid().optional(),
      supplierId: z.uuid().optional(),
      detail: z.boolean().default(false),
    }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const paid = sql<number>`coalesce((
        select sum(${supplierPaymentLines.amount}) from ${supplierPaymentLines}
        inner join ${supplierPayments} on ${supplierPayments.id} = ${supplierPaymentLines.paymentId}
        where ${supplierPaymentLines.receiveId} = ${pharmacyReceives.id} and ${supplierPayments.paidOn} <= ${params.to}
      ), 0)`.mapWith(Number);
      const receives = await context.db
        .select({
          number: pharmacyReceives.number,
          receivedOn: pharmacyReceives.receivedOn,
          supplierId: pharmacyReceives.supplierId,
          outletName: outlets.name,
          supplierInvoiceNo: pharmacyReceives.supplierInvoiceNo,
          challanNo: pharmacyReceives.challanNo,
          amount: pharmacyReceives.amount,
          discount: pharmacyReceives.discount,
          vat: pharmacyReceives.vat,
          total: pharmacyReceives.total,
          paid,
        })
        .from(pharmacyReceives)
        .innerJoin(outlets, eq(outlets.id, pharmacyReceives.outletId))
        .where(
          and(
            eq(pharmacyReceives.status, 'posted'),
            gte(pharmacyReceives.receivedOn, params.from),
            lte(pharmacyReceives.receivedOn, params.to),
            params.outletId ? eq(pharmacyReceives.outletId, params.outletId) : undefined,
            params.supplierId ? eq(pharmacyReceives.supplierId, params.supplierId) : undefined,
          ),
        )
        .orderBy(asc(pharmacyReceives.receivedOn), asc(pharmacyReceives.number));
      const returned = await context.db
        .select({ supplierId: supplierReturns.supplierId, value: sumOf(supplierReturns.value) })
        .from(supplierReturns)
        .where(
          and(
            ne(supplierReturns.status, 'draft'),
            gte(supplierReturns.returnDate, params.from),
            lte(supplierReturns.returnDate, params.to),
            params.outletId ? eq(supplierReturns.outletId, params.outletId) : undefined,
            params.supplierId ? eq(supplierReturns.supplierId, params.supplierId) : undefined,
          ),
        )
        .groupBy(supplierReturns.supplierId);
      const ids = [...new Set([...receives.map((row) => row.supplierId), ...returned.map((row) => row.supplierId)])];
      const names = new Map((await suppliers.find(ids)).map((supplier) => [supplier.id, supplier.name]));
      const blank = () => ({ receives: 0, amount: 0, discount: 0, vat: 0, total: 0, paid: 0, due: 0, returned: 0 });
      type Totals = ReturnType<typeof blank>;
      const bySupplier = new Map<string, Totals & { rows: unknown[] }>();
      const of = (id: string) => {
        const entry = bySupplier.get(id) ?? { ...blank(), rows: [] };
        bySupplier.set(id, entry);
        return entry;
      };
      const addTo = (target: Totals, row: Omit<Totals, 'receives' | 'returned'>) => {
        target.receives += 1;
        for (const key of ['amount', 'discount', 'vat', 'total', 'paid', 'due'] as const) {
          target[key] = cents(target[key] + row[key]);
        }
      };
      const totals = blank();
      for (const receive of receives) {
        const row = { ...receive, paid: cents(receive.paid), due: cents(receive.total - receive.paid) };
        const entry = of(receive.supplierId);
        addTo(entry, row);
        addTo(totals, row);
        if (params.detail) entry.rows.push(row);
      }
      for (const row of returned) {
        of(row.supplierId).returned = cents(row.value);
        totals.returned = cents(totals.returned + row.value);
      }
      const groups = [...bySupplier.entries()]
        .map(([id, entry]) => ({ supplierName: names.get(id) ?? '—', ...entry }))
        .sort((a, b) => a.supplierName.localeCompare(b.supplierName));
      return { outlet: await outletName(context, params.outletId), detail: params.detail, groups, totals };
    },
    describe: (params, data) =>
      `${data.outlet ?? 'All outlets'} · ${params.from} to ${params.to}${params.detail ? ' · receive by receive' : ''}`,
    pdf: { engine: 'html', template: template('purchase-summary'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'supplierName', header: 'Supplier', width: 28 },
        { key: 'receivedOn', header: 'Received on', format: 'date' },
        { key: 'number', header: 'Receive', width: 16 },
        { key: 'supplierInvoiceNo', header: 'Supplier invoice', width: 16 },
        { key: 'receives', header: 'Receives', format: 'integer' },
        { key: 'amount', header: 'Amount', format: 'money' },
        { key: 'discount', header: 'Discount', format: 'money' },
        { key: 'vat', header: 'VAT', format: 'money' },
        { key: 'total', header: 'Total', format: 'money' },
        { key: 'paid', header: 'Paid', format: 'money' },
        { key: 'due', header: 'Due', format: 'money' },
        { key: 'returned', header: 'Returned', format: 'money' },
      ],
      rows: data.groups.flatMap(({ rows, ...group }) => [
        ...(rows as Record<string, unknown>[]).map((row) => ({ supplierName: group.supplierName, ...row })),
        group,
      ]),
    }),
  });
}

const SALE_GROUPINGS = ['day', 'product', 'manufacturer', 'seller'] as const;
type SaleGrouping = (typeof SALE_GROUPINGS)[number];

/**
 * Old sale summaries (Sale Report Summary Date Wise, Outlet / Supplier Wise Sale, Sale Summary With Profit, Product
 * Wise Return Statement): completed sales over a period by day, product, manufacturer or seller — bills, units,
 * gross, discount, net, what customers brought back in the period, net of returns, cost and margin. Unlike the old
 * reports, returns are taken off.
 */
export function salesSummaryReport(context: DbContext, users: UserDirectory): ReportDefinition {
  return defineReport({
    key: 'pharmacy.sales-summary',
    title: 'Medicine sales summary',
    group: 'Pharmacy',
    description: 'Sales by day, product, manufacturer or seller: gross, discount, net, returns, cost and margin.',
    params: z.strictObject({
      ...period,
      outletId: z.uuid().optional(),
      by: z.enum(SALE_GROUPINGS).default('day'),
    }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const saleKey: Record<SaleGrouping, SQL<string | null>> = {
        day: sql`${pharmacySales.soldOn}`,
        product: sql`${pharmacySaleLines.productId}`,
        manufacturer: sql`${manufacturers.name}`,
        seller: sql`${pharmacySales.soldBy}`,
      };
      const returnKey: Record<SaleGrouping, SQL<string | null>> = {
        day: sql`${saleReturns.returnedOn}`,
        product: sql`${saleReturnLines.productId}`,
        manufacturer: sql`${manufacturers.name}`,
        seller: sql`${pharmacySales.soldBy}`,
      };
      const sold = await context.db
        .select({
          key: saleKey[params.by],
          bills: sql<number>`count(distinct ${pharmacySales.id})`.mapWith(Number),
          qty: sumOf(pharmacySaleLines.qty),
          gross: sumOf(pharmacySaleLines.amount),
          discount: sumOf(pharmacySaleLines.discount),
          net: sumOf(pharmacySaleLines.total),
          cost: sumOf(sql`round(${pharmacySaleLines.qty} * ${pharmacySaleLines.unitCost}, 2)`),
        })
        .from(pharmacySaleLines)
        .innerJoin(pharmacySales, eq(pharmacySales.id, pharmacySaleLines.saleId))
        .innerJoin(products, eq(products.id, pharmacySaleLines.productId))
        .innerJoin(brands, eq(brands.id, products.brandId))
        .innerJoin(manufacturers, eq(manufacturers.id, brands.manufacturerId))
        .where(
          and(
            eq(pharmacySales.status, 'completed'),
            gte(pharmacySales.soldOn, params.from),
            lte(pharmacySales.soldOn, params.to),
            params.outletId ? eq(pharmacySales.outletId, params.outletId) : undefined,
          ),
        )
        .groupBy(sql`1`);
      const back = await context.db
        .select({
          key: returnKey[params.by],
          qty: sumOf(saleReturnLines.qty),
          value: sumOf(saleReturnLines.refund),
          cost: sumOf(sql`round(${saleReturnLines.qty} * ${saleReturnLines.unitCost}, 2)`),
        })
        .from(saleReturnLines)
        .innerJoin(saleReturns, eq(saleReturns.id, saleReturnLines.returnId))
        .innerJoin(pharmacySales, eq(pharmacySales.id, saleReturns.saleId))
        .innerJoin(products, eq(products.id, saleReturnLines.productId))
        .innerJoin(brands, eq(brands.id, products.brandId))
        .innerJoin(manufacturers, eq(manufacturers.id, brands.manufacturerId))
        .where(
          and(
            gte(saleReturns.returnedOn, params.from),
            lte(saleReturns.returnedOn, params.to),
            params.outletId ? eq(saleReturns.outletId, params.outletId) : undefined,
          ),
        )
        .groupBy(sql`1`);
      const keys = [...new Set([...sold.map((row) => row.key), ...back.map((row) => row.key)])];
      const named =
        params.by === 'product'
          ? await productsById(
              context,
              keys.filter((key): key is string => key !== null),
            )
          : null;
      const sellers = params.by === 'seller' ? await userNames(users, keys) : null;
      const labelOf = (key: string | null) => {
        if (key === null) return '—';
        if (named) return productRef(named.get(key)!).displayName;
        if (sellers) return sellers.get(key) ?? '—';
        return key;
      };
      const blank = () => ({
        bills: 0,
        qty: 0,
        gross: 0,
        discount: 0,
        net: 0,
        returnedQty: 0,
        returned: 0,
        netSales: 0,
        cost: 0,
        margin: 0,
        marginPercent: null as number | null,
      });
      type Row = ReturnType<typeof blank>;
      const rows = keys.map((key) => {
        const sale = sold.find((row) => row.key === key);
        const ret = back.find((row) => row.key === key);
        const row: Row & { key: string | null; label: string } = { key, label: labelOf(key), ...blank() };
        row.bills = sale?.bills ?? 0;
        row.qty = sale?.qty ?? 0;
        row.gross = cents(sale?.gross ?? 0);
        row.discount = cents(sale?.discount ?? 0);
        row.net = cents(sale?.net ?? 0);
        row.returnedQty = ret?.qty ?? 0;
        row.returned = cents(ret?.value ?? 0);
        row.netSales = cents(row.net - row.returned);
        row.cost = cents((sale?.cost ?? 0) - (ret?.cost ?? 0));
        row.margin = cents(row.netSales - row.cost);
        // Margin % only of positive net sales: a day of returns alone has none.
        row.marginPercent = row.netSales <= 0 ? null : Math.round((row.margin / row.netSales) * 10_000) / 100;
        return row;
      });
      rows.sort((a, b) =>
        params.by === 'day' ? (a.key ?? '').localeCompare(b.key ?? '') : a.label.localeCompare(b.label),
      );
      const totals = blank();
      for (const row of rows) {
        for (const key of ['bills', 'qty', 'returnedQty'] as const) totals[key] += row[key];
        for (const key of ['gross', 'discount', 'net', 'returned', 'netSales', 'cost', 'margin'] as const) {
          totals[key] = cents(totals[key] + row[key]);
        }
      }
      totals.marginPercent = totals.netSales <= 0 ? null : Math.round((totals.margin / totals.netSales) * 10_000) / 100;
      return {
        outlet: await outletName(context, params.outletId),
        by: params.by,
        byDay: params.by === 'day',
        rows,
        totals,
      };
    },
    describe: (params, data) => `${data.outlet ?? 'All outlets'} · ${params.from} to ${params.to} · by ${params.by}`,
    pdf: { engine: 'html', template: template('sales-summary'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'label', header: data.by === 'day' ? 'Date' : data.by[0]!.toUpperCase() + data.by.slice(1), width: 28 },
        { key: 'bills', header: 'Bills', format: 'integer' },
        { key: 'qty', header: 'Units sold', format: 'integer' },
        { key: 'gross', header: 'Gross', format: 'money' },
        { key: 'discount', header: 'Discount', format: 'money' },
        { key: 'net', header: 'Net', format: 'money' },
        { key: 'returnedQty', header: 'Units returned', format: 'integer' },
        { key: 'returned', header: 'Returns', format: 'money' },
        { key: 'netSales', header: 'Net of returns', format: 'money' },
        { key: 'cost', header: 'Cost', format: 'money' },
        { key: 'margin', header: 'Margin', format: 'money' },
        { key: 'marginPercent', header: 'Margin %', format: 'decimal' },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}

const METHODS = ['cash', 'card', 'mobile'] as const;
type Method = (typeof METHODS)[number];
type ByMethod = Record<Method | 'total', number>;
const byMethod = (): ByMethod => ({ cash: 0, card: 0, mobile: 0, total: 0 });
const put = (target: ByMethod, method: Method, value: number) => {
  target[method] = cents(target[method] + value);
  target.total = cents(target.total + value);
};

/**
 * Old cash counter / Userwise Collection Summary: per user over a period, what was taken on sales and on loyal member
 * dues, less what was paid back on returns and cancelled sales, by cash, card and mobile wallet — the money each
 * counter hands over. Each amount goes to whoever took or paid it: a sale to its seller, a cancellation to whoever
 * cancelled it.
 */
export function cashCounterReport(context: DbContext, users: UserDirectory): ReportDefinition {
  return defineReport({
    key: 'pharmacy.cash-counter',
    title: 'Pharmacy cash counter',
    group: 'Pharmacy',
    description:
      'Per user: taken on sales and dues, paid back on returns and cancellations, by cash, card and mobile wallet.',
    params: z.strictObject({ ...period, outletId: z.uuid().optional(), userId: z.uuid().optional() }),
    async load(params) {
      assertPeriod(params.from, params.to);
      const outletOf = (column: typeof pharmacySales.outletId | typeof saleReturns.outletId) =>
        params.outletId ? eq(column, params.outletId) : undefined;
      const sales = await context.db
        .select({
          userId: pharmacySales.soldBy,
          method: pharmacySales.method,
          bills: sql<number>`count(*)`.mapWith(Number),
          total: sumOf(pharmacySales.total),
          discount: sumOf(pharmacySales.discount),
          paid: sumOf(pharmacySales.paid),
          due: sumOf(pharmacySales.due),
        })
        .from(pharmacySales)
        .where(
          and(
            gte(pharmacySales.soldOn, params.from),
            lte(pharmacySales.soldOn, params.to),
            outletOf(pharmacySales.outletId),
            params.userId ? eq(pharmacySales.soldBy, params.userId) : undefined,
          ),
        )
        .groupBy(pharmacySales.soldBy, pharmacySales.method);
      const cancels = await context.db
        .select({
          userId: pharmacySales.cancelledBy,
          method: pharmacySales.method,
          bills: sql<number>`count(*)`.mapWith(Number),
          paid: sumOf(pharmacySales.paid),
        })
        .from(pharmacySales)
        .where(
          and(
            eq(pharmacySales.status, 'cancelled'),
            gte(pharmacySales.cancelledOn, params.from),
            lte(pharmacySales.cancelledOn, params.to),
            outletOf(pharmacySales.outletId),
            params.userId ? eq(pharmacySales.cancelledBy, params.userId) : undefined,
          ),
        )
        .groupBy(pharmacySales.cancelledBy, pharmacySales.method);
      const returns = await context.db
        .select({
          userId: saleReturns.createdBy,
          method: pharmacySales.method,
          count: sql<number>`count(*)`.mapWith(Number),
          paidBack: sumOf(saleReturns.paidBack),
          dueReduced: sumOf(saleReturns.dueReduced),
        })
        .from(saleReturns)
        .innerJoin(pharmacySales, eq(pharmacySales.id, saleReturns.saleId))
        .where(
          and(
            gte(saleReturns.returnedOn, params.from),
            lte(saleReturns.returnedOn, params.to),
            outletOf(saleReturns.outletId),
            params.userId ? eq(saleReturns.createdBy, params.userId) : undefined,
          ),
        )
        .groupBy(saleReturns.createdBy, pharmacySales.method);
      // A collection may settle sales of several outlets: what each sale of the outlet took counts.
      const collections = await context.db
        .select({
          userId: dueCollections.createdBy,
          method: dueCollections.method,
          count: sql<number>`count(distinct ${dueCollections.id})`.mapWith(Number),
          amount: sumOf(dueCollectionLines.amount),
        })
        .from(dueCollectionLines)
        .innerJoin(dueCollections, eq(dueCollections.id, dueCollectionLines.collectionId))
        .innerJoin(pharmacySales, eq(pharmacySales.id, dueCollectionLines.saleId))
        .where(
          and(
            gte(dueCollections.collectedOn, params.from),
            lte(dueCollections.collectedOn, params.to),
            outletOf(pharmacySales.outletId),
            params.userId ? eq(dueCollections.createdBy, params.userId) : undefined,
          ),
        )
        .groupBy(dueCollections.createdBy, dueCollections.method);
      const blank = () => ({
        bills: 0,
        salesTotal: 0,
        discount: 0,
        dueGiven: 0,
        cancelledBills: 0,
        returnCount: 0,
        dueReduced: 0,
        collectionCount: 0,
        sales: byMethod(),
        collections: byMethod(),
        returns: byMethod(),
        cancels: byMethod(),
        net: byMethod(),
      });
      type Counter = ReturnType<typeof blank>;
      const counters = new Map<string | null, Counter>();
      const of = (userId: string | null) => {
        const entry = counters.get(userId) ?? blank();
        counters.set(userId, entry);
        return entry;
      };
      for (const row of sales) {
        const entry = of(row.userId);
        entry.bills += row.bills;
        entry.salesTotal = cents(entry.salesTotal + row.total);
        entry.discount = cents(entry.discount + row.discount);
        entry.dueGiven = cents(entry.dueGiven + row.due);
        put(entry.sales, row.method, row.paid);
      }
      for (const row of collections) {
        const entry = of(row.userId);
        entry.collectionCount += row.count;
        put(entry.collections, row.method, row.amount);
      }
      for (const row of returns) {
        const entry = of(row.userId);
        entry.returnCount += row.count;
        entry.dueReduced = cents(entry.dueReduced + row.dueReduced);
        put(entry.returns, row.method, -row.paidBack);
      }
      for (const row of cancels) {
        const entry = of(row.userId);
        entry.cancelledBills += row.bills;
        put(entry.cancels, row.method, -row.paid);
      }
      const names = await userNames(users, [...counters.keys()]);
      const total = blank();
      const sections = ['sales', 'collections', 'returns', 'cancels', 'net'] as const;
      const people = [...counters.entries()].map(([userId, entry]) => {
        for (const method of METHODS) {
          for (const section of ['sales', 'collections', 'returns', 'cancels'] as const) {
            put(entry.net, method, entry[section][method]);
          }
        }
        for (const key of ['bills', 'cancelledBills', 'returnCount', 'collectionCount'] as const)
          total[key] += entry[key];
        for (const key of ['salesTotal', 'discount', 'dueGiven', 'dueReduced'] as const) {
          total[key] = cents(total[key] + entry[key]);
        }
        for (const section of sections)
          for (const method of METHODS) put(total[section], method, entry[section][method]);
        return { userId, name: userId ? (names.get(userId) ?? '—') : '—', ...entry };
      });
      people.sort((a, b) => a.name.localeCompare(b.name));
      return { outlet: await outletName(context, params.outletId), people, total };
    },
    describe: (params, data) => `${data.outlet ?? 'All outlets'} · ${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('cash-counter') },
    xlsx: (data) => {
      const sections = [
        ['sales', 'Sales'],
        ['collections', 'Due collections'],
        ['returns', 'Returns paid back'],
        ['cancels', 'Cancelled'],
        ['net', 'Net'],
      ] as const;
      return {
        columns: [
          { key: 'name', header: 'User', width: 22 },
          { key: 'bills', header: 'Bills', format: 'integer' as const },
          { key: 'salesTotal', header: 'Sales value', format: 'money' as const },
          { key: 'discount', header: 'Discount', format: 'money' as const },
          { key: 'dueGiven', header: 'Due given', format: 'money' as const },
          ...sections.flatMap(([section, label]) =>
            [...METHODS, 'total' as const].map((method) => ({
              key: `${section}_${method}`,
              header: `${label} ${method}`,
              format: 'money' as const,
            })),
          ),
        ],
        rows: [...data.people, { name: 'Total', ...data.total }].map((person) => ({
          name: person.name,
          bills: person.bills,
          salesTotal: person.salesTotal,
          discount: person.discount,
          dueGiven: person.dueGiven,
          ...Object.fromEntries(
            sections.flatMap(([section]) =>
              [...METHODS, 'total' as const].map((method) => [`${section}_${method}`, person[section][method]]),
            ),
          ),
        })),
      };
    },
  });
}
