import { Controller, Get, Query } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { SearchCatalogueQuery } from '../application/catalogue.handlers.js';
import { PHARMACY_RECORDS as R } from '../application/pharmacy.constants.js';
import {
  BrandFilterDto,
  BrandResponseDto,
  CatalogueQueryDto,
  CatalogueResponseDto,
  CreateBrandDto,
  CreateFormationDto,
  CreateGenericDto,
  CreateGenericGroupDto,
  CreateLoyalMemberDto,
  CreateProductDiscountDto,
  CreateManufacturerDto,
  CreateOutletDto,
  CreateOutletUserDto,
  CreatePackageUnitDto,
  CreatePharmacyUnitDto,
  CreateProductDto,
  CreateReorderLevelDto,
  CreateStrengthDto,
  FormationFilterDto,
  FormationResponseDto,
  GenericFilterDto,
  GenericGroupFilterDto,
  GenericGroupResponseDto,
  GenericResponseDto,
  LoyalMemberFilterDto,
  LoyalMemberResponseDto,
  ProductDiscountFilterDto,
  ProductDiscountResponseDto,
  ManufacturerFilterDto,
  ManufacturerResponseDto,
  OutletFilterDto,
  OutletResponseDto,
  OutletUserFilterDto,
  OutletUserResponseDto,
  PackageUnitFilterDto,
  PackageUnitResponseDto,
  PharmacyUnitFilterDto,
  PharmacyUnitResponseDto,
  ProductFilterDto,
  ProductResponseDto,
  ReorderLevelFilterDto,
  ReorderLevelResponseDto,
  StrengthFilterDto,
  StrengthResponseDto,
  UpdateBrandDto,
  UpdateFormationDto,
  UpdateGenericDto,
  UpdateGenericGroupDto,
  UpdateLoyalMemberDto,
  UpdateProductDiscountDto,
  UpdateManufacturerDto,
  UpdateOutletDto,
  UpdateOutletUserDto,
  UpdatePackageUnitDto,
  UpdatePharmacyUnitDto,
  UpdateProductDto,
  UpdateReorderLevelDto,
  UpdateStrengthDto,
} from './dto/pharmacy.dto.js';

const pharmacy = { tag: 'pharmacy', readPermission: 'pharmacy:read', managePermission: 'pharmacy:manage' } as const;

export const GenericGroupsController = createRecordController({
  ...pharmacy,
  className: 'GenericGroupsController',
  path: 'pharmacy/generic-groups',
  type: R.genericGroup,
  label: 'generic group',
  create: CreateGenericGroupDto,
  update: UpdateGenericGroupDto,
  response: GenericGroupResponseDto,
  filter: GenericGroupFilterDto,
});

export const GenericsController = createRecordController({
  ...pharmacy,
  className: 'GenericsController',
  path: 'pharmacy/generics',
  type: R.generic,
  label: 'generic',
  create: CreateGenericDto,
  update: UpdateGenericDto,
  response: GenericResponseDto,
  filter: GenericFilterDto,
});

export const FormationsController = createRecordController({
  ...pharmacy,
  className: 'FormationsController',
  path: 'pharmacy/formations',
  type: R.formation,
  label: 'formation',
  create: CreateFormationDto,
  update: UpdateFormationDto,
  response: FormationResponseDto,
  filter: FormationFilterDto,
});

export const StrengthsController = createRecordController({
  ...pharmacy,
  className: 'StrengthsController',
  path: 'pharmacy/strengths',
  type: R.strength,
  label: 'strength',
  create: CreateStrengthDto,
  update: UpdateStrengthDto,
  response: StrengthResponseDto,
  filter: StrengthFilterDto,
});

export const PharmacyUnitsController = createRecordController({
  ...pharmacy,
  className: 'PharmacyUnitsController',
  path: 'pharmacy/units',
  type: R.unit,
  label: 'unit',
  create: CreatePharmacyUnitDto,
  update: UpdatePharmacyUnitDto,
  response: PharmacyUnitResponseDto,
  filter: PharmacyUnitFilterDto,
});

export const PackageUnitsController = createRecordController({
  ...pharmacy,
  className: 'PackageUnitsController',
  path: 'pharmacy/package-units',
  type: R.packageUnit,
  label: 'package unit',
  create: CreatePackageUnitDto,
  update: UpdatePackageUnitDto,
  response: PackageUnitResponseDto,
  filter: PackageUnitFilterDto,
});

export const ManufacturersController = createRecordController({
  ...pharmacy,
  className: 'ManufacturersController',
  path: 'pharmacy/manufacturers',
  type: R.manufacturer,
  label: 'manufacturer',
  create: CreateManufacturerDto,
  update: UpdateManufacturerDto,
  response: ManufacturerResponseDto,
  filter: ManufacturerFilterDto,
});

export const BrandsController = createRecordController({
  ...pharmacy,
  className: 'BrandsController',
  path: 'pharmacy/brands',
  type: R.brand,
  label: 'brand',
  create: CreateBrandDto,
  update: UpdateBrandDto,
  response: BrandResponseDto,
  filter: BrandFilterDto,
});

export const ProductsController = createRecordController({
  ...pharmacy,
  className: 'ProductsController',
  path: 'pharmacy/products',
  type: R.product,
  label: 'product',
  create: CreateProductDto,
  update: UpdateProductDto,
  response: ProductResponseDto,
  filter: ProductFilterDto,
});

export const OutletsController = createRecordController({
  ...pharmacy,
  className: 'OutletsController',
  path: 'pharmacy/outlets',
  type: R.outlet,
  label: 'outlet',
  create: CreateOutletDto,
  update: UpdateOutletDto,
  response: OutletResponseDto,
  filter: OutletFilterDto,
});

export const OutletUsersController = createRecordController({
  ...pharmacy,
  className: 'OutletUsersController',
  path: 'pharmacy/outlet-users',
  type: R.outletUser,
  label: 'outlet user',
  create: CreateOutletUserDto,
  update: UpdateOutletUserDto,
  response: OutletUserResponseDto,
  filter: OutletUserFilterDto,
});

export const ProductDiscountsController = createRecordController({
  ...pharmacy,
  className: 'ProductDiscountsController',
  path: 'pharmacy/product-discounts',
  type: R.productDiscount,
  label: 'product discount',
  create: CreateProductDiscountDto,
  update: UpdateProductDiscountDto,
  response: ProductDiscountResponseDto,
  filter: ProductDiscountFilterDto,
});

export const LoyalMembersController = createRecordController({
  ...pharmacy,
  className: 'LoyalMembersController',
  path: 'pharmacy/loyal-members',
  type: R.loyalMember,
  label: 'loyal member',
  create: CreateLoyalMemberDto,
  update: UpdateLoyalMemberDto,
  response: LoyalMemberResponseDto,
  filter: LoyalMemberFilterDto,
});

export const ReorderLevelsController = createRecordController({
  ...pharmacy,
  className: 'ReorderLevelsController',
  path: 'pharmacy/reorder-levels',
  type: R.reorderLevel,
  label: 'reorder level',
  create: CreateReorderLevelDto,
  update: UpdateReorderLevelDto,
  response: ReorderLevelResponseDto,
  filter: ReorderLevelFilterDto,
});

@ApiTags('pharmacy')
@ApiBearerAuth()
@Controller({ path: 'pharmacy/catalogue', version: '1' })
export class CatalogueController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @RequirePermissions('pharmacy:read')
  @ApiOperation({
    summary: 'Products with brand, formation, strength, generic and manufacturer names (search, pick lists)',
  })
  @ApiOkResponse({ type: CatalogueResponseDto })
  search(@CurrentUser() actor: Actor, @Query() query: CatalogueQueryDto) {
    const { isActive, ...filter } = query;
    return this.queryBus.execute(
      new SearchCatalogueQuery(actor, {
        ...filter,
        isActive: isActive === undefined ? undefined : isActive === 'true',
      }),
    );
  }
}

export const PHARMACY_CONTROLLERS = [
  GenericGroupsController,
  GenericsController,
  FormationsController,
  StrengthsController,
  PharmacyUnitsController,
  PackageUnitsController,
  ManufacturersController,
  BrandsController,
  ProductsController,
  OutletsController,
  OutletUsersController,
  ReorderLevelsController,
  ProductDiscountsController,
  LoyalMembersController,
  CatalogueController,
];
