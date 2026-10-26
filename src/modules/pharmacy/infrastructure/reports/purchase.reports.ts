import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { PharmacyReadRepository } from '../../application/purchase.messages.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** Old PrintPurchaseOrderDocument / PrintOrderDocument. */
export function purchaseOrderReport(read: PharmacyReadRepository): ReportDefinition {
  return defineReport({
    key: 'pharmacy.purchase-order',
    title: 'Medicine purchase order',
    group: 'Pharmacy',
    description: 'One purchase order: supplier, outlet and the products with ordered and received quantities.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params) {
      const order = await read.getOrder(params.id);
      if (!order) throw new NotFoundError('purchase_order');
      return { order };
    },
    describe: (_params, data) => `${data.order.number} · ${data.order.supplierName}`,
    pdf: { engine: 'html', template: template('purchase-order') },
  });
}

/** Old PrintPharmacyStockReceiveDataDocument: the GRN with lots, rates, discount, VAT and the total in words. */
export function receiveReport(read: PharmacyReadRepository): ReportDefinition {
  return defineReport({
    key: 'pharmacy.receive',
    title: 'Medicine goods received',
    group: 'Pharmacy',
    description: 'One stock receive: products, batches, expiry, purchase and sale rates, discount, VAT and total.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params) {
      const receive = await read.getReceive(params.id);
      if (!receive) throw new NotFoundError('pharmacy_receive');
      return { receive };
    },
    describe: (_params, data) => `${data.receive.number} · ${data.receive.supplierName} · ${data.receive.outletName}`,
    pdf: { engine: 'html', template: template('receive'), landscape: true },
  });
}

/** Old outlet stock print (current stock with batch and expiry): stock at cost and at sale rate. */
export function outletStockReport(read: PharmacyReadRepository): ReportDefinition {
  return defineReport({
    key: 'pharmacy.stock',
    title: 'Medicine stock',
    group: 'Pharmacy',
    description: "An outlet's stock by product and lot, at cost and at sale rate, with the products to reorder.",
    params: z.strictObject({
      outletId: z.uuid(),
      asOf: z.iso.date().optional(),
      belowReorderOnly: z.boolean().default(false),
      withLots: z.boolean().default(true),
    }),
    async load(params) {
      const outlet = await read.outletName(params.outletId);
      if (outlet === null) throw new NotFoundError('outlet');
      const rows = await read.stock({
        outletId: params.outletId,
        asOf: params.asOf,
        belowReorderOnly: params.belowReorderOnly,
      });
      const sum = (pick: (row: (typeof rows)[number]) => number) =>
        Math.round(rows.reduce((total, row) => total + pick(row) * 100, 0)) / 100;
      return {
        outlet,
        rows,
        withLots: params.withLots,
        value: sum((row) => row.value),
        saleValue: sum((row) => row.saleValue),
      };
    },
    describe: (params, data) =>
      `${data.outlet}${params.asOf ? ` · as of ${params.asOf}` : ''}${params.belowReorderOnly ? ' · to reorder' : ''}`,
    pdf: { engine: 'html', template: template('outlet-stock') },
    xlsx: (data) => ({
      columns: [
        { key: 'displayName', header: 'Product', width: 28 },
        { key: 'genericName', header: 'Generic', width: 22 },
        { key: 'manufacturerName', header: 'Manufacturer', width: 22 },
        { key: 'qty', header: 'Quantity', format: 'integer' },
        { key: 'unitName', header: 'Unit', width: 8 },
        { key: 'reorderLevel', header: 'Reorder level', format: 'integer' },
        { key: 'value', header: 'Value at cost', format: 'money' },
        { key: 'saleValue', header: 'Value at sale rate', format: 'money' },
      ],
      rows: data.rows.map(({ lots: _lots, ...row }) => ({ ...row })),
    }),
  });
}
