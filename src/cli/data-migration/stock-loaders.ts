import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import {
  glAccounts,
  glRoles,
  voucherLines,
  vouchers,
} from '../../modules/accounts/infrastructure/persistence/accounts.schema.js';
import {
  brands,
  formations,
  genericGroups,
  generics,
  manufacturers,
  outlets,
  packageUnits,
  pharmacyLots,
  pharmacyMovements,
  pharmacyOpenings,
  pharmacySequences,
  products,
  strengths,
  units,
} from '../../modules/pharmacy/infrastructure/persistence/pharmacy.schema.js';
import {
  itemCategories,
  itemGroups,
  items,
  itemSubCategories,
  itemSubGroups,
  itemVariants,
  mainStores,
  scmSequences,
  stockLots,
  stockMovements,
  stockOpenings,
  storeDepartments,
  subStores,
  supplierTypes,
  suppliers,
} from '../../modules/supply-chain/infrastructure/persistence/supply-chain.schema.js';
import { dayBefore, text } from './account-records.js';
import { noteRejection, type EtlContext, type Loader, type LoaderReport } from './etl.js';
import { isNew, namedLoader, NIL, pages } from './loader-kit.js';
import { allocate, expiryDay, isAssetType } from './stock-records.js';

/** The category and sub-category of items whose old sub-category is gone. */
const GENERAL = 'General';
const money = (value: unknown) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
};
const percent = (value: unknown) => Math.min(100, money(value));
/** Old DateTime columns that were never set hold 0001-01-01. */
const realDay = (value: Date | null | undefined) =>
  value && value.getUTCFullYear() > 1900 ? value.toISOString().slice(0, 10) : null;
const documentNumber = (kind: string, year: number, serial: number) =>
  `${kind}-${year}-${String(serial).padStart(5, '0')}`;

// ---- Pharmacy catalogue (old Pharmacy.*)

export const genericGroupsLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'generic-groups',
    entity: 'generic-group',
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], [Info] FROM [Pharmacy].[Groups]',
    existing: () => db.db.select({ id: genericGroups.id, name: genericGroups.name }).from(genericGroups),
    insert: async (row) => {
      await db.db.insert(genericGroups).values({ id: row.id, name: row.name, info: text(row['Info'], 500) });
    },
  });

export const genericsLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'generics',
    entity: 'generic',
    dependsOn: { loader: 'generic-groups', entity: 'generic-group', optional: true },
    max: 200,
    query: `SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], CAST([GroupId] AS nvarchar(36)) AS [Parent], [Info]
      FROM [Pharmacy].[Generics]`,
    existing: () => db.db.select({ id: generics.id, name: generics.name }).from(generics),
    insert: async (row) => {
      await db.db
        .insert(generics)
        .values({ id: row.id, name: row.name, groupId: row.parentId, info: text(row['Info'], 500) });
    },
  });

export const formationsLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'formations',
    entity: 'formation',
    max: 60,
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], [ShortFormation] FROM [Pharmacy].[Formations]',
    existing: () => db.db.select({ id: formations.id, name: formations.name }).from(formations),
    insert: async (row) => {
      await db.db.insert(formations).values({ id: row.id, name: row.name, shortName: text(row['ShortFormation'], 20) });
    },
  });

export const strengthsLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'strengths',
    entity: 'strength',
    max: 60,
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Value] AS [Name] FROM [Pharmacy].[Strengths]',
    existing: () => db.db.select({ id: strengths.id, name: strengths.name }).from(strengths),
    insert: async (row) => {
      await db.db.insert(strengths).values({ id: row.id, name: row.name });
    },
  });

export const manufacturersLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'manufacturers',
    entity: 'manufacturer',
    max: 150,
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name] FROM [Pharmacy].[Manufacturers]',
    existing: () => db.db.select({ id: manufacturers.id, name: manufacturers.name }).from(manufacturers),
    insert: async (row) => {
      await db.db.insert(manufacturers).values({ id: row.id, name: row.name });
    },
  });

export const brandsLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'brands',
    entity: 'brand',
    dependsOn: { loader: 'manufacturers', entity: 'manufacturer' },
    perParent: true,
    max: 150,
    query: `SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], CAST([ManufacturerId] AS nvarchar(36)) AS [Parent]
      FROM [Pharmacy].[BrandNames]`,
    existing: () => db.db.select({ id: brands.id, name: brands.name, parentId: brands.manufacturerId }).from(brands),
    insert: async (row) => {
      await db.db.insert(brands).values({ id: row.id, name: row.name, manufacturerId: row.parentId! });
    },
  });

/** A unit master by name (the old products wrote units as free text), made when new. */
async function unitIds(db: DbContext, table: typeof units): Promise<(name: unknown) => Promise<string | null>> {
  const known = new Map(
    (await db.db.select({ id: table.id, name: table.name }).from(table)).map((row) => [row.name.toUpperCase(), row.id]),
  );
  return async (value) => {
    const name = text(value, 30);
    if (!name) return null;
    let id = known.get(name.toUpperCase());
    if (!id) {
      id = randomUUID();
      await db.db.insert(table).values({ id, name });
      known.set(name.toUpperCase(), id);
    }
    return id;
  };
}

/**
 * Old Pharmacy.BrandExtensions → pharmacy_products: brand, generic, formation and strength; the free-text unit and
 * pack unit become unit masters. A second old product of the same brand, formation and strength is the same product
 * here; a barcode another product has is left out.
 */
export function productsLoader(db: DbContext): Loader {
  return {
    name: 'products',
    dependsOn: ['brands', 'generics', 'formations', 'strengths'],
    async run(context, report) {
      const unitOf = await unitIds(db, units);
      const packOf = await unitIds(db, packageUnits);
      const existing = await db.db
        .select({
          id: products.id,
          brandId: products.brandId,
          formationId: products.formationId,
          strengthId: products.strengthId,
          barcode: products.barcode,
        })
        .from(products);
      const key = (brandId: string, formationId: string, strengthId: string | null) =>
        `${brandId}|${formationId}|${strengthId ?? ''}`;
      const byKey = new Map(existing.map((row) => [key(row.brandId, row.formationId, row.strengthId), row.id]));
      const barcodes = new Set(existing.flatMap((row) => (row.barcode ? [row.barcode] : [])));
      const query = `SELECT TOP (@n) CAST([Id] AS nvarchar(36)) AS [Id], [BarCode], CAST([BrandId] AS nvarchar(36)) AS [BrandId],
        CAST([GenericId] AS nvarchar(36)) AS [GenericId], CAST([FormationId] AS nvarchar(36)) AS [FormationId],
        CAST([StrengthId] AS nvarchar(36)) AS [StrengthId], [Unit], [PurchasePrice], [SalePrice], [PkgUnit], [QtyPerBox],
        [IsActive], [IsDeleted]
        FROM [Pharmacy].[BrandExtensions] t WHERE t.[Id] > @after ORDER BY t.[Id]`;
      type Row = {
        Id: string;
        BarCode: string | null;
        BrandId: string;
        GenericId: string;
        FormationId: string;
        StrengthId: string | null;
        Unit: string | null;
        PurchasePrice: number | null;
        SalePrice: number | null;
        PkgUnit: string | null;
        QtyPerBox: number | null;
        IsActive: boolean | null;
        IsDeleted: boolean | null;
      };
      for await (const page of pages<Row>(context, query, (row) => row.Id)) {
        for (const row of page) {
          if (!(await isNew(context, report, 'product', row.Id))) continue;
          const brandId = await context.ids.get('brand', row.BrandId);
          const genericId = await context.ids.get('generic', row.GenericId);
          const formationId = await context.ids.get('formation', row.FormationId);
          if (!brandId || !genericId || !formationId) {
            noteRejection(
              report,
              row.Id,
              !brandId ? 'brand_not_brought' : !genericId ? 'generic_not_brought' : 'formation_not_brought',
            );
            continue;
          }
          const strengthId =
            row.StrengthId && row.StrengthId !== NIL ? await context.ids.get('strength', row.StrengthId) : null;
          let id = byKey.get(key(brandId, formationId, strengthId));
          if (id) {
            report.notes.push(`${row.Id}: the same brand, formation and strength as another product; merged`);
          } else {
            let barcode = text(row.BarCode, 64);
            if (barcode && barcodes.has(barcode)) {
              report.notes.push(`${row.Id}: barcode ${barcode} is another product's; left out`);
              barcode = null;
            }
            id = randomUUID();
            await db.db.insert(products).values({
              id,
              brandId,
              genericId,
              formationId,
              strengthId,
              unitId: await unitOf(row.Unit),
              packageUnitId: await packOf(row.PkgUnit),
              unitsPerPack: Math.min(10_000, Math.max(1, Math.round(Number(row.QtyPerBox ?? 1)) || 1)),
              purchasePrice: money(row.PurchasePrice),
              salePrice: money(row.SalePrice),
              barcode,
              isActive: row.IsActive !== false && row.IsDeleted !== true,
            });
            byKey.set(key(brandId, formationId, strengthId), id);
            if (barcode) barcodes.add(barcode);
            report.written += 1;
          }
          await context.ids.set('product', row.Id, id);
        }
      }
    },
  };
}

export function outletsLoader(db: DbContext): Loader {
  return {
    name: 'outlets',
    dependsOn: [],
    async run(context, report) {
      const existing = await db.db.select({ id: outlets.id, name: outlets.name, code: outlets.code }).from(outlets);
      const byName = new Map(existing.map((row) => [row.name.toUpperCase(), row.id]));
      const codes = new Set(existing.flatMap((row) => (row.code ? [row.code.toUpperCase()] : [])));
      const rows = await context.source.query<{
        Id: string;
        Name: string | null;
        Description: string | null;
        CodeNo: string | null;
      }>(
        'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], [Description], [CodeNo] FROM [Pharmacy].[MedicineOutlets]',
      );
      for (const row of rows) {
        if (!(await isNew(context, report, 'outlet', row.Id))) continue;
        const name = text(row.Name, 100);
        if (!name) {
          noteRejection(report, row.Id, 'no_name');
          continue;
        }
        let id = byName.get(name.toUpperCase());
        if (!id) {
          const code = text(row.CodeNo, 20);
          id = randomUUID();
          await db.db.insert(outlets).values({
            id,
            name,
            code: code && !codes.has(code.toUpperCase()) ? code : null,
            description: text(row.Description, 500),
          });
          byName.set(name.toUpperCase(), id);
          if (code) codes.add(code.toUpperCase());
          report.written += 1;
        }
        await context.ids.set('outlet', row.Id, id);
      }
      report.notes.push('Give pharmacists their outlets: duty outlets are not brought over');
    },
  };
}

// ---- Supply chain catalogue, stores and suppliers (old SupplyChain.*)

export const mainStoresLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'main-stores',
    entity: 'main-store',
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], [Description] FROM [SupplyChain].[MainStores]',
    existing: () => db.db.select({ id: mainStores.id, name: mainStores.name }).from(mainStores),
    insert: async (row) => {
      await db.db.insert(mainStores).values({ id: row.id, name: row.name, description: text(row['Description'], 500) });
    },
  });

export const subStoresLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'sub-stores',
    entity: 'sub-store',
    dependsOn: { loader: 'main-stores', entity: 'main-store' },
    query: `SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], [Description], CAST([MainStoreId] AS nvarchar(36)) AS [Parent]
      FROM [SupplyChain].[Stores]`,
    existing: () => db.db.select({ id: subStores.id, name: subStores.name }).from(subStores),
    insert: async (row) => {
      await db.db.insert(subStores).values({
        id: row.id,
        name: row.name,
        mainStoreId: row.parentId!,
        description: text(row['Description'], 500),
      });
    },
  });

export const storeDepartmentsLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'store-departments',
    entity: 'store-department',
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name] FROM [SupplyChain].[StoreDepts]',
    existing: () => db.db.select({ id: storeDepartments.id, name: storeDepartments.name }).from(storeDepartments),
    insert: async (row) => {
      await db.db.insert(storeDepartments).values({ id: row.id, name: row.name });
    },
  });

export const itemCategoriesLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'item-categories',
    entity: 'item-category',
    max: 150,
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name] FROM [SupplyChain].[ParentCategories]',
    existing: () => db.db.select({ id: itemCategories.id, name: itemCategories.name }).from(itemCategories),
    insert: async (row) => {
      await db.db.insert(itemCategories).values({ id: row.id, name: row.name });
    },
  });

export const itemSubCategoriesLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'item-sub-categories',
    entity: 'item-sub-category',
    dependsOn: { loader: 'item-categories', entity: 'item-category' },
    perParent: true,
    max: 150,
    query: `SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], CAST([ParentCategoryId] AS nvarchar(36)) AS [Parent]
      FROM [SupplyChain].[SubCategories]`,
    existing: () =>
      db.db
        .select({ id: itemSubCategories.id, name: itemSubCategories.name, parentId: itemSubCategories.categoryId })
        .from(itemSubCategories),
    insert: async (row) => {
      await db.db.insert(itemSubCategories).values({ id: row.id, name: row.name, categoryId: row.parentId! });
    },
  });

export const itemGroupsLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'item-groups',
    entity: 'item-group',
    max: 150,
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name] FROM [SupplyChain].[Groups]',
    existing: () => db.db.select({ id: itemGroups.id, name: itemGroups.name }).from(itemGroups),
    insert: async (row) => {
      await db.db.insert(itemGroups).values({ id: row.id, name: row.name });
    },
  });

export const itemSubGroupsLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'item-sub-groups',
    entity: 'item-sub-group',
    dependsOn: { loader: 'item-groups', entity: 'item-group' },
    perParent: true,
    max: 150,
    query: `SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], CAST([GroupId] AS nvarchar(36)) AS [Parent]
      FROM [SupplyChain].[SubGroups]`,
    existing: () =>
      db.db
        .select({ id: itemSubGroups.id, name: itemSubGroups.name, parentId: itemSubGroups.groupId })
        .from(itemSubGroups),
    insert: async (row) => {
      await db.db.insert(itemSubGroups).values({ id: row.id, name: row.name, groupId: row.parentId! });
    },
  });

/**
 * Old SupplyChain.BrandNames → items, under their sub-group and sub-category. The old item type was the inventory
 * account (13b brings it): reusable and fixed-asset types make asset items.
 */
export function itemsLoader(db: DbContext): Loader {
  return {
    name: 'items',
    dependsOn: ['item-sub-groups', 'item-sub-categories', 'gl-accounts'],
    async run(context, report) {
      let generalId: string | null = null;
      let generalCount = 0;
      /** The "General" sub-category of the "General" category, made once, for items whose old one is gone. */
      const general = async (): Promise<string> => {
        generalCount += 1;
        if (generalId) return generalId;
        let [category] = await db.db
          .select({ id: itemCategories.id })
          .from(itemCategories)
          .where(sql`upper(${itemCategories.name}) = ${GENERAL.toUpperCase()}`);
        if (!category) {
          category = { id: randomUUID() };
          await db.db.insert(itemCategories).values({ id: category.id, name: GENERAL });
        }
        const [found] = await db.db
          .select({ id: itemSubCategories.id })
          .from(itemSubCategories)
          .where(
            and(
              eq(itemSubCategories.categoryId, category.id),
              sql`upper(${itemSubCategories.name}) = ${GENERAL.toUpperCase()}`,
            ),
          );
        generalId = found?.id ?? randomUUID();
        if (!found)
          await db.db.insert(itemSubCategories).values({ id: generalId, categoryId: category.id, name: GENERAL });
        return generalId;
      };
      const existing = new Map(
        (await db.db.select({ id: items.id, name: items.name, subGroupId: items.subGroupId }).from(items)).map(
          (row) => [`${row.subGroupId}|${row.name.toUpperCase()}`, row.id],
        ),
      );
      const accountNames = new Map(
        (await db.db.select({ id: glAccounts.id, name: glAccounts.name }).from(glAccounts)).map((row) => [
          row.id,
          row.name,
        ]),
      );
      const rows = await context.source.query<{
        Id: string;
        Name: string | null;
        SubGroupId: string;
        SubCategoryId: string;
        Unit: string | null;
        ItemTypeId: string | null;
        IsDeleted: boolean | null;
      }>(
        `SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], CAST([SubGroupId] AS nvarchar(36)) AS [SubGroupId],
          CAST([SubCategoryId] AS nvarchar(36)) AS [SubCategoryId], [Unit], CAST([ItemTypeId] AS nvarchar(36)) AS [ItemTypeId],
          [IsDeleted] FROM [SupplyChain].[BrandNames]`,
      );
      for (const row of rows) {
        if (!(await isNew(context, report, 'item', row.Id))) continue;
        const subGroupId = await context.ids.get('item-sub-group', row.SubGroupId);
        // The old sub-categories were often unset or gone: such an item goes under "General".
        const subCategoryId = (await context.ids.get('item-sub-category', row.SubCategoryId)) ?? (await general());
        if (!subGroupId) {
          noteRejection(report, row.Id, 'sub_group_not_brought');
          continue;
        }
        const name = text(row.Name, 200);
        if (!name) {
          noteRejection(report, row.Id, 'no_name');
          continue;
        }
        let id = existing.get(`${subGroupId}|${name.toUpperCase()}`);
        if (!id) {
          const typeGlAccountId =
            row.ItemTypeId && row.ItemTypeId !== NIL ? await context.ids.get('gl-account', row.ItemTypeId) : null;
          id = randomUUID();
          await db.db.insert(items).values({
            id,
            name,
            subGroupId,
            subCategoryId,
            unit: text(row.Unit, 30) ?? 'pcs',
            typeGlAccountId,
            isAsset: isAssetType(typeGlAccountId ? accountNames.get(typeGlAccountId) : null),
            isActive: row.IsDeleted !== true,
          });
          existing.set(`${subGroupId}|${name.toUpperCase()}`, id);
          report.written += 1;
        }
        await context.ids.set('item', row.Id, id);
      }
      if (generalCount)
        report.notes.push(generalCount + ' item(s) whose old sub-category is gone went under ' + GENERAL);
    },
  };
}

/** Old SupplyChain.BrandExtensions → item_variants (the opening quantity is part of the opening stock). */
export function itemVariantsLoader(db: DbContext): Loader {
  return {
    name: 'item-variants',
    dependsOn: ['items'],
    async run(context, report) {
      const existing = await db.db
        .select({ id: itemVariants.id, itemId: itemVariants.itemId, name: itemVariants.name, code: itemVariants.code })
        .from(itemVariants);
      const byName = new Map(existing.map((row) => [`${row.itemId}|${row.name.toUpperCase()}`, row.id]));
      const codes = new Set(existing.flatMap((row) => (row.code ? [row.code.toUpperCase()] : [])));
      const query = `SELECT TOP (@n) CAST([Id] AS nvarchar(36)) AS [Id], CAST([BrandId] AS nvarchar(36)) AS [BrandId], [Name],
        [PurchasePrice], [SalePrice], [ROL], [CodeOrPartNo], [IsExpireDateRequired], [AlternateName], [SpecSizeOrColor],
        [IsDeleted] FROM [SupplyChain].[BrandExtensions] t WHERE t.[Id] > @after ORDER BY t.[Id]`;
      type Row = {
        Id: string;
        BrandId: string;
        Name: string | null;
        PurchasePrice: number | null;
        SalePrice: number | null;
        ROL: number | null;
        CodeOrPartNo: string | null;
        IsExpireDateRequired: boolean | null;
        AlternateName: string | null;
        SpecSizeOrColor: string | null;
        IsDeleted: boolean | null;
      };
      for await (const page of pages<Row>(context, query, (row) => row.Id)) {
        for (const row of page) {
          if (!(await isNew(context, report, 'item-variant', row.Id))) continue;
          const itemId = await context.ids.get('item', row.BrandId);
          if (!itemId) {
            noteRejection(report, row.Id, 'item_not_brought');
            continue;
          }
          const name = text(row.Name, 200);
          if (!name) {
            noteRejection(report, row.Id, 'no_name');
            continue;
          }
          let id = byName.get(`${itemId}|${name.toUpperCase()}`);
          if (!id) {
            let code = text(row.CodeOrPartNo, 50);
            if (code && codes.has(code.toUpperCase())) {
              report.notes.push(`${name}: code ${code} is another variant's; left out`);
              code = null;
            }
            id = randomUUID();
            await db.db.insert(itemVariants).values({
              id,
              itemId,
              name,
              code,
              alternateName: text(row.AlternateName, 200),
              specification: text(row.SpecSizeOrColor, 300),
              purchasePrice: money(row.PurchasePrice),
              salePrice: money(row.SalePrice),
              reorderLevel: Math.max(0, Math.round(Number(row.ROL ?? 0))),
              expiryRequired: row.IsExpireDateRequired === true,
              isActive: row.IsDeleted !== true,
            });
            byName.set(`${itemId}|${name.toUpperCase()}`, id);
            if (code) codes.add(code.toUpperCase());
            report.written += 1;
          }
          await context.ids.set('item-variant', row.Id, id);
        }
      }
    },
  };
}

export const supplierTypesLoader = (db: DbContext) =>
  namedLoader(db, {
    name: 'supplier-types',
    entity: 'supplier-type',
    query: 'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name] FROM [SupplyChain].[SupplierTypes]',
    existing: () => db.db.select({ id: supplierTypes.id, name: supplierTypes.name }).from(supplierTypes),
    insert: async (row) => {
      await db.db.insert(supplierTypes).values({ id: row.id, name: row.name });
    },
  });

/**
 * Old SupplyChain.Suppliers → suppliers, with their payable account (old GLId) and the sub-ledger the old books kept
 * for them (old SubLedgers.SupplierId), both brought over in 13b.
 */
export function suppliersLoader(db: DbContext): Loader {
  return {
    name: 'suppliers',
    dependsOn: ['supplier-types', 'gl-accounts', 'sub-ledgers'],
    async run(context, report) {
      const existing = await db.db
        .select({ id: suppliers.id, name: suppliers.name, subLedgerId: suppliers.subLedgerId })
        .from(suppliers);
      const byName = new Map(existing.map((row) => [row.name.toUpperCase(), row.id]));
      const usedLedgers = new Set(existing.flatMap((row) => (row.subLedgerId ? [row.subLedgerId] : [])));
      const ledgers = new Map<string, string>();
      for (const row of await context.source.query<{ Id: string; SupplierId: string }>(
        `SELECT CAST([Id] AS nvarchar(36)) AS [Id], CAST([SupplierId] AS nvarchar(36)) AS [SupplierId]
          FROM [Account].[SubLedgers] WHERE [SupplierId] <> @nil AND [IsDeleted] = 0`,
        { nil: NIL },
      )) {
        const subLedgerId = await context.ids.get('sub-ledger', row.Id);
        if (subLedgerId && !ledgers.has(row.SupplierId.toLowerCase()))
          ledgers.set(row.SupplierId.toLowerCase(), subLedgerId);
      }
      const rows = await context.source.query<{
        Id: string;
        TypeId: string;
        Name: string | null;
        Address: string | null;
        ContactNo: string | null;
        IsEnlisted: boolean | null;
        EnlistmentDate: Date | null;
        ExpireDate: Date | null;
        VatInPercent: number | null;
        TaxInPercent: number | null;
        IsManufacturer: boolean | null;
        GLId: string | null;
        IsDeleted: boolean | null;
      }>(
        `SELECT CAST([Id] AS nvarchar(36)) AS [Id], CAST([TypeId] AS nvarchar(36)) AS [TypeId], [Name], [Address], [ContactNo],
          [IsEnlisted], [EnlistmentDate], [ExpireDate], [VatInPercent], [TaxInPercent], [IsManufacturer],
          CAST([GLId] AS nvarchar(36)) AS [GLId], [IsDeleted] FROM [SupplyChain].[Suppliers]`,
      );
      for (const row of rows) {
        if (!(await isNew(context, report, 'supplier', row.Id))) continue;
        const typeId = await context.ids.get('supplier-type', row.TypeId);
        const name = text(row.Name, 200);
        if (!typeId || !name) {
          noteRejection(report, row.Id, typeId ? 'no_name' : 'type_not_brought');
          continue;
        }
        let id = byName.get(name.toUpperCase());
        if (!id) {
          let subLedgerId = ledgers.get(row.Id.toLowerCase()) ?? null;
          if (subLedgerId && usedLedgers.has(subLedgerId)) subLedgerId = null;
          const enlistedOn = realDay(row.EnlistmentDate);
          const expires = realDay(row.ExpireDate);
          id = randomUUID();
          await db.db.insert(suppliers).values({
            id,
            typeId,
            name,
            address: text(row.Address, 300),
            contactNo: text(row.ContactNo, 50),
            isEnlisted: row.IsEnlisted === true,
            enlistedOn,
            enlistmentExpiresOn: expires && (!enlistedOn || expires >= enlistedOn) ? expires : null,
            vatPercent: percent(row.VatInPercent),
            taxPercent: percent(row.TaxInPercent),
            isManufacturer: row.IsManufacturer === true,
            glAccountId: row.GLId && row.GLId !== NIL ? await context.ids.get('gl-account', row.GLId) : null,
            subLedgerId,
            isActive: row.IsDeleted !== true,
          });
          byName.set(name.toUpperCase(), id);
          if (subLedgerId) usedLedgers.add(subLedgerId);
          else report.notes.push(`${name}: no sub-ledger in the old books`);
          report.written += 1;
        }
        await context.ids.set('supplier', row.Id, id);
      }
    },
  };
}

// ---- Opening stock at the cut-over

/** Balances (debit positive) of accounts in this system's books up to a day. */
async function balances(db: DbContext, accountIds: readonly string[], on: string): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();
  const rows = await db.db
    .select({
      glAccountId: voucherLines.glAccountId,
      net: sql<number>`coalesce(sum(${voucherLines.debit} - ${voucherLines.credit}), 0)`.mapWith(Number),
    })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .where(
      and(
        inArray(voucherLines.glAccountId, [...accountIds]),
        lte(vouchers.voucherDate, on),
        sql`${vouchers.status} <> 'draft'`,
      ),
    )
    .groupBy(voucherLines.glAccountId);
  return new Map(rows.map((row) => [row.glAccountId, row.net]));
}

/** Notes how the stock's value compares with its inventory account in the books (13b), account by account. */
async function compareWithBooks(
  db: DbContext,
  report: LoaderReport,
  values: Map<string | null, number>,
  on: string,
): Promise<void> {
  const accounts = [...values.keys()].filter((id): id is string => id !== null);
  const books = await balances(db, accounts, on);
  const names = new Map(
    accounts.length
      ? (
          await db.db
            .select({ id: glAccounts.id, code: glAccounts.code })
            .from(glAccounts)
            .where(inArray(glAccounts.id, accounts))
        ).map((row) => [row.id, row.code])
      : [],
  );
  for (const [account, value] of values) {
    const stock = Math.round(value * 100) / 100;
    if (account === null) {
      report.notes.push(`Stock worth ${stock.toFixed(2)} has no inventory account to compare with`);
      continue;
    }
    const book = Math.round((books.get(account) ?? 0) * 100) / 100;
    const difference = Math.round((stock - book) * 100) / 100;
    report.notes.push(
      difference === 0
        ? `Stock worth ${stock.toFixed(2)} equals account ${names.get(account)} in the books`
        : `Stock worth ${stock.toFixed(2)}; account ${names.get(account)} says ${book.toFixed(2)} (difference ${difference.toFixed(2)})`,
    );
  }
}

async function nextNumber(
  db: DbContext,
  table: typeof pharmacySequences | typeof scmSequences,
  kind: string,
  on: string,
): Promise<string> {
  const year = Number(on.slice(0, 4));
  const [row] = await db.db
    .insert(table)
    .values({ kind, year, last: 1 })
    .onConflictDoUpdate({ target: [table.kind, table.year], set: { last: sql`${table.last} + 1` } })
    .returning({ last: table.last });
  return documentNumber(kind, year, row!.last);
}

function needsCutOver(context: EtlContext, report: LoaderReport): string | null {
  if (!context.cutOver) report.notes.push('No --cut-over day given: opening stock was not brought over');
  return context.cutOver;
}

/**
 * Old Pharmacy.Stocks (each outlet's stock by product and lot, as the old system holds it once frozen) → one opening
 * stock entry per outlet dated the day before the cut-over, at each lot's purchase rate. Expired lots are left out;
 * stock below zero (the old rows sometimes were) holds nothing. The value is compared with the pharmacy inventory
 * account.
 */
export function pharmacyOpeningStockLoader(db: DbContext): Loader {
  return {
    name: 'pharmacy-opening-stock',
    dependsOn: ['products', 'outlets', 'opening-balances'],
    async run(context, report) {
      const cutOver = needsCutOver(context, report);
      if (!cutOver) return;
      const on = dayBefore(cutOver);
      const rows = await context.source.query<{
        ProductId: string;
        OutletId: string;
        LotId: string | null;
        AvailableStock: number;
        PurchaseRate: number | null;
        SaleRate: number | null;
        BatchNo: string | null;
        ExpireDate: Date | string | null;
      }>(
        `SELECT CAST([ProductId] AS nvarchar(36)) AS [ProductId], CAST([OutletId] AS nvarchar(36)) AS [OutletId],
          CAST([LotId] AS nvarchar(36)) AS [LotId], [AvailableStock], [PurchaseRate], [SaleRate], [BatchNo], [ExpireDate]
          FROM [Pharmacy].[Stocks] WHERE [IsDeleted] = 0 AND [AvailableStock] <> 0`,
      );
      const byOutlet = new Map<string, Map<string, typeof rows>>();
      for (const row of rows) {
        const outlet = byOutlet.get(row.OutletId.toLowerCase()) ?? new Map<string, typeof rows>();
        outlet.set(row.ProductId.toLowerCase(), [...(outlet.get(row.ProductId.toLowerCase()) ?? []), row]);
        byOutlet.set(row.OutletId.toLowerCase(), outlet);
      }
      const [role] = await db.db.select().from(glRoles).where(eq(glRoles.role, 'pharmacy_inventory'));
      let value = 0;
      const left = { expired: 0, expiredValue: 0, short: 0, unreadable: 0, fractions: 0 };
      for (const [outletOld, productsAt] of byOutlet) {
        const key = `${outletOld}:${cutOver}`;
        if (!(await isNew(context, report, 'pharmacy-opening', key))) continue;
        const outletId = await context.ids.get('outlet', outletOld);
        if (!outletId) {
          noteRejection(report, outletOld, 'outlet_not_brought');
          continue;
        }
        const movements: (typeof pharmacyMovements.$inferInsert)[] = [];
        let missing = 0;
        for (const [productOld, stock] of productsAt) {
          const productId = await context.ids.get('product', productOld);
          if (!productId) {
            missing += 1;
            continue;
          }
          const { lots, short } = allocate(
            stock.map((row) => ({ lot: row, qty: Number(row.AvailableStock), expiry: expiryDay(row.ExpireDate) })),
            3,
          );
          if (short) left.short += 1;
          for (const { lot, qty, expiry } of lots) {
            const cost = money(lot.PurchaseRate);
            if (!expiry) {
              left.unreadable += 1;
              continue;
            }
            if (expiry < cutOver) {
              left.expired += 1;
              left.expiredValue += qty * cost;
              continue;
            }
            const units = Math.round(qty);
            if (units !== qty) left.fractions += 1;
            if (units <= 0) continue;
            const batchNo = text(lot.BatchNo, 50);
            const saleRate = money(lot.SaleRate);
            await db.db
              .insert(pharmacyLots)
              .values({ id: randomUUID(), productId, batchNo, expiryDate: expiry, saleRate })
              .onConflictDoNothing();
            const [found] = await db.db
              .select({ id: pharmacyLots.id })
              .from(pharmacyLots)
              .where(
                and(
                  eq(pharmacyLots.productId, productId),
                  sql`coalesce(upper(${pharmacyLots.batchNo}), '') = ${batchNo?.toUpperCase() ?? ''}`,
                  eq(pharmacyLots.expiryDate, expiry),
                  eq(pharmacyLots.saleRate, saleRate),
                ),
              );
            movements.push({
              id: randomUUID(),
              outletId,
              productId,
              lotId: found!.id,
              qty: units,
              unitCost: cost,
              movedOn: on,
              kind: 'opening',
              documentId: '',
              documentNumber: '',
            });
            value += units * cost;
          }
        }
        if (missing) report.notes.push(`${missing} product(s) with stock at outlet ${outletOld} were not brought over`);
        if (movements.length === 0) continue;
        const id = randomUUID();
        const number = await nextNumber(db, pharmacySequences, 'OP', on);
        await db.db.insert(pharmacyOpenings).values({
          id,
          number,
          outletId,
          openedOn: on,
          note: `Stock in the old system when it was frozen for the cut-over on ${cutOver}`,
        });
        for (let start = 0; start < movements.length; start += 1000) {
          await db.db
            .insert(pharmacyMovements)
            .values(
              movements
                .slice(start, start + 1000)
                .map((movement) => ({ ...movement, documentId: id, documentNumber: number })),
            );
        }
        await context.ids.set('pharmacy-opening', key, id);
        report.written += 1;
        report.notes.push(`${number}: ${movements.length} lines`);
      }
      if (left.expired)
        report.notes.push(`${left.expired} expired lot(s) worth ${left.expiredValue.toFixed(2)} left out`);
      if (left.short) report.notes.push(`${left.short} product(s) were below zero in the old stock and hold nothing`);
      if (left.unreadable) report.notes.push(`${left.unreadable} lot(s) without a readable expiry left out`);
      if (left.fractions) report.notes.push(`${left.fractions} lot(s) held part of a unit; rounded to whole units`);
      if (report.written) await compareWithBooks(db, report, new Map([[role?.glAccountId ?? null, value]]), on);
    },
  };
}

/**
 * Each main and sub-store's stock by item variant and lot, as the old system's own current-stock procedure reports it
 * (SpGetBrandExtensionCurrentStockBySubStore, which takes a main or sub-store), → one opening stock entry per store
 * dated the day before the cut-over, at the variant's last receive rate (or its purchase price). Asset items, expired
 * lots and stock below zero are left out. Values are compared with each item type's inventory account.
 */
export function storeOpeningStockLoader(db: DbContext): Loader {
  return {
    name: 'store-opening-stock',
    dependsOn: ['item-variants', 'sub-stores', 'opening-balances'],
    async run(context, report) {
      const cutOver = needsCutOver(context, report);
      if (!cutOver) return;
      const on = dayBefore(cutOver);
      const lots = new Map(
        (
          await context.source.query<{ Id: string; BatchNo: string | null; ExpireDate: string | null }>(
            'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [BatchNo], [ExpireDate] FROM [SupplyChain].[LotRecords]',
          )
        ).map((row) => [row.Id.toLowerCase(), row]),
      );
      const lastRates = new Map(
        (
          await context.source.query<{ BrandExtensionId: string; PurchaseRate: number }>(
            `SELECT [BrandExtensionId], [PurchaseRate] FROM (
               SELECT CAST(d.[BrandExtensionId] AS nvarchar(36)) AS [BrandExtensionId], d.[PurchaseRate],
                 ROW_NUMBER() OVER (PARTITION BY d.[BrandExtensionId] ORDER BY d.[CreatedOn] DESC) AS [n]
               FROM [SupplyChain].[StockReceiveDetails] d WHERE d.[IsDeleted] = 0 AND d.[PurchaseRate] > 0) r
             WHERE r.[n] = 1`,
          )
        ).map((row) => [row.BrandExtensionId.toLowerCase(), money(row.PurchaseRate)]),
      );
      const variants = new Map(
        (
          await db.db
            .select({
              id: itemVariants.id,
              price: itemVariants.purchasePrice,
              expiryRequired: itemVariants.expiryRequired,
              isAsset: items.isAsset,
              account: items.typeGlAccountId,
            })
            .from(itemVariants)
            .innerJoin(items, eq(items.id, itemVariants.itemId))
        ).map((row) => [row.id, row]),
      );
      const stores = [
        ...(
          await context.source.query<{ Id: string }>(
            'SELECT CAST([Id] AS nvarchar(36)) AS [Id] FROM [SupplyChain].[MainStores] WHERE [IsDeleted] = 0',
          )
        ).map((row) => ({ old: row.Id, kind: 'main' as const })),
        ...(
          await context.source.query<{ Id: string }>(
            'SELECT CAST([Id] AS nvarchar(36)) AS [Id] FROM [SupplyChain].[Stores] WHERE [IsDeleted] = 0',
          )
        ).map((row) => ({ old: row.Id, kind: 'sub' as const })),
      ];
      if (stores.filter((store) => store.kind === 'main').length > 1) {
        report.notes.push(
          'Several main stores: the old procedure counts the variants’ opening quantities at each; check them',
        );
      }
      const values = new Map<string | null, number>();
      const left = { assets: 0, expired: 0, short: 0, missing: 0 };
      for (const store of stores) {
        const key = `${store.old.toLowerCase()}:${cutOver}`;
        if (!(await isNew(context, report, 'store-opening', key))) continue;
        const storeId = await context.ids.get(store.kind === 'main' ? 'main-store' : 'sub-store', store.old);
        if (!storeId) {
          noteRejection(report, store.old, 'store_not_brought');
          continue;
        }
        const rows = await context.source.query<{
          Id: string;
          LotRecordId: string | null;
          CurStock: number | null;
          PurchasePrice: number | null;
        }>(
          `EXEC [SupplyChain].[SpGetBrandExtensionCurrentStockBySubStore] @Id = @nil, @RoleId = @nil, @StoreId = @store`,
          { nil: NIL, store: store.old },
        );
        const byVariant = new Map<string, typeof rows>();
        for (const row of rows) {
          if (!Number(row.CurStock)) continue;
          const id = String(row.Id).toLowerCase();
          byVariant.set(id, [...(byVariant.get(id) ?? []), row]);
        }
        const movements: (typeof stockMovements.$inferInsert)[] = [];
        for (const [variantOld, stock] of byVariant) {
          const variantId = await context.ids.get('item-variant', variantOld);
          const variant = variantId ? variants.get(variantId) : undefined;
          if (!variantId || !variant) {
            left.missing += 1;
            continue;
          }
          if (variant.isAsset) {
            left.assets += 1;
            continue;
          }
          const lotOf = (row: (typeof rows)[number]) =>
            row.LotRecordId && row.LotRecordId !== NIL ? lots.get(String(row.LotRecordId).toLowerCase()) : undefined;
          const { lots: held, short } = allocate(
            stock.map((row) => ({ lot: row, qty: Number(row.CurStock), expiry: expiryDay(lotOf(row)?.ExpireDate) })),
            3,
          );
          if (short) left.short += 1;
          const cost = lastRates.get(variantOld) || money(stock[0]!.PurchasePrice) || variant.price;
          for (const { lot, qty, expiry } of held) {
            if (expiry && expiry < cutOver) {
              left.expired += 1;
              continue;
            }
            const batchNo = text(lotOf(lot)?.BatchNo, 50);
            await db.db
              .insert(stockLots)
              .values({ id: randomUUID(), variantId, batchNo, expiryDate: expiry })
              .onConflictDoNothing();
            const [found] = await db.db
              .select({ id: stockLots.id })
              .from(stockLots)
              .where(
                and(
                  eq(stockLots.variantId, variantId),
                  sql`coalesce(upper(${stockLots.batchNo}), '') = ${batchNo?.toUpperCase() ?? ''}`,
                  sql`coalesce(${stockLots.expiryDate}, '9999-12-31'::date) = ${expiry ?? '9999-12-31'}::date`,
                ),
              );
            movements.push({
              id: randomUUID(),
              mainStoreId: store.kind === 'main' ? storeId : null,
              subStoreId: store.kind === 'sub' ? storeId : null,
              variantId,
              lotId: found!.id,
              qty,
              unitCost: cost,
              movedOn: on,
              kind: 'opening',
              documentId: '',
              documentNumber: '',
            });
            values.set(variant.account, (values.get(variant.account) ?? 0) + qty * cost);
          }
        }
        if (movements.length === 0) continue;
        const id = randomUUID();
        const number = await nextNumber(db, scmSequences, 'OS', on);
        await db.db.insert(stockOpenings).values({
          id,
          number,
          mainStoreId: store.kind === 'main' ? storeId : null,
          subStoreId: store.kind === 'sub' ? storeId : null,
          openedOn: on,
          note: `Stock in the old system when it was frozen for the cut-over on ${cutOver}`,
        });
        for (let start = 0; start < movements.length; start += 1000) {
          await db.db
            .insert(stockMovements)
            .values(
              movements
                .slice(start, start + 1000)
                .map((movement) => ({ ...movement, documentId: id, documentNumber: number })),
            );
        }
        await context.ids.set('store-opening', key, id);
        report.written += 1;
        report.notes.push(`${number}: ${movements.length} lines`);
      }
      if (left.assets) report.notes.push(`${left.assets} asset item(s) with stock left out: register them as assets`);
      if (left.expired) report.notes.push(`${left.expired} expired lot(s) left out`);
      if (left.short) report.notes.push(`${left.short} item(s) were below zero in the old stock and hold nothing`);
      if (left.missing) report.notes.push(`${left.missing} item(s) with stock were not brought over`);
      if (report.written) await compareWithBooks(db, report, values, on);
    },
  };
}

export function stockLoaders(db: DbContext): Loader[] {
  return [
    genericGroupsLoader(db),
    genericsLoader(db),
    formationsLoader(db),
    strengthsLoader(db),
    manufacturersLoader(db),
    brandsLoader(db),
    productsLoader(db),
    outletsLoader(db),
    mainStoresLoader(db),
    subStoresLoader(db),
    storeDepartmentsLoader(db),
    itemCategoriesLoader(db),
    itemSubCategoriesLoader(db),
    itemGroupsLoader(db),
    itemSubGroupsLoader(db),
    itemsLoader(db),
    itemVariantsLoader(db),
    supplierTypesLoader(db),
    suppliersLoader(db),
    pharmacyOpeningStockLoader(db),
    storeOpeningStockLoader(db),
  ];
}
