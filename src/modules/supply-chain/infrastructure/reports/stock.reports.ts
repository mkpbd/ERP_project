import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import type { StockReadRepository } from '../../application/stock.messages.js';
import type { StoreRef } from '../../domain/repositories.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const store = {
  mainStoreId: z.uuid().optional(),
  subStoreId: z.uuid().optional(),
};
const storeOf = (params: { mainStoreId?: string | undefined; subStoreId?: string | undefined }): StoreRef => {
  if ((params.mainStoreId === undefined) === (params.subStoreId === undefined)) {
    throw new DomainError('invalid_store', 'Give either a main store or a sub-store');
  }
  return params.mainStoreId ? { mainStoreId: params.mainStoreId } : { subStoreId: params.subStoreId! };
};

async function storeName(read: StockReadRepository, ref: StoreRef): Promise<string> {
  const name = await read.storeName(ref);
  if (name === null) throw new NotFoundError('mainStoreId' in ref ? 'main_store' : 'sub_store');
  return name;
}

/** Old "Stock record" print: a receive with its lines, lots and amounts. */
export function stockReceiveReport(read: StockReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.stock-receive',
    title: 'Goods received',
    group: 'Supply chain',
    description: "One stock receive: items, lots, rates, discount, VAT, AIT and the supplier's total.",
    params: z.strictObject({ id: z.uuid() }),
    async load(params) {
      const receive = await read.getReceive(params.id);
      if (!receive) throw new NotFoundError('stock_receive');
      return { receive };
    },
    describe: (_params, data) => `${data.receive.number}${data.receive.status === 'draft' ? ' · draft' : ''}`,
    pdf: { engine: 'html', template: template('stock-receive'), landscape: true },
  });
}

/** Old SpGetSCMStockReport / ForMainStore / ForSubStore: what a store holds, by item, with value. */
export function stockReport(read: StockReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.stock',
    title: 'Stock statement',
    group: 'Supply chain',
    description: "A store's stock by item (and lot), with value and the items below their reorder level.",
    params: z.strictObject({
      ...store,
      groupId: z.uuid().optional(),
      asOf: day.optional(),
      belowReorderOnly: z.boolean().default(false),
      withLots: z.boolean().default(false),
    }),
    async load(params) {
      const ref = storeOf(params);
      const rows = await read.stock({
        store: ref,
        groupId: params.groupId,
        asOf: params.asOf,
        belowReorderOnly: params.belowReorderOnly,
        includeEmpty: params.belowReorderOnly,
      });
      const value = Math.round(rows.reduce((sum, row) => sum + row.value * 100, 0)) / 100;
      return { store: await storeName(read, ref), rows, value, withLots: params.withLots };
    },
    describe: (params, data) =>
      `${data.store}${params.asOf ? ` · as of ${params.asOf}` : ''}${params.belowReorderOnly ? ' · below reorder level' : ''}`,
    pdf: { engine: 'html', template: template('stock-statement') },
    xlsx: (data) => ({
      columns: [
        { key: 'groupName', header: 'Group', width: 18 },
        { key: 'itemName', header: 'Item', width: 24 },
        { key: 'variantName', header: 'Variant', width: 24 },
        { key: 'code', header: 'Code', width: 12 },
        { key: 'unit', header: 'Unit', width: 8 },
        { key: 'qty', header: 'Quantity', format: 'decimal' },
        { key: 'reorderLevel', header: 'Reorder level', format: 'integer' },
        { key: 'value', header: 'Value', format: 'money' },
      ],
      rows: data.rows.map(({ lots: _lots, ...row }) => ({ ...row })),
    }),
  });
}

/** Old item ledger: one item's movements in a store with the running balance. */
export function stockCardReport(read: StockReadRepository): ReportDefinition {
  return defineReport({
    key: 'scm.stock-card',
    title: 'Stock card',
    group: 'Supply chain',
    description: "One item's receipts and issues in a store over a period, with the running balance.",
    params: z.strictObject({ ...store, variantId: z.uuid(), from: day, to: day }),
    async load(params) {
      if (params.from > params.to) throw new DomainError('invalid_period', 'The start date is after the end date');
      const ref = storeOf(params);
      const card = await read.card(ref, params.variantId, params.from, params.to);
      if (!card) throw new NotFoundError('item_variant');
      return { store: await storeName(read, ref), card };
    },
    describe: (params, data) =>
      `${data.card.itemName} — ${data.card.variantName} · ${data.store} · ${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('stock-card') },
  });
}
