import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { SCM_RECORDS as R } from '../application/supply-chain.constants.js';
import {
  CreateDepartmentStoreAccessDto,
  CreateDepartmentUserDto,
  CreateIssueStoreUserDto,
  CreateItemCategoryDto,
  CreateItemDto,
  CreateItemGroupDto,
  CreateItemSubCategoryDto,
  CreateItemSubGroupDto,
  CreateItemVariantDto,
  CreateMainStoreDto,
  CreateRoleGroupRestrictionDto,
  CreateStoreDepartmentDto,
  CreateSubStoreDto,
  CreateSupplierDto,
  CreateSupplierTypeDto,
  DepartmentStoreAccessFilterDto,
  DepartmentStoreAccessResponseDto,
  DepartmentUserFilterDto,
  DepartmentUserResponseDto,
  IssueStoreUserFilterDto,
  IssueStoreUserResponseDto,
  ItemCategoryResponseDto,
  ItemFilterDto,
  ItemGroupResponseDto,
  ItemResponseDto,
  ItemSubCategoryFilterDto,
  ItemSubCategoryResponseDto,
  ItemSubGroupFilterDto,
  ItemSubGroupResponseDto,
  ItemVariantFilterDto,
  ItemVariantResponseDto,
  MainStoreResponseDto,
  RoleGroupRestrictionFilterDto,
  RoleGroupRestrictionResponseDto,
  StoreDepartmentResponseDto,
  SubStoreFilterDto,
  SubStoreResponseDto,
  SupplierFilterDto,
  SupplierResponseDto,
  SupplierTypeResponseDto,
  UpdateDepartmentStoreAccessDto,
  UpdateDepartmentUserDto,
  UpdateIssueStoreUserDto,
  UpdateItemCategoryDto,
  UpdateItemDto,
  UpdateItemGroupDto,
  UpdateItemSubCategoryDto,
  UpdateItemSubGroupDto,
  UpdateItemVariantDto,
  UpdateMainStoreDto,
  UpdateRoleGroupRestrictionDto,
  UpdateStoreDepartmentDto,
  UpdateSubStoreDto,
  UpdateSupplierDto,
  UpdateSupplierTypeDto,
  CreatePurchaseApprovalLevelDto,
  UpdatePurchaseApprovalLevelDto,
  PurchaseApprovalLevelFilterDto,
  PurchaseApprovalLevelResponseDto,
  CreateCsApprovalLevelDto,
  UpdateCsApprovalLevelDto,
  CsApprovalLevelResponseDto,
} from './dto/supply-chain.dto.js';

const scm = { tag: 'supply-chain', readPermission: 'scm:read', managePermission: 'scm:manage' } as const;

export const MainStoresController = createRecordController({
  ...scm,
  className: 'MainStoresController',
  path: 'scm/main-stores',
  type: R.mainStore,
  label: 'main store',
  create: CreateMainStoreDto,
  update: UpdateMainStoreDto,
  response: MainStoreResponseDto,
});

export const SubStoresController = createRecordController({
  ...scm,
  className: 'SubStoresController',
  path: 'scm/sub-stores',
  type: R.subStore,
  label: 'sub-store',
  create: CreateSubStoreDto,
  update: UpdateSubStoreDto,
  response: SubStoreResponseDto,
  filter: SubStoreFilterDto,
});

export const StoreDepartmentsController = createRecordController({
  ...scm,
  className: 'StoreDepartmentsController',
  path: 'scm/departments',
  type: R.department,
  label: 'store department',
  create: CreateStoreDepartmentDto,
  update: UpdateStoreDepartmentDto,
  response: StoreDepartmentResponseDto,
});

export const DepartmentUsersController = createRecordController({
  ...scm,
  className: 'DepartmentUsersController',
  path: 'scm/department-users',
  type: R.departmentUser,
  label: 'department user',
  create: CreateDepartmentUserDto,
  update: UpdateDepartmentUserDto,
  response: DepartmentUserResponseDto,
  filter: DepartmentUserFilterDto,
});

export const DepartmentStoreAccessController = createRecordController({
  ...scm,
  className: 'DepartmentStoreAccessController',
  path: 'scm/department-store-access',
  type: R.departmentStoreAccess,
  label: 'department store access',
  create: CreateDepartmentStoreAccessDto,
  update: UpdateDepartmentStoreAccessDto,
  response: DepartmentStoreAccessResponseDto,
  filter: DepartmentStoreAccessFilterDto,
});

export const IssueStoreUsersController = createRecordController({
  ...scm,
  className: 'IssueStoreUsersController',
  path: 'scm/issue-store-users',
  type: R.issueStoreUser,
  label: 'issue store user',
  create: CreateIssueStoreUserDto,
  update: UpdateIssueStoreUserDto,
  response: IssueStoreUserResponseDto,
  filter: IssueStoreUserFilterDto,
});

export const ItemCategoriesController = createRecordController({
  ...scm,
  className: 'ItemCategoriesController',
  path: 'scm/item-categories',
  type: R.category,
  label: 'item category',
  create: CreateItemCategoryDto,
  update: UpdateItemCategoryDto,
  response: ItemCategoryResponseDto,
});

export const ItemSubCategoriesController = createRecordController({
  ...scm,
  className: 'ItemSubCategoriesController',
  path: 'scm/item-sub-categories',
  type: R.subCategory,
  label: 'item sub-category',
  create: CreateItemSubCategoryDto,
  update: UpdateItemSubCategoryDto,
  response: ItemSubCategoryResponseDto,
  filter: ItemSubCategoryFilterDto,
});

export const ItemGroupsController = createRecordController({
  ...scm,
  className: 'ItemGroupsController',
  path: 'scm/item-groups',
  type: R.group,
  label: 'item group',
  create: CreateItemGroupDto,
  update: UpdateItemGroupDto,
  response: ItemGroupResponseDto,
});

export const ItemSubGroupsController = createRecordController({
  ...scm,
  className: 'ItemSubGroupsController',
  path: 'scm/item-sub-groups',
  type: R.subGroup,
  label: 'item sub-group',
  create: CreateItemSubGroupDto,
  update: UpdateItemSubGroupDto,
  response: ItemSubGroupResponseDto,
  filter: ItemSubGroupFilterDto,
});

export const ItemsController = createRecordController({
  ...scm,
  className: 'ItemsController',
  path: 'scm/items',
  type: R.item,
  label: 'item',
  create: CreateItemDto,
  update: UpdateItemDto,
  response: ItemResponseDto,
  filter: ItemFilterDto,
});

export const ItemVariantsController = createRecordController({
  ...scm,
  className: 'ItemVariantsController',
  path: 'scm/item-variants',
  type: R.variant,
  label: 'item variant',
  create: CreateItemVariantDto,
  update: UpdateItemVariantDto,
  response: ItemVariantResponseDto,
  filter: ItemVariantFilterDto,
});

export const RoleGroupRestrictionsController = createRecordController({
  ...scm,
  className: 'RoleGroupRestrictionsController',
  path: 'scm/role-group-restrictions',
  type: R.roleGroupRestriction,
  label: 'role group restriction',
  create: CreateRoleGroupRestrictionDto,
  update: UpdateRoleGroupRestrictionDto,
  response: RoleGroupRestrictionResponseDto,
  filter: RoleGroupRestrictionFilterDto,
});

export const SupplierTypesController = createRecordController({
  ...scm,
  className: 'SupplierTypesController',
  path: 'scm/supplier-types',
  type: R.supplierType,
  label: 'supplier type',
  create: CreateSupplierTypeDto,
  update: UpdateSupplierTypeDto,
  response: SupplierTypeResponseDto,
});

export const SuppliersController = createRecordController({
  ...scm,
  className: 'SuppliersController',
  path: 'scm/suppliers',
  type: R.supplier,
  label: 'supplier',
  create: CreateSupplierDto,
  update: UpdateSupplierDto,
  response: SupplierResponseDto,
  filter: SupplierFilterDto,
});

export const PurchaseApprovalLevelsController = createRecordController({
  ...scm,
  className: 'PurchaseApprovalLevelsController',
  path: 'scm/purchase-approval-levels',
  type: R.purchaseApprovalLevel,
  label: 'requisition approval level',
  create: CreatePurchaseApprovalLevelDto,
  update: UpdatePurchaseApprovalLevelDto,
  response: PurchaseApprovalLevelResponseDto,
  filter: PurchaseApprovalLevelFilterDto,
});

export const CsApprovalLevelsController = createRecordController({
  ...scm,
  className: 'CsApprovalLevelsController',
  path: 'scm/cs-approval-levels',
  type: R.csApprovalLevel,
  label: 'comparative study approval level',
  create: CreateCsApprovalLevelDto,
  update: UpdateCsApprovalLevelDto,
  response: CsApprovalLevelResponseDto,
});

export const SCM_RECORD_CONTROLLERS = [
  MainStoresController,
  SubStoresController,
  StoreDepartmentsController,
  DepartmentUsersController,
  DepartmentStoreAccessController,
  IssueStoreUsersController,
  ItemCategoriesController,
  ItemSubCategoriesController,
  ItemGroupsController,
  ItemSubGroupsController,
  ItemsController,
  ItemVariantsController,
  RoleGroupRestrictionsController,
  SupplierTypesController,
  SuppliersController,
  PurchaseApprovalLevelsController,
  CsApprovalLevelsController,
];
