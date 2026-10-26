import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};
const nameLength = (table: string, column: SQLWrapper, max = 150) =>
  check(`${table}_name_len_ck`, sql`char_length(${column}) between 1 and ${sql.raw(String(max))}`);
/** A plain named master: unique name ignoring case. */
const named = <E extends Record<string, ReturnType<typeof text>>>(table: string, max: number, extra = {} as E) =>
  pgTable(table, { id: uuid('id').primaryKey(), name: text('name').notNull(), ...extra, ...timestamps }, (t) => [
    uniqueIndex(`${table}_name_uq`).on(sql`upper(${t.name})`),
    nameLength(table, t.name, max),
  ]);

// Old Pharmacy.Groups: therapeutic groups of generics (antibiotic, antacid…).
export const genericGroups = named('pharmacy_generic_groups', 100, { info: text('info') });

// Old Pharmacy.Generics: the active ingredient (paracetamol), under a group.
export const generics = pgTable(
  'pharmacy_generics',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    groupId: uuid('group_id').references(() => genericGroups.id, { onDelete: 'restrict' }),
    info: text('info'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_generics_name_uq').on(sql`upper(${t.name})`),
    index('pharmacy_generics_group_idx').on(t.groupId),
    nameLength('pharmacy_generics', t.name, 200),
  ],
);

// Old Pharmacy.Formations: tablet, syrup, injection…, with the short form printed after the brand (Tab., Syp.).
export const formations = named('pharmacy_formations', 60, { shortName: text('short_name') });

// Old Pharmacy.Strengths: 500 mg, 5 mg/5 ml…
export const strengths = named('pharmacy_strengths', 60);

// Old Pharmacy.Units and PackageUnits: what one is sold by (pcs, bottle) and what it is bought in (box, strip).
export const units = named('pharmacy_units', 30);
export const packageUnits = named('pharmacy_package_units', 30);

// Old Pharmacy.Manufacturers.
export const manufacturers = named('pharmacy_manufacturers', 150);

// Old Pharmacy.BrandNames: a manufacturer's brand (Napa). The old SubCategoryId is not ported.
export const brands = pgTable(
  'pharmacy_brands',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    manufacturerId: uuid('manufacturer_id')
      .notNull()
      .references(() => manufacturers.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_brands_name_uq').on(t.manufacturerId, sql`upper(${t.name})`),
    nameLength('pharmacy_brands', t.name, 150),
  ],
);

// Old Pharmacy.BrandExtensions: what is stocked and sold — a brand in a formation and strength (Napa Tab. 500 mg),
// its generic, the unit it is sold by, the pack it is bought in and how many units a pack holds, prices and
// barcode. The old free-text Unit / PkgUnit become the unit masters; TurnOver is not ported.
export const products = pgTable(
  'pharmacy_products',
  {
    id: uuid('id').primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'restrict' }),
    genericId: uuid('generic_id')
      .notNull()
      .references(() => generics.id, { onDelete: 'restrict' }),
    formationId: uuid('formation_id')
      .notNull()
      .references(() => formations.id, { onDelete: 'restrict' }),
    strengthId: uuid('strength_id').references(() => strengths.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'restrict' }),
    packageUnitId: uuid('package_unit_id').references(() => packageUnits.id, { onDelete: 'restrict' }),
    unitsPerPack: integer('units_per_pack').notNull().default(1),
    purchasePrice: money('purchase_price').notNull().default(0),
    salePrice: money('sale_price').notNull().default(0),
    barcode: text('barcode'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_products_uq').on(
      t.brandId,
      t.formationId,
      sql`coalesce(${t.strengthId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    uniqueIndex('pharmacy_products_barcode_uq')
      .on(t.barcode)
      .where(sql`${t.barcode} is not null`),
    index('pharmacy_products_generic_idx').on(t.genericId),
    check(
      'pharmacy_products_amounts_ck',
      sql`${t.purchasePrice} >= 0 and ${t.salePrice} >= 0 and ${t.unitsPerPack} between 1 and 10000`,
    ),
    check('pharmacy_products_barcode_ck', sql`${t.barcode} is null or char_length(${t.barcode}) between 1 and 64`),
  ],
);

// Old Pharmacy.MedicineOutlets: the pharmacy counters and stores (outdoor, indoor, central store).
export const outlets = pgTable(
  'pharmacy_outlets',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    code: text('code'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_outlets_name_uq').on(sql`upper(${t.name})`),
    uniqueIndex('pharmacy_outlets_code_uq')
      .on(sql`upper(${t.code})`)
      .where(sql`${t.code} is not null`),
    nameLength('pharmacy_outlets', t.name, 100),
  ],
);

// Old Pharmacy.PharmacistDutyOutlets: who works at (sells from, receives into) an outlet.
export const outletUsers = pgTable(
  'pharmacy_outlet_users',
  {
    id: uuid('id').primaryKey(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_outlet_users_uq').on(t.outletId, t.userId),
    index('pharmacy_outlet_users_user_idx').on(t.userId),
  ],
);

// Old Pharmacy.ROLRecords (an int outlet id): the reorder level of a product at an outlet.
export const reorderLevels = pgTable(
  'pharmacy_reorder_levels',
  {
    id: uuid('id').primaryKey(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_reorder_levels_uq').on(t.outletId, t.productId),
    index('pharmacy_reorder_levels_product_idx').on(t.productId),
    check('pharmacy_reorder_levels_level_ck', sql`${t.level} between 0 and 10000000`),
  ],
);
