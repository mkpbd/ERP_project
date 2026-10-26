import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import type { CatalogueEntry, CatalogueReadRepository } from '../../application/catalogue.handlers.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** The medicine price list: active products by generic group and generic, with pack, prices and barcode. */
export function priceListReport(read: CatalogueReadRepository): ReportDefinition {
  return defineReport({
    key: 'pharmacy.price-list',
    title: 'Medicine price list',
    group: 'Pharmacy',
    description: 'Products by generic group and generic, with manufacturer, pack, purchase and sale price.',
    params: z.strictObject({
      manufacturerId: z.uuid().optional(),
      genericId: z.uuid().optional(),
      includeInactive: z.boolean().default(false),
    }),
    async load(params) {
      const { items } = await read.search({
        page: 1,
        pageSize: 20_000,
        manufacturerId: params.manufacturerId,
        genericId: params.genericId,
        isActive: params.includeInactive ? undefined : true,
      });
      const sorted = [...items].sort(
        (a, b) =>
          (a.genericGroupName ?? '~').localeCompare(b.genericGroupName ?? '~') ||
          a.genericName.localeCompare(b.genericName) ||
          a.displayName.localeCompare(b.displayName),
      );
      const groups: { title: string; rows: CatalogueEntry[] }[] = [];
      for (const row of sorted) {
        const title = `${row.genericGroupName ?? 'No group'} › ${row.genericName}`;
        const last = groups.at(-1);
        if (last?.title === title) last.rows.push(row);
        else groups.push({ title, rows: [row] });
      }
      return { groups, count: items.length };
    },
    describe: (params, data) => `${data.count} products${params.includeInactive ? ' · inactive included' : ''}`,
    pdf: { engine: 'html', template: template('price-list') },
    xlsx: (data) => ({
      columns: [
        { key: 'genericGroupName', header: 'Group', width: 18 },
        { key: 'genericName', header: 'Generic', width: 22 },
        { key: 'displayName', header: 'Product', width: 28 },
        { key: 'manufacturerName', header: 'Manufacturer', width: 22 },
        { key: 'unitName', header: 'Unit', width: 8 },
        { key: 'packageUnitName', header: 'Pack', width: 8 },
        { key: 'unitsPerPack', header: 'Units per pack', format: 'integer' },
        { key: 'purchasePrice', header: 'Purchase price', format: 'money' },
        { key: 'salePrice', header: 'Sale price', format: 'money' },
        { key: 'barcode', header: 'Barcode', width: 16 },
      ],
      rows: data.groups.flatMap((group) => group.rows.map((row) => ({ ...row }))),
    }),
  });
}
