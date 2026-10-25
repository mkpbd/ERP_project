/** Record names (snake_case): audit resource types and error codes (`<name>_not_found`, `<name>_in_use`). */
export const SCM_RECORDS = {
  mainStore: 'main_store',
  subStore: 'sub_store',
  department: 'store_department',
  departmentUser: 'store_department_user',
  departmentStoreAccess: 'department_store_access',
  issueStoreUser: 'issue_store_user',
  category: 'item_category',
  subCategory: 'item_sub_category',
  group: 'item_group',
  subGroup: 'item_sub_group',
  item: 'item',
  variant: 'item_variant',
  roleGroupRestriction: 'role_group_restriction',
  supplierType: 'supplier_type',
  supplier: 'supplier',
  purchaseApprovalLevel: 'purchase_approval_level',
  csApprovalLevel: 'cs_approval_level',
} as const;

/** Stores, the item catalogue and suppliers. */
export const SCM_READ = 'scm:read';
/** Setting up stores, store access, the item catalogue and suppliers. */
export const SCM_MANAGE = 'scm:manage';
/** Raising and editing requisitions, comparative studies and purchase orders. */
export const SCM_PURCHASE = 'scm:purchase';
