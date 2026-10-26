import type { PgColumn } from 'drizzle-orm/pg-core';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import {
  DrizzleRecordStore,
  type RecordStoreOptions,
  type RecordTable,
} from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { PHARMACY_MANAGE, PHARMACY_READ, PHARMACY_RECORDS as R } from '../../application/pharmacy.constants.js';
import {
  brands,
  formations,
  genericGroups,
  generics,
  manufacturers,
  outlets,
  outletUsers,
  packageUnits,
  products,
  reorderLevels,
  strengths,
  units,
} from './pharmacy.schema.js';

const fk = (table: string, column: string, referenced: string) => `${table}_${column}_${referenced}_id_fk`;
const taken = (code: string, message: string) => ({ code, message });

export function pharmacyRecordTypes(context: DbContext): RecordType[] {
  const record = (name: string, table: RecordTable, options: Omit<RecordStoreOptions, 'name'>): RecordType => ({
    name,
    readPermission: PHARMACY_READ,
    managePermission: PHARMACY_MANAGE,
    store: new DrizzleRecordStore(context, table, { name, ...options }),
  });
  /** A plain named master. */
  const named = (name: string, table: RecordTable & { name: PgColumn }, tableName: string, what: string) =>
    record(name, table, {
      orderBy: [table.name],
      search: [table.name],
      unique: { [`${tableName}_name_uq`]: taken(`${name}_name_taken`, `This ${what} exists`) },
    });

  return [
    named(R.genericGroup, genericGroups, 'pharmacy_generic_groups', 'generic group'),
    record(R.generic, generics, {
      orderBy: [generics.name],
      filters: { groupId: generics.groupId },
      search: [generics.name],
      unique: { pharmacy_generics_name_uq: taken('generic_name_taken', 'This generic exists') },
      references: { [fk('pharmacy_generics', 'group_id', 'pharmacy_generic_groups')]: R.genericGroup },
    }),
    named(R.formation, formations, 'pharmacy_formations', 'formation'),
    named(R.strength, strengths, 'pharmacy_strengths', 'strength'),
    named(R.unit, units, 'pharmacy_units', 'unit'),
    named(R.packageUnit, packageUnits, 'pharmacy_package_units', 'package unit'),
    named(R.manufacturer, manufacturers, 'pharmacy_manufacturers', 'manufacturer'),
    record(R.brand, brands, {
      orderBy: [brands.name],
      filters: { manufacturerId: brands.manufacturerId },
      search: [brands.name],
      unique: { pharmacy_brands_name_uq: taken('brand_name_taken', 'The manufacturer already has this brand') },
      references: { [fk('pharmacy_brands', 'manufacturer_id', 'pharmacy_manufacturers')]: R.manufacturer },
    }),
    record(R.product, products, {
      orderBy: [products.createdAt],
      filters: {
        brandId: products.brandId,
        genericId: products.genericId,
        formationId: products.formationId,
        isActive: products.isActive,
        barcode: products.barcode,
      },
      search: [products.barcode],
      unique: {
        pharmacy_products_uq: taken('product_exists', 'The brand already has this formation and strength'),
        pharmacy_products_barcode_uq: taken('product_barcode_taken', 'Another product has this barcode'),
      },
      references: {
        [fk('pharmacy_products', 'brand_id', 'pharmacy_brands')]: R.brand,
        [fk('pharmacy_products', 'generic_id', 'pharmacy_generics')]: R.generic,
        [fk('pharmacy_products', 'formation_id', 'pharmacy_formations')]: R.formation,
        [fk('pharmacy_products', 'strength_id', 'pharmacy_strengths')]: R.strength,
        [fk('pharmacy_products', 'unit_id', 'pharmacy_units')]: R.unit,
        [fk('pharmacy_products', 'package_unit_id', 'pharmacy_package_units')]: R.packageUnit,
      },
    }),
    record(R.outlet, outlets, {
      orderBy: [outlets.name],
      filters: { isActive: outlets.isActive },
      unique: {
        pharmacy_outlets_name_uq: taken('outlet_name_taken', 'Another outlet has this name'),
        pharmacy_outlets_code_uq: taken('outlet_code_taken', 'Another outlet has this code'),
      },
    }),
    record(R.outletUser, outletUsers, {
      orderBy: [outletUsers.createdAt],
      filters: { outletId: outletUsers.outletId, userId: outletUsers.userId },
      unique: { pharmacy_outlet_users_uq: taken('outlet_user_exists', 'The user already works at this outlet') },
      references: {
        [fk('pharmacy_outlet_users', 'outlet_id', 'pharmacy_outlets')]: R.outlet,
        [fk('pharmacy_outlet_users', 'user_id', 'users')]: 'user',
      },
    }),
    record(R.reorderLevel, reorderLevels, {
      orderBy: [reorderLevels.createdAt],
      filters: { outletId: reorderLevels.outletId, productId: reorderLevels.productId },
      unique: {
        pharmacy_reorder_levels_uq: taken('reorder_level_exists', 'The product already has a reorder level here'),
      },
      references: {
        [fk('pharmacy_reorder_levels', 'outlet_id', 'pharmacy_outlets')]: R.outlet,
        [fk('pharmacy_reorder_levels', 'product_id', 'pharmacy_products')]: R.product,
      },
    }),
  ];
}
