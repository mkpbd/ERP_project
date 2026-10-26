import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, or } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  CatalogueReadRepository,
  displayName,
  type CatalogueEntry,
  type CatalogueFilter,
} from '../../application/catalogue.handlers.js';
import {
  brands,
  formations,
  genericGroups,
  generics,
  manufacturers,
  packageUnits,
  products,
  strengths,
  units,
} from './pharmacy.schema.js';

@Injectable()
export class DrizzleCatalogueReadRepository extends CatalogueReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async search(filter: CatalogueFilter): Promise<Page<CatalogueEntry>> {
    const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
    const where = and(
      like ? or(ilike(brands.name, like), ilike(generics.name, like), ilike(products.barcode, like)) : undefined,
      filter.genericId ? eq(products.genericId, filter.genericId) : undefined,
      filter.manufacturerId ? eq(brands.manufacturerId, filter.manufacturerId) : undefined,
      filter.formationId ? eq(products.formationId, filter.formationId) : undefined,
      filter.isActive === undefined ? undefined : eq(products.isActive, filter.isActive),
    );
    const base = () =>
      this.context.db
        .select({
          id: products.id,
          brandName: brands.name,
          formationName: formations.name,
          formationShortName: formations.shortName,
          strength: strengths.name,
          genericName: generics.name,
          genericGroupName: genericGroups.name,
          manufacturerName: manufacturers.name,
          unitName: units.name,
          packageUnitName: packageUnits.name,
          unitsPerPack: products.unitsPerPack,
          purchasePrice: products.purchasePrice,
          salePrice: products.salePrice,
          barcode: products.barcode,
          isActive: products.isActive,
        })
        .from(products)
        .innerJoin(brands, eq(brands.id, products.brandId))
        .innerJoin(manufacturers, eq(manufacturers.id, brands.manufacturerId))
        .innerJoin(generics, eq(generics.id, products.genericId))
        .innerJoin(formations, eq(formations.id, products.formationId))
        .leftJoin(genericGroups, eq(genericGroups.id, generics.groupId))
        .leftJoin(strengths, eq(strengths.id, products.strengthId))
        .leftJoin(units, eq(units.id, products.unitId))
        .leftJoin(packageUnits, eq(packageUnits.id, products.packageUnitId));
    const [rows, [total]] = await Promise.all([
      base()
        .where(where)
        .orderBy(asc(brands.name), asc(formations.name), asc(strengths.name))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db
        .select({ n: count() })
        .from(products)
        .innerJoin(brands, eq(brands.id, products.brandId))
        .innerJoin(generics, eq(generics.id, products.genericId))
        .where(where),
    ]);
    return toPage(
      rows.map((row) => ({ ...row, displayName: displayName(row) })),
      total?.n ?? 0,
      filter,
    );
  }
}
