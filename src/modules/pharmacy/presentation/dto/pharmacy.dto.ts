import { z } from 'zod';
import {
  pageMetaShape,
  paginationShape,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const name = (max = 150) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const ref = z.uuid();
const money = z.number().min(0).max(999_999_999_999).multipleOf(0.01);
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

const SearchFilter = z.object({ q: search });

const genericGroup = shapes({ name: name(100), info: optionalText(500) }, ['info']);
export class CreateGenericGroupDto extends createZodDto(genericGroup.create) {}
export class UpdateGenericGroupDto extends createZodDto(genericGroup.update) {}
export class GenericGroupFilterDto extends createZodDto(SearchFilter) {}
export class GenericGroupResponseDto extends responseDto(genericGroup.response) {}

const generic = shapes({ name: name(200), groupId: ref.nullable(), info: optionalText(1000) }, ['groupId', 'info']);
export class CreateGenericDto extends createZodDto(generic.create) {}
export class UpdateGenericDto extends createZodDto(generic.update) {}
export class GenericFilterDto extends createZodDto(z.object({ groupId: ref.optional(), q: search })) {}
export class GenericResponseDto extends responseDto(generic.response) {}

const formation = shapes({ name: name(60), shortName: optionalText(20) }, ['shortName']);
export class CreateFormationDto extends createZodDto(formation.create) {}
export class UpdateFormationDto extends createZodDto(formation.update) {}
export class FormationFilterDto extends createZodDto(SearchFilter) {}
export class FormationResponseDto extends responseDto(formation.response) {}

/** Strengths, units, package units and manufacturers: a name only. */
const plain = (max: number) => shapes({ name: name(max) });
const strength = plain(60);
export class CreateStrengthDto extends createZodDto(strength.create) {}
export class UpdateStrengthDto extends createZodDto(strength.update) {}
export class StrengthFilterDto extends createZodDto(SearchFilter) {}
export class StrengthResponseDto extends responseDto(strength.response) {}

const unit = plain(30);
export class CreatePharmacyUnitDto extends createZodDto(unit.create) {}
export class UpdatePharmacyUnitDto extends createZodDto(unit.update) {}
export class PharmacyUnitFilterDto extends createZodDto(SearchFilter) {}
export class PharmacyUnitResponseDto extends responseDto(unit.response) {}

const packageUnit = plain(30);
export class CreatePackageUnitDto extends createZodDto(packageUnit.create) {}
export class UpdatePackageUnitDto extends createZodDto(packageUnit.update) {}
export class PackageUnitFilterDto extends createZodDto(SearchFilter) {}
export class PackageUnitResponseDto extends responseDto(packageUnit.response) {}

const manufacturer = plain(150);
export class CreateManufacturerDto extends createZodDto(manufacturer.create) {}
export class UpdateManufacturerDto extends createZodDto(manufacturer.update) {}
export class ManufacturerFilterDto extends createZodDto(SearchFilter) {}
export class ManufacturerResponseDto extends responseDto(manufacturer.response) {}

const brand = shapes({ name: name(150), manufacturerId: ref });
export class CreateBrandDto extends createZodDto(brand.create) {}
export class UpdateBrandDto extends createZodDto(brand.update) {}
export class BrandFilterDto extends createZodDto(z.object({ manufacturerId: ref.optional(), q: search })) {}
export class BrandResponseDto extends responseDto(brand.response) {}

const product = shapes(
  {
    brandId: ref,
    genericId: ref,
    formationId: ref,
    strengthId: ref.nullable(),
    unitId: ref.nullable(),
    packageUnitId: ref.nullable(),
    unitsPerPack: z.int().min(1).max(10_000),
    purchasePrice: money,
    salePrice: money,
    barcode: z.string().trim().min(1).max(64).nullable(),
    isActive: z.boolean(),
  },
  ['strengthId', 'unitId', 'packageUnitId', 'barcode'],
  { unitsPerPack: 1, purchasePrice: 0, salePrice: 0, isActive: true },
);
export class CreateProductDto extends createZodDto(product.create) {}
export class UpdateProductDto extends createZodDto(product.update) {}
export class ProductFilterDto extends createZodDto(
  z.object({
    brandId: ref.optional(),
    genericId: ref.optional(),
    formationId: ref.optional(),
    isActive: flag,
    barcode: z.string().trim().min(1).max(64).optional(),
  }),
) {}
export class ProductResponseDto extends responseDto(product.response) {}

const outlet = shapes(
  {
    name: name(100),
    code: z.string().trim().min(1).max(20).nullable(),
    description: optionalText(500),
    isActive: z.boolean(),
  },
  ['code', 'description'],
  { isActive: true },
);
export class CreateOutletDto extends createZodDto(outlet.create) {}
export class UpdateOutletDto extends createZodDto(outlet.update) {}
export class OutletFilterDto extends createZodDto(z.object({ isActive: flag })) {}
export class OutletResponseDto extends responseDto(outlet.response) {}

const outletUser = shapes({ outletId: ref, userId: ref });
export class CreateOutletUserDto extends createZodDto(outletUser.create) {}
export class UpdateOutletUserDto extends createZodDto(outletUser.update) {}
export class OutletUserFilterDto extends createZodDto(z.object({ outletId: ref.optional(), userId: ref.optional() })) {}
export class OutletUserResponseDto extends responseDto(outletUser.response) {}

const reorderLevel = shapes({ outletId: ref, productId: ref, level: z.int().min(0).max(10_000_000) });
export class CreateReorderLevelDto extends createZodDto(reorderLevel.create) {}
export class UpdateReorderLevelDto extends createZodDto(reorderLevel.update) {}
export class ReorderLevelFilterDto extends createZodDto(
  z.object({ outletId: ref.optional(), productId: ref.optional() }),
) {}
export class ReorderLevelResponseDto extends responseDto(reorderLevel.response) {}

const discountPercent = z.number().min(0).max(100).multipleOf(0.01);
const productDiscount = shapes(
  {
    productId: ref,
    isAllowed: z.boolean(),
    opdPercent: discountPercent.nullable(),
    ipdPercent: discountPercent.nullable(),
    remarks: optionalText(500),
  },
  ['opdPercent', 'ipdPercent', 'remarks'],
  { isAllowed: true },
);
export class CreateProductDiscountDto extends createZodDto(productDiscount.create) {}
export class UpdateProductDiscountDto extends createZodDto(productDiscount.update) {}
export class ProductDiscountFilterDto extends createZodDto(z.object({ productId: ref.optional(), isAllowed: flag })) {}
export class ProductDiscountResponseDto extends responseDto(productDiscount.response) {}

const loyalMember = shapes(
  {
    name: name(150),
    contactNo: z.string().trim().min(3).max(20),
    referenceName: optionalText(150),
    remarks: optionalText(500),
    isActive: z.boolean(),
  },
  ['referenceName', 'remarks'],
  { isActive: true },
);
export class CreateLoyalMemberDto extends createZodDto(loyalMember.create) {}
export class UpdateLoyalMemberDto extends createZodDto(loyalMember.update) {}
export class LoyalMemberFilterDto extends createZodDto(
  z.object({ isActive: flag, contactNo: z.string().trim().min(1).max(20).optional(), q: search }),
) {}
export class LoyalMemberResponseDto extends responseDto(loyalMember.response) {}

// The catalogue: products with their names put together, for search and pick lists.

export class CatalogueQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    q: search,
    genericId: ref.optional(),
    manufacturerId: ref.optional(),
    formationId: ref.optional(),
    isActive: flag,
  }),
) {}

export const catalogueEntryShape = {
  id: z.uuid(),
  displayName: z.string(),
  brandName: z.string(),
  formationName: z.string(),
  formationShortName: z.string().nullable(),
  strength: z.string().nullable(),
  genericName: z.string(),
  genericGroupName: z.string().nullable(),
  manufacturerName: z.string(),
  unitName: z.string().nullable(),
  packageUnitName: z.string().nullable(),
  unitsPerPack: z.int(),
  purchasePrice: z.number(),
  salePrice: z.number(),
  barcode: z.string().nullable(),
  isActive: z.boolean(),
};
export class CatalogueResponseDto extends responseDto({
  items: z.array(z.object(catalogueEntryShape)),
  ...pageMetaShape,
}) {}
