import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { glAccounts, subLedgers } from '../../../accounts/infrastructure/persistence/accounts.schema.js';
import { roles } from '../../../access-control/infrastructure/persistence/access-control.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const percent = (name: string) => numeric(name, { precision: 5, scale: 2, mode: 'number' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};
const nameLength = (table: string, column: SQLWrapper, max = 150) =>
  check(`${table}_name_len_ck`, sql`char_length(${column}) between 1 and ${sql.raw(String(max))}`);

// Old SupplyChain.MainStores: the central stores that buy from suppliers.
export const mainStores = pgTable(
  'main_stores',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (t) => [uniqueIndex('main_stores_name_uq').on(sql`upper(${t.name})`), nameLength('main_stores', t.name, 100)],
);

// Old SupplyChain.Stores: the sub-stores a main store supplies, which issue to departments.
export const subStores = pgTable(
  'sub_stores',
  {
    id: uuid('id').primaryKey(),
    mainStoreId: uuid('main_store_id')
      .notNull()
      .references(() => mainStores.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('sub_stores_name_uq').on(sql`upper(${t.name})`),
    index('sub_stores_main_store_idx').on(t.mainStoreId),
    nameLength('sub_stores', t.name, 100),
  ],
);

// Old SupplyChain.StoreDepts: the departments that indent from the stores and receive issues.
export const storeDepartments = pgTable(
  'store_departments',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('store_departments_name_uq').on(sql`upper(${t.name})`),
    nameLength('store_departments', t.name, 100),
  ],
);

// Old SupplyChain.StoreDeptUserAccesses (a comma-separated list per user): who may indent for a department.
export const departmentUsers = pgTable(
  'store_department_users',
  {
    id: uuid('id').primaryKey(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => storeDepartments.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('store_department_users_uq').on(t.departmentId, t.userId),
    index('store_department_users_user_idx').on(t.userId),
  ],
);

// Old SupplyChain.DeptStoreAcesses: which sub-store a user indents from for a department.
export const departmentStoreAccess = pgTable(
  'department_store_access',
  {
    id: uuid('id').primaryKey(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => storeDepartments.id, { onDelete: 'cascade' }),
    subStoreId: uuid('sub_store_id')
      .notNull()
      .references(() => subStores.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('department_store_access_uq').on(t.departmentId, t.subStoreId, t.userId),
    index('department_store_access_user_idx').on(t.userId),
  ],
);

// Old SupplyChain.IssueStoreAcesses: who may issue from a sub-store.
export const issueStoreUsers = pgTable(
  'issue_store_users',
  {
    id: uuid('id').primaryKey(),
    subStoreId: uuid('sub_store_id')
      .notNull()
      .references(() => subStores.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('issue_store_users_uq').on(t.subStoreId, t.userId),
    index('issue_store_users_user_idx').on(t.userId),
  ],
);

// Old SupplyChain.ParentCategories.
export const itemCategories = pgTable(
  'item_categories',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('item_categories_name_uq').on(sql`upper(${t.name})`), nameLength('item_categories', t.name)],
);

// Old SupplyChain.SubCategories.
export const itemSubCategories = pgTable(
  'item_sub_categories',
  {
    id: uuid('id').primaryKey(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => itemCategories.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('item_sub_categories_name_uq').on(t.categoryId, sql`upper(${t.name})`),
    nameLength('item_sub_categories', t.name),
  ],
);

// Old SupplyChain.Groups.
export const itemGroups = pgTable(
  'item_groups',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('item_groups_name_uq').on(sql`upper(${t.name})`), nameLength('item_groups', t.name)],
);

// Old SupplyChain.SubGroups.
export const itemSubGroups = pgTable(
  'item_sub_groups',
  {
    id: uuid('id').primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => itemGroups.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('item_sub_groups_name_uq').on(t.groupId, sql`upper(${t.name})`),
    nameLength('item_sub_groups', t.name),
  ],
);

// Old SupplyChain.BrandNames: an item (e.g. "A4 paper"). The item type is the inventory account
// (Disposable / Consumable / Reusable / Fixed asset) its purchases post to.
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    subGroupId: uuid('sub_group_id')
      .notNull()
      .references(() => itemSubGroups.id, { onDelete: 'restrict' }),
    subCategoryId: uuid('sub_category_id')
      .notNull()
      .references(() => itemSubCategories.id, { onDelete: 'restrict' }),
    unit: text('unit').notNull(),
    typeGlAccountId: uuid('type_gl_account_id').references(() => glAccounts.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('items_name_uq').on(t.subGroupId, sql`upper(${t.name})`),
    index('items_sub_category_idx').on(t.subCategoryId),
    nameLength('items', t.name, 200),
    check('items_unit_len_ck', sql`char_length(${t.unit}) between 1 and 30`),
  ],
);

// Old SupplyChain.BrandExtensions: what is stocked, bought and issued (a brand, size or part of an item).
// The opening quantity moves to an opening stock entry per store (step 7c).
export const itemVariants = pgTable(
  'item_variants',
  {
    id: uuid('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    code: text('code'),
    alternateName: text('alternate_name'),
    specification: text('specification'),
    purchasePrice: money('purchase_price').notNull().default(0),
    salePrice: money('sale_price').notNull().default(0),
    reorderLevel: integer('reorder_level').notNull().default(0),
    expiryRequired: boolean('expiry_required').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('item_variants_name_uq').on(t.itemId, sql`upper(${t.name})`),
    uniqueIndex('item_variants_code_uq')
      .on(sql`upper(${t.code})`)
      .where(sql`${t.code} is not null`),
    nameLength('item_variants', t.name, 200),
    check('item_variants_amounts_ck', sql`${t.purchasePrice} >= 0 and ${t.salePrice} >= 0 and ${t.reorderLevel} >= 0`),
  ],
);

// Old SupplyChain.RoleGroupRestrictions: item groups hidden from a role in stock lists and indents.
export const roleGroupRestrictions = pgTable(
  'role_group_restrictions',
  {
    id: uuid('id').primaryKey(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => itemGroups.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('role_group_restrictions_uq').on(t.roleId, t.groupId)],
);

// Old SupplyChain.SupplierTypes.
export const supplierTypes = pgTable(
  'supplier_types',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('supplier_types_name_uq').on(sql`upper(${t.name})`), nameLength('supplier_types', t.name, 100)],
);

// Old SupplyChain.Suppliers. The payable account (old GLId) and the party's sub-ledger are where purchases
// and payments post (step 7b).
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').primaryKey(),
    typeId: uuid('type_id')
      .notNull()
      .references(() => supplierTypes.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    address: text('address'),
    contactNo: text('contact_no'),
    email: text('email'),
    isEnlisted: boolean('is_enlisted').notNull().default(false),
    enlistedOn: day('enlisted_on'),
    enlistmentExpiresOn: day('enlistment_expires_on'),
    vatPercent: percent('vat_percent').notNull().default(0),
    taxPercent: percent('tax_percent').notNull().default(0),
    isManufacturer: boolean('is_manufacturer').notNull().default(false),
    glAccountId: uuid('gl_account_id').references(() => glAccounts.id, { onDelete: 'restrict' }),
    subLedgerId: uuid('sub_ledger_id').references(() => subLedgers.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('suppliers_name_uq').on(sql`upper(${t.name})`),
    uniqueIndex('suppliers_sub_ledger_uq')
      .on(t.subLedgerId)
      .where(sql`${t.subLedgerId} is not null`),
    index('suppliers_type_idx').on(t.typeId),
    nameLength('suppliers', t.name, 200),
    check('suppliers_rates_ck', sql`${t.vatPercent} between 0 and 100 and ${t.taxPercent} between 0 and 100`),
    check(
      'suppliers_enlistment_ck',
      sql`${t.enlistmentExpiresOn} is null or ${t.enlistedOn} is null or ${t.enlistmentExpiresOn} >= ${t.enlistedOn}`,
    ),
  ],
);
