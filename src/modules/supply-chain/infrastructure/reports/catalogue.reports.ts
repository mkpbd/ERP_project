import { fileURLToPath } from 'node:url';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import {
  itemGroups,
  items,
  itemSubGroups,
  itemVariants,
  suppliers,
  supplierTypes,
} from '../persistence/supply-chain.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** Old item list print: every active variant by group and sub-group, with prices and reorder level. */
export function itemCatalogueReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'scm.item-catalogue',
    title: 'Item catalogue',
    group: 'Supply chain',
    description: 'Active items and their variants by group and sub-group, with unit, prices and reorder level.',
    params: z.strictObject({ groupId: z.uuid().optional() }),
    async load(params) {
      const rows = await context.db
        .select({
          group: itemGroups.name,
          subGroup: itemSubGroups.name,
          item: items.name,
          unit: items.unit,
          variant: itemVariants.name,
          code: itemVariants.code,
          purchasePrice: itemVariants.purchasePrice,
          salePrice: itemVariants.salePrice,
          reorderLevel: itemVariants.reorderLevel,
          expiryRequired: itemVariants.expiryRequired,
        })
        .from(itemVariants)
        .innerJoin(items, eq(items.id, itemVariants.itemId))
        .innerJoin(itemSubGroups, eq(itemSubGroups.id, items.subGroupId))
        .innerJoin(itemGroups, eq(itemGroups.id, itemSubGroups.groupId))
        .where(
          and(
            eq(itemVariants.isActive, true),
            eq(items.isActive, true),
            params.groupId ? eq(itemGroups.id, params.groupId) : undefined,
          ),
        )
        .orderBy(asc(itemGroups.name), asc(itemSubGroups.name), asc(items.name), asc(itemVariants.name));
      const groups: { title: string; rows: typeof rows }[] = [];
      for (const row of rows) {
        const title = `${row.group} › ${row.subGroup}`;
        const last = groups.at(-1);
        if (last?.title === title) last.rows.push(row);
        else groups.push({ title, rows: [row] });
      }
      return { groups, count: rows.length };
    },
    describe: (_params, data) => `${data.count} variants`,
    pdf: { engine: 'html', template: template('item-catalogue') },
    xlsx: (data) => ({
      columns: [
        { key: 'group', header: 'Group', width: 18 },
        { key: 'subGroup', header: 'Sub-group', width: 18 },
        { key: 'item', header: 'Item', width: 24 },
        { key: 'variant', header: 'Variant', width: 26 },
        { key: 'code', header: 'Code', width: 12 },
        { key: 'unit', header: 'Unit', width: 8 },
        { key: 'purchasePrice', header: 'Purchase price', format: 'money' },
        { key: 'salePrice', header: 'Sale price', format: 'money' },
        { key: 'reorderLevel', header: 'Reorder level', format: 'integer' },
      ],
      rows: data.groups.flatMap((group) => group.rows.map((row) => ({ ...row }))),
    }),
  });
}

/** Old supplier list: suppliers by type with contact, enlistment and VAT / tax rates. */
export function supplierListReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'scm.suppliers',
    title: 'Supplier list',
    group: 'Supply chain',
    description: 'Active suppliers by type, with contact, enlistment period and VAT and tax rates.',
    params: z.strictObject({ enlistedOnly: z.boolean().default(false) }),
    async load(params) {
      const rows = await context.db
        .select({
          type: supplierTypes.name,
          name: suppliers.name,
          contactNo: suppliers.contactNo,
          address: suppliers.address,
          isEnlisted: suppliers.isEnlisted,
          enlistedOn: suppliers.enlistedOn,
          enlistmentExpiresOn: suppliers.enlistmentExpiresOn,
          vatPercent: suppliers.vatPercent,
          taxPercent: suppliers.taxPercent,
        })
        .from(suppliers)
        .innerJoin(supplierTypes, eq(supplierTypes.id, suppliers.typeId))
        .where(and(eq(suppliers.isActive, true), params.enlistedOnly ? eq(suppliers.isEnlisted, true) : undefined))
        .orderBy(asc(supplierTypes.name), asc(suppliers.name));
      return { rows };
    },
    describe: (params, data) => `${data.rows.length} suppliers${params.enlistedOnly ? ' · enlisted only' : ''}`,
    pdf: { engine: 'html', template: template('supplier-list'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'type', header: 'Type', width: 14 },
        { key: 'name', header: 'Supplier', width: 28 },
        { key: 'contactNo', header: 'Contact', width: 16 },
        { key: 'address', header: 'Address', width: 30 },
        { key: 'enlistedOn', header: 'Enlisted', format: 'date' },
        { key: 'enlistmentExpiresOn', header: 'Expires', format: 'date' },
        { key: 'vatPercent', header: 'VAT %', format: 'money' },
        { key: 'taxPercent', header: 'Tax %', format: 'money' },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}
