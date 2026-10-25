import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { glAccounts, subLedgers, vouchers } from '../../../accounts/infrastructure/persistence/accounts.schema.js';
import { staffRecords } from '../../../hr/infrastructure/persistence/hr.schema.js';
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

const quantity = (name: string) => numeric(name, { precision: 14, scale: 3, mode: 'number' });

// Document serials per kind and year (old Admin.spGetNextIndentNo; purchase orders used max + 1).
export const scmSequences = pgTable(
  'scm_sequences',
  {
    kind: text('kind').notNull(),
    year: smallint('year').notNull(),
    last: integer('last').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.year] })],
);

// Old SCMPurchaseApprovalSettings (main store, role, "Level1".."Final"): who approves requisitions, in order.
export const purchaseApprovalLevels = pgTable(
  'purchase_approval_levels',
  {
    id: uuid('id').primaryKey(),
    mainStoreId: uuid('main_store_id')
      .notNull()
      .references(() => mainStores.id, { onDelete: 'cascade' }),
    levelOrder: smallint('level_order').notNull(),
    name: text('name').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('purchase_approval_levels_order_uq').on(t.mainStoreId, t.levelOrder),
    check('purchase_approval_levels_order_ck', sql`${t.levelOrder} between 1 and 20`),
    nameLength('purchase_approval_levels', t.name, 50),
  ],
);

// Old PurchaseRequisiontions.
export const purchaseRequisitions = pgTable(
  'purchase_requisitions',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    mainStoreId: uuid('main_store_id')
      .notNull()
      .references(() => mainStores.id, { onDelete: 'restrict' }),
    subStoreId: uuid('sub_store_id').references(() => subStores.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id').references(() => storeDepartments.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
    requisitionDate: day('requisition_date').notNull(),
    paymentTerm: text('payment_term', { enum: ['cash', 'credit'] }),
    note: text('note'),
    terms: text('terms'),
    status: text('status', { enum: ['draft', 'pending', 'approved', 'rejected', 'cancelled'] }).notNull(),
    currentLevel: smallint('current_level'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('purchase_requisitions_number_uq').on(t.number),
    index('purchase_requisitions_status_idx').on(t.status, t.requisitionDate),
    index('purchase_requisitions_main_store_idx').on(t.mainStoreId),
    check(
      'purchase_requisitions_status_ck',
      sql`${t.status} in ('draft', 'pending', 'approved', 'rejected', 'cancelled')`,
    ),
    check(
      'purchase_requisitions_payment_term_ck',
      sql`${t.paymentTerm} is null or ${t.paymentTerm} in ('cash', 'credit')`,
    ),
    check('purchase_requisitions_level_ck', sql`(${t.status} = 'pending') = (${t.currentLevel} is not null)`),
  ],
);

export const purchaseRequisitionLines = pgTable(
  'purchase_requisition_lines',
  {
    requisitionId: uuid('requisition_id').notNull(),
    position: smallint('position').notNull(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    requestedQty: quantity('requested_qty').notNull(),
    approvedQty: quantity('approved_qty'),
    description: text('description'),
  },
  (t) => [
    foreignKey({
      name: 'purchase_requisition_lines_requisition_fk',
      columns: [t.requisitionId],
      foreignColumns: [purchaseRequisitions.id],
    }).onDelete('cascade'),
    primaryKey({ columns: [t.requisitionId, t.position] }),
    uniqueIndex('purchase_requisition_lines_variant_uq').on(t.requisitionId, t.variantId),
    check(
      'purchase_requisition_lines_qty_ck',
      sql`${t.requestedQty} > 0 and (${t.approvedQty} is null or ${t.approvedQty} between 0 and ${t.requestedQty})`,
    ),
  ],
);

// Old RequisitionApprovals (one row per level, with the next level's setting id).
export const purchaseRequisitionApprovals = pgTable(
  'purchase_requisition_approvals',
  {
    requisitionId: uuid('requisition_id').notNull(),
    levelOrder: smallint('level_order').notNull(),
    levelName: text('level_name').notNull(),
    decision: text('decision', { enum: ['approved', 'rejected'] }).notNull(),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: tz('decided_at').notNull(),
    remarks: text('remarks'),
  },
  (t) => [
    foreignKey({
      name: 'purchase_requisition_approvals_requisition_fk',
      columns: [t.requisitionId],
      foreignColumns: [purchaseRequisitions.id],
    }).onDelete('cascade'),
    primaryKey({ columns: [t.requisitionId, t.levelOrder] }),
    check('purchase_requisition_approvals_decision_ck', sql`${t.decision} in ('approved', 'rejected')`),
  ],
);

// Old CSApprovalSettings: named staff approve comparative studies in order; a final level ends the approval.
export const csApprovalLevels = pgTable(
  'cs_approval_levels',
  {
    id: uuid('id').primaryKey(),
    levelOrder: smallint('level_order').notNull(),
    name: text('name').notNull(),
    approverStaffId: uuid('approver_staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'restrict' }),
    isFinal: boolean('is_final').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('cs_approval_levels_order_uq').on(t.levelOrder),
    check('cs_approval_levels_order_ck', sql`${t.levelOrder} between 1 and 20`),
    nameLength('cs_approval_levels', t.name, 50),
  ],
);

// Old ComparativeStudies.
export const comparativeStudies = pgTable(
  'comparative_studies',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    studyDate: day('study_date').notNull(),
    requisitionId: uuid('requisition_id').references(() => purchaseRequisitions.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    note: text('note'),
    status: text('status', { enum: ['draft', 'pending', 'approved', 'rejected'] }).notNull(),
    currentLevel: smallint('current_level'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('comparative_studies_number_uq').on(t.number),
    index('comparative_studies_status_idx').on(t.status, t.studyDate),
    check('comparative_studies_status_ck', sql`${t.status} in ('draft', 'pending', 'approved', 'rejected')`),
    check('comparative_studies_level_ck', sql`(${t.status} = 'pending') = (${t.currentLevel} is not null)`),
  ],
);

// Old ComparativeStudyDetails: one supplier's quote for one item.
export const comparativeStudyQuotes = pgTable(
  'comparative_study_quotes',
  {
    id: uuid('id').primaryKey(),
    studyId: uuid('study_id')
      .notNull()
      .references(() => comparativeStudies.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id').references(() => itemVariants.id, { onDelete: 'restrict' }),
    manualName: text('manual_name'),
    qty: quantity('qty').notNull(),
    unitPrice: money('unit_price').notNull(),
    vatPercent: percent('vat_percent').notNull(),
    aitPercent: percent('ait_percent').notNull(),
    vat: money('vat').notNull(),
    ait: money('ait').notNull(),
    total: money('total').notNull(),
    selected: boolean('selected').notNull(),
  },
  (t) => [
    index('comparative_study_quotes_study_idx').on(t.studyId, t.position),
    check('comparative_study_quotes_item_ck', sql`(${t.variantId} is null) <> (${t.manualName} is null)`),
    check('comparative_study_quotes_amounts_ck', sql`${t.qty} > 0 and ${t.unitPrice} >= 0 and ${t.total} >= 0`),
  ],
);

export const comparativeStudyApprovals = pgTable(
  'comparative_study_approvals',
  {
    studyId: uuid('study_id')
      .notNull()
      .references(() => comparativeStudies.id, { onDelete: 'cascade' }),
    levelOrder: smallint('level_order').notNull(),
    levelName: text('level_name').notNull(),
    decision: text('decision', { enum: ['approved', 'rejected'] }).notNull(),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: tz('decided_at').notNull(),
    remarks: text('remarks'),
  },
  (t) => [
    primaryKey({ columns: [t.studyId, t.levelOrder] }),
    check('comparative_study_approvals_decision_ck', sql`${t.decision} in ('approved', 'rejected')`),
  ],
);

// Old PurchaseOrders / PurchaseOrderDetails.
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    mainStoreId: uuid('main_store_id')
      .notNull()
      .references(() => mainStores.id, { onDelete: 'restrict' }),
    requisitionId: uuid('requisition_id').references(() => purchaseRequisitions.id, { onDelete: 'restrict' }),
    comparativeStudyId: uuid('comparative_study_id').references(() => comparativeStudies.id, {
      onDelete: 'restrict',
    }),
    orderDate: day('order_date').notNull(),
    expectedOn: day('expected_on'),
    terms: text('terms'),
    note: text('note'),
    status: text('status', {
      enum: ['open', 'partially_received', 'received', 'closed', 'cancelled'],
    }).notNull(),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('purchase_orders_number_uq').on(t.number),
    index('purchase_orders_supplier_idx').on(t.supplierId, t.orderDate),
    index('purchase_orders_requisition_idx').on(t.requisitionId),
    index('purchase_orders_status_idx').on(t.status, t.orderDate),
    check(
      'purchase_orders_status_ck',
      sql`${t.status} in ('open', 'partially_received', 'received', 'closed', 'cancelled')`,
    ),
    check('purchase_orders_expected_ck', sql`${t.expectedOn} is null or ${t.expectedOn} >= ${t.orderDate}`),
  ],
);

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    qty: quantity('qty').notNull(),
    rate: money('rate').notNull(),
    vatPercent: percent('vat_percent').notNull(),
    receivedQty: quantity('received_qty').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.position] }),
    uniqueIndex('purchase_order_lines_variant_uq').on(t.orderId, t.variantId),
    index('purchase_order_lines_variant_idx').on(t.variantId),
    check(
      'purchase_order_lines_amounts_ck',
      sql`${t.qty} > 0 and ${t.rate} >= 0 and ${t.vatPercent} between 0 and 100 and ${t.receivedQty} >= 0`,
    ),
  ],
);

const unitCost = (name: string) => numeric(name, { precision: 16, scale: 4, mode: 'number' });

// Old SupplyChain.LotRecords: one lot per item variant, batch and expiry (the old lots were shared by every
// product with the same batch and expiry text, with three different date formats).
export const stockLots = pgTable(
  'stock_lots',
  {
    id: uuid('id').primaryKey(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no'),
    expiryDate: day('expiry_date'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stock_lots_uq').on(
      t.variantId,
      sql`coalesce(upper(${t.batchNo}), '')`,
      sql`coalesce(${t.expiryDate}, '9999-12-31'::date)`,
    ),
    index('stock_lots_expiry_idx').on(t.expiryDate),
  ],
);

export const STOCK_MOVEMENT_KINDS = ['opening', 'receive', 'issue', 'transfer'] as const;

// Every quantity in or out of a store, by lot, with its unit cost. Stock is the sum; the old system added up
// receive, transfer, issue and return tables in each report.
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey(),
    mainStoreId: uuid('main_store_id').references(() => mainStores.id, { onDelete: 'restrict' }),
    subStoreId: uuid('sub_store_id').references(() => subStores.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => stockLots.id, { onDelete: 'restrict' }),
    qty: quantity('qty').notNull(),
    unitCost: unitCost('unit_cost').notNull(),
    movedOn: day('moved_on').notNull(),
    kind: text('kind', { enum: STOCK_MOVEMENT_KINDS }).notNull(),
    documentId: uuid('document_id').notNull(),
    documentNumber: text('document_number').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('stock_movements_main_idx').on(t.mainStoreId, t.variantId, t.movedOn),
    index('stock_movements_sub_idx').on(t.subStoreId, t.variantId, t.movedOn),
    index('stock_movements_lot_idx').on(t.lotId),
    index('stock_movements_document_idx').on(t.documentId),
    check('stock_movements_store_ck', sql`(${t.mainStoreId} is null) <> (${t.subStoreId} is null)`),
    check('stock_movements_qty_ck', sql`${t.qty} <> 0 and ${t.unitCost} >= 0`),
    check('stock_movements_kind_ck', sql`${t.kind} in ('opening', 'receive', 'issue', 'transfer')`),
  ],
);

// Old OpeningQty / OpeningDate on BrandExtensions: opening stock entered per store.
export const stockOpenings = pgTable(
  'stock_openings',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    mainStoreId: uuid('main_store_id').references(() => mainStores.id, { onDelete: 'restrict' }),
    subStoreId: uuid('sub_store_id').references(() => subStores.id, { onDelete: 'restrict' }),
    openedOn: day('opened_on').notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('stock_openings_number_uq').on(t.number),
    check('stock_openings_store_ck', sql`(${t.mainStoreId} is null) <> (${t.subStoreId} is null)`),
  ],
);

// Old StockReceives / StockReceiveDetails.
export const stockReceives = pgTable(
  'stock_receives',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    mainStoreId: uuid('main_store_id')
      .notNull()
      .references(() => mainStores.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id, { onDelete: 'restrict' }),
    receivedOn: day('received_on').notNull(),
    supplierInvoiceNo: text('supplier_invoice_no'),
    supplierInvoiceDate: day('supplier_invoice_date'),
    challanNo: text('challan_no'),
    remarks: text('remarks'),
    status: text('status', { enum: ['draft', 'posted'] }).notNull(),
    amount: money('amount').notNull(),
    discount: money('discount').notNull(),
    vat: money('vat').notNull(),
    ait: money('ait').notNull(),
    total: money('total').notNull(),
    voucherId: uuid('voucher_id').references(() => vouchers.id, { onDelete: 'set null' }),
    voucherNumber: text('voucher_number'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    postedBy: uuid('posted_by').references(() => users.id, { onDelete: 'set null' }),
    postedAt: tz('posted_at'),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('stock_receives_number_uq').on(t.number),
    uniqueIndex('stock_receives_invoice_uq')
      .on(t.supplierId, sql`upper(${t.supplierInvoiceNo})`)
      .where(sql`${t.supplierInvoiceNo} is not null`),
    uniqueIndex('stock_receives_challan_uq')
      .on(t.supplierId, sql`upper(${t.challanNo})`)
      .where(sql`${t.challanNo} is not null`),
    index('stock_receives_supplier_idx').on(t.supplierId, t.receivedOn),
    index('stock_receives_order_idx').on(t.purchaseOrderId),
    index('stock_receives_status_idx').on(t.status, t.receivedOn),
    check('stock_receives_status_ck', sql`${t.status} in ('draft', 'posted')`),
    check('stock_receives_posted_ck', sql`(${t.status} = 'posted') = (${t.postedAt} is not null)`),
  ],
);

export const stockReceiveLines = pgTable(
  'stock_receive_lines',
  {
    receiveId: uuid('receive_id').notNull(),
    position: smallint('position').notNull(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    qty: quantity('qty').notNull(),
    rate: money('rate').notNull(),
    discountPercent: percent('discount_percent').notNull(),
    vatPercent: percent('vat_percent').notNull(),
    aitPercent: percent('ait_percent').notNull(),
    amount: money('amount').notNull(),
    discount: money('discount').notNull(),
    vat: money('vat').notNull(),
    ait: money('ait').notNull(),
    total: money('total').notNull(),
    batchNo: text('batch_no'),
    expiryDate: day('expiry_date'),
    warrantyNote: text('warranty_note'),
    lotId: uuid('lot_id').references(() => stockLots.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ columns: [t.receiveId, t.position] }),
    foreignKey({
      name: 'stock_receive_lines_receive_fk',
      columns: [t.receiveId],
      foreignColumns: [stockReceives.id],
    }).onDelete('cascade'),
    index('stock_receive_lines_variant_idx').on(t.variantId),
    check('stock_receive_lines_amounts_ck', sql`${t.qty} > 0 and ${t.rate} >= 0 and ${t.total} >= 0`),
  ],
);

// Old GRNs / GRNFaultDescriptions: faults noted on the goods of a purchase order (kept on their own, as before).
export const grnFaults = pgTable(
  'grn_faults',
  {
    id: uuid('id').primaryKey(),
    purchaseOrderId: uuid('purchase_order_id')
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    qty: quantity('qty').notNull(),
    description: text('description').notNull(),
    notedOn: day('noted_on').notNull(),
    ...timestamps,
  },
  (t) => [
    index('grn_faults_order_idx').on(t.purchaseOrderId),
    check('grn_faults_qty_ck', sql`${t.qty} > 0`),
    check('grn_faults_description_len_ck', sql`char_length(${t.description}) between 1 and 1000`),
  ],
);

// Old StoreIndentApprovalSettings (store, role, "Level1".."Final").
export const storeIndentApprovalLevels = pgTable(
  'store_indent_approval_levels',
  {
    id: uuid('id').primaryKey(),
    subStoreId: uuid('sub_store_id')
      .notNull()
      .references(() => subStores.id, { onDelete: 'cascade' }),
    levelOrder: smallint('level_order').notNull(),
    name: text('name').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('store_indent_approval_levels_order_uq').on(t.subStoreId, t.levelOrder),
    check('store_indent_approval_levels_order_ck', sql`${t.levelOrder} between 1 and 20`),
    nameLength('store_indent_approval_levels', t.name, 50),
  ],
);

export const INDENT_STATUSES = [
  'draft',
  'pending',
  'approved',
  'partially_served',
  'served',
  'acknowledged',
  'rejected',
  'cancelled',
] as const;

// Old StoreIndents / StoreIndentDetails / IndentApprovals.
export const storeIndents = pgTable(
  'store_indents',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    subStoreId: uuid('sub_store_id')
      .notNull()
      .references(() => subStores.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id').references(() => storeDepartments.id, { onDelete: 'restrict' }),
    indentDate: day('indent_date').notNull(),
    priority: text('priority', {
      enum: ['routine', 'emergency', 'critical_care', 'new_admission', 'discharge', 'other'],
    }).notNull(),
    note: text('note'),
    status: text('status', { enum: INDENT_STATUSES }).notNull(),
    currentLevel: smallint('current_level'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
    acknowledgedAt: tz('acknowledged_at'),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('store_indents_number_uq').on(t.number),
    index('store_indents_store_idx').on(t.subStoreId, t.status),
    index('store_indents_date_idx').on(t.indentDate),
    check(
      'store_indents_status_ck',
      sql`${t.status} in ('draft', 'pending', 'approved', 'partially_served', 'served', 'acknowledged', 'rejected', 'cancelled')`,
    ),
    check(
      'store_indents_priority_ck',
      sql`${t.priority} in ('routine', 'emergency', 'critical_care', 'new_admission', 'discharge', 'other')`,
    ),
    check('store_indents_level_ck', sql`(${t.status} = 'pending') = (${t.currentLevel} is not null)`),
  ],
);

export const storeIndentLines = pgTable(
  'store_indent_lines',
  {
    indentId: uuid('indent_id').notNull(),
    position: smallint('position').notNull(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    qty: quantity('qty').notNull(),
    approvedQty: quantity('approved_qty'),
    servedQty: quantity('served_qty').notNull().default(0),
    remarks: text('remarks'),
  },
  (t) => [
    primaryKey({ columns: [t.indentId, t.position] }),
    foreignKey({
      name: 'store_indent_lines_indent_fk',
      columns: [t.indentId],
      foreignColumns: [storeIndents.id],
    }).onDelete('cascade'),
    uniqueIndex('store_indent_lines_variant_uq').on(t.indentId, t.variantId),
    check(
      'store_indent_lines_qty_ck',
      sql`${t.qty} > 0 and (${t.approvedQty} is null or ${t.approvedQty} between 0 and ${t.qty}) and ${t.servedQty} >= 0`,
    ),
  ],
);

export const storeIndentApprovals = pgTable(
  'store_indent_approvals',
  {
    indentId: uuid('indent_id').notNull(),
    levelOrder: smallint('level_order').notNull(),
    levelName: text('level_name').notNull(),
    decision: text('decision', { enum: ['approved', 'rejected'] }).notNull(),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: tz('decided_at').notNull(),
    remarks: text('remarks'),
  },
  (t) => [
    primaryKey({ columns: [t.indentId, t.levelOrder] }),
    foreignKey({
      name: 'store_indent_approvals_indent_fk',
      columns: [t.indentId],
      foreignColumns: [storeIndents.id],
    }).onDelete('cascade'),
    check('store_indent_approvals_decision_ck', sql`${t.decision} in ('approved', 'rejected')`),
  ],
);

// Old PRIndents / PRIndentDetails (and PRSubmitted, now the link to the purchase requisition).
export const storeRequests = pgTable(
  'store_requests',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    subStoreId: uuid('sub_store_id')
      .notNull()
      .references(() => subStores.id, { onDelete: 'restrict' }),
    mainStoreId: uuid('main_store_id')
      .notNull()
      .references(() => mainStores.id, { onDelete: 'restrict' }),
    requestDate: day('request_date').notNull(),
    note: text('note'),
    status: text('status', { enum: ['open', 'partially_served', 'served', 'closed'] }).notNull(),
    purchaseRequisitionId: uuid('purchase_requisition_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('store_requests_number_uq').on(t.number),
    foreignKey({
      name: 'store_requests_purchase_requisition_fk',
      columns: [t.purchaseRequisitionId],
      foreignColumns: [purchaseRequisitions.id],
    }).onDelete('set null'),
    index('store_requests_main_idx').on(t.mainStoreId, t.status),
    check('store_requests_status_ck', sql`${t.status} in ('open', 'partially_served', 'served', 'closed')`),
  ],
);

export const storeRequestLines = pgTable(
  'store_request_lines',
  {
    requestId: uuid('request_id').notNull(),
    position: smallint('position').notNull(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    qty: quantity('qty').notNull(),
    servedQty: quantity('served_qty').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.requestId, t.position] }),
    foreignKey({
      name: 'store_request_lines_request_fk',
      columns: [t.requestId],
      foreignColumns: [storeRequests.id],
    }).onDelete('cascade'),
    uniqueIndex('store_request_lines_variant_uq').on(t.requestId, t.variantId),
    check('store_request_lines_qty_ck', sql`${t.qty} > 0 and ${t.servedQty} >= 0`),
  ],
);

// Old Issues / IssueDetails: goods given from a sub-store to a department. The lots taken are the issue's
// stock movements.
export const storeIssues = pgTable(
  'store_issues',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    subStoreId: uuid('sub_store_id')
      .notNull()
      .references(() => subStores.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => storeDepartments.id, { onDelete: 'restrict' }),
    indentId: uuid('indent_id').references(() => storeIndents.id, { onDelete: 'restrict' }),
    issueDate: day('issue_date').notNull(),
    receivedByStaffId: uuid('received_by_staff_id').references(() => staffRecords.id, { onDelete: 'set null' }),
    note: text('note'),
    issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('store_issues_number_uq').on(t.number),
    index('store_issues_store_idx').on(t.subStoreId, t.issueDate),
    index('store_issues_department_idx').on(t.departmentId, t.issueDate),
    index('store_issues_indent_idx').on(t.indentId),
  ],
);

export const storeIssueLines = pgTable(
  'store_issue_lines',
  {
    issueId: uuid('issue_id').notNull(),
    position: smallint('position').notNull(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    qty: quantity('qty').notNull(),
    lotId: uuid('lot_id').references(() => stockLots.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ columns: [t.issueId, t.position] }),
    foreignKey({ name: 'store_issue_lines_issue_fk', columns: [t.issueId], foreignColumns: [storeIssues.id] }).onDelete(
      'cascade',
    ),
    check('store_issue_lines_qty_ck', sql`${t.qty} > 0`),
  ],
);

// Old SStockTransfers (main → sub), SubStoreToMainTransfers (sub → main) and SCMStockTransfers (sub → sub,
// accepted by the receiving store).
export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    kind: text('kind', { enum: ['main_to_sub', 'sub_to_main', 'sub_to_sub'] }).notNull(),
    fromMainStoreId: uuid('from_main_store_id').references(() => mainStores.id, { onDelete: 'restrict' }),
    fromSubStoreId: uuid('from_sub_store_id').references(() => subStores.id, { onDelete: 'restrict' }),
    toMainStoreId: uuid('to_main_store_id').references(() => mainStores.id, { onDelete: 'restrict' }),
    toSubStoreId: uuid('to_sub_store_id').references(() => subStores.id, { onDelete: 'restrict' }),
    requestId: uuid('request_id').references(() => storeRequests.id, { onDelete: 'restrict' }),
    transferDate: day('transfer_date').notNull(),
    status: text('status', { enum: ['pending', 'completed', 'rejected'] }).notNull(),
    note: text('note'),
    rejectReason: text('reject_reason'),
    sentBy: uuid('sent_by').references(() => users.id, { onDelete: 'set null' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: tz('decided_at'),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('stock_transfers_number_uq').on(t.number),
    index('stock_transfers_date_idx').on(t.transferDate),
    index('stock_transfers_request_idx').on(t.requestId),
    check('stock_transfers_kind_ck', sql`${t.kind} in ('main_to_sub', 'sub_to_main', 'sub_to_sub')`),
    check('stock_transfers_status_ck', sql`${t.status} in ('pending', 'completed', 'rejected')`),
    check(
      'stock_transfers_stores_ck',
      sql`(${t.kind} = 'main_to_sub' and ${t.fromMainStoreId} is not null and ${t.toSubStoreId} is not null
            and ${t.fromSubStoreId} is null and ${t.toMainStoreId} is null)
        or (${t.kind} = 'sub_to_main' and ${t.fromSubStoreId} is not null and ${t.toMainStoreId} is not null
            and ${t.fromMainStoreId} is null and ${t.toSubStoreId} is null)
        or (${t.kind} = 'sub_to_sub' and ${t.fromSubStoreId} is not null and ${t.toSubStoreId} is not null
            and ${t.fromMainStoreId} is null and ${t.toMainStoreId} is null and ${t.fromSubStoreId} <> ${t.toSubStoreId})`,
    ),
  ],
);

export const stockTransferLines = pgTable(
  'stock_transfer_lines',
  {
    transferId: uuid('transfer_id').notNull(),
    position: smallint('position').notNull(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    qty: quantity('qty').notNull(),
    acceptedQty: quantity('accepted_qty'),
    lotId: uuid('lot_id').references(() => stockLots.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ columns: [t.transferId, t.position] }),
    foreignKey({
      name: 'stock_transfer_lines_transfer_fk',
      columns: [t.transferId],
      foreignColumns: [stockTransfers.id],
    }).onDelete('cascade'),
    check(
      'stock_transfer_lines_qty_ck',
      sql`${t.qty} > 0 and (${t.acceptedQty} is null or ${t.acceptedQty} between 0 and ${t.qty})`,
    ),
  ],
);
