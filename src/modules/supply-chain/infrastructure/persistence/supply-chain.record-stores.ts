import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import {
  DrizzleRecordStore,
  type RecordStoreOptions,
  type RecordTable,
} from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { and, eq, ne } from 'drizzle-orm';
import { DomainError } from '../../../../shared/domain/errors.js';
import {
  GRN_FAULT,
  SCM_MANAGE,
  SCM_READ,
  SCM_RECEIVE,
  SCM_RECORDS as R,
} from '../../application/supply-chain.constants.js';
import {
  csApprovalLevels,
  grnFaults,
  purchaseOrderLines,
  purchaseOrders,
  departmentStoreAccess,
  departmentUsers,
  issueStoreUsers,
  itemCategories,
  itemGroups,
  items,
  itemSubCategories,
  itemSubGroups,
  itemVariants,
  mainStores,
  purchaseApprovalLevels,
  roleGroupRestrictions,
  storeDepartments,
  storeIndentApprovalLevels,
  subStores,
  suppliers,
  supplierTypes,
} from './supply-chain.schema.js';

const fk = (table: string, column: string, referenced: string) => `${table}_${column}_${referenced}_id_fk`;
const taken = (code: string, message: string) => ({ code, message });

export function supplyChainRecordTypes(context: DbContext): RecordType[] {
  const record = (name: string, table: RecordTable, options: Omit<RecordStoreOptions, 'name'>): RecordType => ({
    name,
    readPermission: SCM_READ,
    managePermission: SCM_MANAGE,
    store: new DrizzleRecordStore(context, table, { name, ...options }),
  });

  return [
    record(R.mainStore, mainStores, {
      orderBy: [mainStores.name],
      unique: { main_stores_name_uq: taken('main_store_name_taken', 'Another main store has this name') },
    }),
    record(R.subStore, subStores, {
      orderBy: [subStores.name],
      filters: { mainStoreId: subStores.mainStoreId },
      unique: { sub_stores_name_uq: taken('sub_store_name_taken', 'Another sub-store has this name') },
      references: { [fk('sub_stores', 'main_store_id', 'main_stores')]: R.mainStore },
    }),
    record(R.department, storeDepartments, {
      orderBy: [storeDepartments.name],
      unique: { store_departments_name_uq: taken('store_department_name_taken', 'This department exists') },
    }),
    record(R.departmentUser, departmentUsers, {
      orderBy: [departmentUsers.createdAt],
      filters: { departmentId: departmentUsers.departmentId, userId: departmentUsers.userId },
      unique: {
        store_department_users_uq: taken('store_department_user_exists', 'The user may already indent for it'),
      },
      references: {
        [fk('store_department_users', 'department_id', 'store_departments')]: R.department,
        [fk('store_department_users', 'user_id', 'users')]: 'user',
      },
    }),
    record(R.departmentStoreAccess, departmentStoreAccess, {
      orderBy: [departmentStoreAccess.createdAt],
      filters: {
        departmentId: departmentStoreAccess.departmentId,
        subStoreId: departmentStoreAccess.subStoreId,
        userId: departmentStoreAccess.userId,
      },
      unique: {
        department_store_access_uq: taken('department_store_access_exists', 'The user already has this access'),
      },
      references: {
        [fk('department_store_access', 'department_id', 'store_departments')]: R.department,
        [fk('department_store_access', 'sub_store_id', 'sub_stores')]: R.subStore,
        [fk('department_store_access', 'user_id', 'users')]: 'user',
      },
    }),
    record(R.issueStoreUser, issueStoreUsers, {
      orderBy: [issueStoreUsers.createdAt],
      filters: { subStoreId: issueStoreUsers.subStoreId, userId: issueStoreUsers.userId },
      unique: { issue_store_users_uq: taken('issue_store_user_exists', 'The user may already issue from it') },
      references: {
        [fk('issue_store_users', 'sub_store_id', 'sub_stores')]: R.subStore,
        [fk('issue_store_users', 'user_id', 'users')]: 'user',
      },
    }),
    record(R.category, itemCategories, {
      orderBy: [itemCategories.name],
      unique: { item_categories_name_uq: taken('item_category_name_taken', 'This category exists') },
    }),
    record(R.subCategory, itemSubCategories, {
      orderBy: [itemSubCategories.name],
      filters: { categoryId: itemSubCategories.categoryId },
      unique: {
        item_sub_categories_name_uq: taken('item_sub_category_name_taken', 'The category already has this'),
      },
      references: { [fk('item_sub_categories', 'category_id', 'item_categories')]: R.category },
    }),
    record(R.group, itemGroups, {
      orderBy: [itemGroups.name],
      unique: { item_groups_name_uq: taken('item_group_name_taken', 'This group exists') },
    }),
    record(R.subGroup, itemSubGroups, {
      orderBy: [itemSubGroups.name],
      filters: { groupId: itemSubGroups.groupId },
      unique: { item_sub_groups_name_uq: taken('item_sub_group_name_taken', 'The group already has this') },
      references: { [fk('item_sub_groups', 'group_id', 'item_groups')]: R.group },
    }),
    record(R.item, items, {
      orderBy: [items.name],
      filters: { subGroupId: items.subGroupId, subCategoryId: items.subCategoryId, isActive: items.isActive },
      search: [items.name],
      unique: { items_name_uq: taken('item_name_taken', 'The sub-group already has an item of this name') },
      references: {
        [fk('items', 'sub_group_id', 'item_sub_groups')]: R.subGroup,
        [fk('items', 'sub_category_id', 'item_sub_categories')]: R.subCategory,
        [fk('items', 'type_gl_account_id', 'gl_accounts')]: 'gl_account',
      },
    }),
    record(R.variant, itemVariants, {
      orderBy: [itemVariants.name],
      filters: { itemId: itemVariants.itemId, isActive: itemVariants.isActive },
      search: [itemVariants.name, itemVariants.code, itemVariants.alternateName],
      unique: {
        item_variants_name_uq: taken('item_variant_name_taken', 'The item already has this variant'),
        item_variants_code_uq: taken('item_variant_code_taken', 'Another variant has this code'),
      },
      references: { [fk('item_variants', 'item_id', 'items')]: R.item },
    }),
    record(R.roleGroupRestriction, roleGroupRestrictions, {
      orderBy: [roleGroupRestrictions.createdAt],
      filters: { roleId: roleGroupRestrictions.roleId, groupId: roleGroupRestrictions.groupId },
      unique: {
        role_group_restrictions_uq: taken('role_group_restriction_exists', 'The group is already hidden from the role'),
      },
      references: {
        [fk('role_group_restrictions', 'role_id', 'roles')]: 'role',
        [fk('role_group_restrictions', 'group_id', 'item_groups')]: R.group,
      },
    }),
    record(R.supplierType, supplierTypes, {
      orderBy: [supplierTypes.name],
      unique: { supplier_types_name_uq: taken('supplier_type_name_taken', 'This supplier type exists') },
    }),
    record(R.supplier, suppliers, {
      orderBy: [suppliers.name],
      filters: {
        typeId: suppliers.typeId,
        isEnlisted: suppliers.isEnlisted,
        isManufacturer: suppliers.isManufacturer,
        isActive: suppliers.isActive,
      },
      search: [suppliers.name, suppliers.contactNo],
      unique: {
        suppliers_name_uq: taken('supplier_name_taken', 'Another supplier has this name'),
        suppliers_sub_ledger_uq: taken('supplier_sub_ledger_taken', 'Another supplier uses this sub-ledger'),
      },
      references: {
        [fk('suppliers', 'type_id', 'supplier_types')]: R.supplierType,
        [fk('suppliers', 'gl_account_id', 'gl_accounts')]: 'gl_account',
        [fk('suppliers', 'sub_ledger_id', 'sub_ledgers')]: 'sub_ledger',
      },
    }),
    record(R.purchaseApprovalLevel, purchaseApprovalLevels, {
      orderBy: [purchaseApprovalLevels.mainStoreId, purchaseApprovalLevels.levelOrder],
      filters: { mainStoreId: purchaseApprovalLevels.mainStoreId },
      unique: {
        purchase_approval_levels_order_uq: taken(
          'purchase_approval_level_exists',
          'The main store already has this level',
        ),
      },
      references: {
        [fk('purchase_approval_levels', 'main_store_id', 'main_stores')]: R.mainStore,
        [fk('purchase_approval_levels', 'role_id', 'roles')]: 'role',
      },
    }),
    record(R.indentApprovalLevel, storeIndentApprovalLevels, {
      orderBy: [storeIndentApprovalLevels.subStoreId, storeIndentApprovalLevels.levelOrder],
      filters: { subStoreId: storeIndentApprovalLevels.subStoreId },
      unique: {
        store_indent_approval_levels_order_uq: taken(
          'store_indent_approval_level_exists',
          'The sub-store already has this level',
        ),
      },
      references: {
        [fk('store_indent_approval_levels', 'sub_store_id', 'sub_stores')]: R.subStore,
        [fk('store_indent_approval_levels', 'role_id', 'roles')]: 'role',
      },
    }),
    record(R.csApprovalLevel, csApprovalLevels, {
      orderBy: [csApprovalLevels.levelOrder],
      unique: { cs_approval_levels_order_uq: taken('cs_approval_level_exists', 'This level exists') },
      references: { [fk('cs_approval_levels', 'approver_staff_id', 'staff_records')]: 'staff' },
    }),
    {
      name: GRN_FAULT,
      readPermission: SCM_READ,
      managePermission: SCM_RECEIVE,
      store: new DrizzleRecordStore(context, grnFaults, {
        name: GRN_FAULT,
        orderBy: [grnFaults.notedOn, grnFaults.createdAt],
        filters: { purchaseOrderId: grnFaults.purchaseOrderId },
        references: {
          [fk('grn_faults', 'purchase_order_id', 'purchase_orders')]: 'purchase_order',
          [fk('grn_faults', 'variant_id', 'item_variants')]: R.variant,
        },
        // A fault is noted on an item of an order that is not cancelled.
        guard: async (row) => {
          const { purchaseOrderId, variantId } = row;
          if (typeof purchaseOrderId !== 'string' || typeof variantId !== 'string') return;
          const [line] = await context.db
            .select({ status: purchaseOrders.status })
            .from(purchaseOrderLines)
            .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
            .where(
              and(
                eq(purchaseOrderLines.orderId, purchaseOrderId),
                eq(purchaseOrderLines.variantId, variantId),
                ne(purchaseOrders.status, 'cancelled'),
              ),
            );
          if (!line) throw new DomainError('not_on_order', 'The item is not on an open purchase order');
        },
      }),
    },
  ];
}
