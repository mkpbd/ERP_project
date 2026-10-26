import { z } from 'zod';
import { recordResponseShape, responseDto, updateSchema } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const name = (max = 150) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const ref = z.uuid();
const money = z.number().min(0).max(999_999_999_999).multipleOf(0.01);
const percent = z.number().min(0).max(100).multipleOf(0.01);
const flag = z.enum(['true', 'false']).optional();
const search = z.string().trim().min(1).max(100).optional();

/**
 * Create (nullable fields default to null, others to the given defaults), update (all optional) and response
 * shapes of a record.
 */
function shapes<T extends z.ZodRawShape>(
  fields: T,
  nullable: (keyof T)[] = [],
  defaults: Partial<Record<keyof T, unknown>> = {},
) {
  const create = Object.fromEntries(
    Object.entries(fields).map(([key, schema]) => [
      key,
      nullable.includes(key)
        ? (schema as z.ZodNullable<z.ZodTypeAny>).default(null)
        : key in defaults
          ? (schema as z.ZodTypeAny).default(defaults[key])
          : schema,
    ]),
  ) as T;
  return { create: z.strictObject(create), update: updateSchema(fields), response: recordResponseShape(fields) };
}

const mainStore = shapes({ name: name(100), description: optionalText(500) }, ['description']);
export class CreateMainStoreDto extends createZodDto(mainStore.create) {}
export class UpdateMainStoreDto extends createZodDto(mainStore.update) {}
export class MainStoreResponseDto extends responseDto(mainStore.response) {}

const subStore = shapes({ mainStoreId: ref, name: name(100), description: optionalText(500) }, ['description']);
export class CreateSubStoreDto extends createZodDto(subStore.create) {}
export class UpdateSubStoreDto extends createZodDto(subStore.update) {}
export class SubStoreFilterDto extends createZodDto(z.object({ mainStoreId: ref.optional() })) {}
export class SubStoreResponseDto extends responseDto(subStore.response) {}

const department = shapes({ name: name(100) });
export class CreateStoreDepartmentDto extends createZodDto(department.create) {}
export class UpdateStoreDepartmentDto extends createZodDto(department.update) {}
export class StoreDepartmentResponseDto extends responseDto(department.response) {}

const departmentUser = shapes({ departmentId: ref, userId: ref });
export class CreateDepartmentUserDto extends createZodDto(departmentUser.create) {}
export class UpdateDepartmentUserDto extends createZodDto(departmentUser.update) {}
export class DepartmentUserFilterDto extends createZodDto(
  z.object({ departmentId: ref.optional(), userId: ref.optional() }),
) {}
export class DepartmentUserResponseDto extends responseDto(departmentUser.response) {}

const storeAccess = shapes({ departmentId: ref, subStoreId: ref, userId: ref });
export class CreateDepartmentStoreAccessDto extends createZodDto(storeAccess.create) {}
export class UpdateDepartmentStoreAccessDto extends createZodDto(storeAccess.update) {}
export class DepartmentStoreAccessFilterDto extends createZodDto(
  z.object({ departmentId: ref.optional(), subStoreId: ref.optional(), userId: ref.optional() }),
) {}
export class DepartmentStoreAccessResponseDto extends responseDto(storeAccess.response) {}

const issueUser = shapes({ subStoreId: ref, userId: ref });
export class CreateIssueStoreUserDto extends createZodDto(issueUser.create) {}
export class UpdateIssueStoreUserDto extends createZodDto(issueUser.update) {}
export class IssueStoreUserFilterDto extends createZodDto(
  z.object({ subStoreId: ref.optional(), userId: ref.optional() }),
) {}
export class IssueStoreUserResponseDto extends responseDto(issueUser.response) {}

const category = shapes({ name: name() });
export class CreateItemCategoryDto extends createZodDto(category.create) {}
export class UpdateItemCategoryDto extends createZodDto(category.update) {}
export class ItemCategoryResponseDto extends responseDto(category.response) {}

const subCategory = shapes({ categoryId: ref, name: name() });
export class CreateItemSubCategoryDto extends createZodDto(subCategory.create) {}
export class UpdateItemSubCategoryDto extends createZodDto(subCategory.update) {}
export class ItemSubCategoryFilterDto extends createZodDto(z.object({ categoryId: ref.optional() })) {}
export class ItemSubCategoryResponseDto extends responseDto(subCategory.response) {}

const group = shapes({ name: name() });
export class CreateItemGroupDto extends createZodDto(group.create) {}
export class UpdateItemGroupDto extends createZodDto(group.update) {}
export class ItemGroupResponseDto extends responseDto(group.response) {}

const subGroup = shapes({ groupId: ref, name: name() });
export class CreateItemSubGroupDto extends createZodDto(subGroup.create) {}
export class UpdateItemSubGroupDto extends createZodDto(subGroup.update) {}
export class ItemSubGroupFilterDto extends createZodDto(z.object({ groupId: ref.optional() })) {}
export class ItemSubGroupResponseDto extends responseDto(subGroup.response) {}

const item = shapes(
  {
    name: name(200),
    subGroupId: ref,
    subCategoryId: ref,
    unit: z.string().trim().min(1).max(30),
    typeGlAccountId: ref.nullable(),
    isAsset: z.boolean(),
    isActive: z.boolean(),
  },
  ['typeGlAccountId'],
  { isAsset: false, isActive: true },
);
export class CreateItemDto extends createZodDto(item.create) {}
export class UpdateItemDto extends createZodDto(item.update) {}
export class ItemFilterDto extends createZodDto(
  z.object({ subGroupId: ref.optional(), subCategoryId: ref.optional(), isAsset: flag, isActive: flag, q: search }),
) {}
export class ItemResponseDto extends responseDto(item.response) {}

const variant = shapes(
  {
    itemId: ref,
    name: name(200),
    code: z.string().trim().min(1).max(50).nullable(),
    alternateName: optionalText(200),
    specification: optionalText(200),
    purchasePrice: money,
    salePrice: money,
    reorderLevel: z.int().min(0).max(1_000_000),
    expiryRequired: z.boolean(),
    isActive: z.boolean(),
  },
  ['code', 'alternateName', 'specification'],
  { purchasePrice: 0, salePrice: 0, reorderLevel: 0, expiryRequired: false, isActive: true },
);
export class CreateItemVariantDto extends createZodDto(variant.create) {}
export class UpdateItemVariantDto extends createZodDto(variant.update) {}
export class ItemVariantFilterDto extends createZodDto(
  z.object({ itemId: ref.optional(), isActive: flag, q: search }),
) {}
export class ItemVariantResponseDto extends responseDto(variant.response) {}

const restriction = shapes({ roleId: ref, groupId: ref });
export class CreateRoleGroupRestrictionDto extends createZodDto(restriction.create) {}
export class UpdateRoleGroupRestrictionDto extends createZodDto(restriction.update) {}
export class RoleGroupRestrictionFilterDto extends createZodDto(
  z.object({ roleId: ref.optional(), groupId: ref.optional() }),
) {}
export class RoleGroupRestrictionResponseDto extends responseDto(restriction.response) {}

const supplierType = shapes({ name: name(100) });
export class CreateSupplierTypeDto extends createZodDto(supplierType.create) {}
export class UpdateSupplierTypeDto extends createZodDto(supplierType.update) {}
export class SupplierTypeResponseDto extends responseDto(supplierType.response) {}

const supplierFields = {
  typeId: ref,
  name: name(200),
  address: optionalText(500),
  contactNo: optionalText(50),
  email: z.email().max(254).nullable(),
  isEnlisted: z.boolean(),
  enlistedOn: day.nullable(),
  enlistmentExpiresOn: day.nullable(),
  vatPercent: percent,
  taxPercent: percent,
  isManufacturer: z.boolean(),
  glAccountId: ref.nullable(),
  subLedgerId: ref.nullable(),
  isActive: z.boolean(),
};
const supplier = shapes(
  supplierFields,
  ['address', 'contactNo', 'email', 'enlistedOn', 'enlistmentExpiresOn', 'glAccountId', 'subLedgerId'],
  { isEnlisted: false, vatPercent: 0, taxPercent: 0, isManufacturer: false, isActive: true },
);
export class CreateSupplierDto extends createZodDto(
  supplier.create.refine(
    (value) => !value.enlistedOn || !value.enlistmentExpiresOn || value.enlistmentExpiresOn >= value.enlistedOn,
    { message: 'The enlistment expires before it starts', path: ['enlistmentExpiresOn'] },
  ),
) {}
export class UpdateSupplierDto extends createZodDto(supplier.update) {}
export class SupplierFilterDto extends createZodDto(
  z.object({ typeId: ref.optional(), isEnlisted: flag, isManufacturer: flag, isActive: flag, q: search }),
) {}
export class SupplierResponseDto extends responseDto(
  recordResponseShape({
    ...supplierFields,
    enlistedOn: z.string().nullable(),
    enlistmentExpiresOn: z.string().nullable(),
  }),
) {}

const levelOrder = z.int().min(1).max(20);
const purchaseLevel = shapes({ mainStoreId: ref, levelOrder, name: name(50), roleId: ref });
export class CreatePurchaseApprovalLevelDto extends createZodDto(purchaseLevel.create) {}
export class UpdatePurchaseApprovalLevelDto extends createZodDto(purchaseLevel.update) {}
export class PurchaseApprovalLevelFilterDto extends createZodDto(z.object({ mainStoreId: ref.optional() })) {}
export class PurchaseApprovalLevelResponseDto extends responseDto(purchaseLevel.response) {}

const csLevel = shapes({ levelOrder, name: name(50), approverStaffId: ref, isFinal: z.boolean() }, [], {
  isFinal: false,
});
export class CreateCsApprovalLevelDto extends createZodDto(csLevel.create) {}
export class UpdateCsApprovalLevelDto extends createZodDto(csLevel.update) {}
export class CsApprovalLevelResponseDto extends responseDto(csLevel.response) {}

const indentLevel = shapes({ subStoreId: ref, levelOrder, name: name(50), roleId: ref });
export class CreateIndentApprovalLevelDto extends createZodDto(indentLevel.create) {}
export class UpdateIndentApprovalLevelDto extends createZodDto(indentLevel.update) {}
export class IndentApprovalLevelFilterDto extends createZodDto(z.object({ subStoreId: ref.optional() })) {}
export class IndentApprovalLevelResponseDto extends responseDto(indentLevel.response) {}
