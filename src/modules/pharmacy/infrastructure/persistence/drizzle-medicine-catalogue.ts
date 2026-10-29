import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { MedicineCatalogue, type Medicine } from '../../../../shared/application/contracts/medicine-catalogue.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { displayName } from '../../application/catalogue.handlers.js';
import { brands, formations, generics, manufacturers, products, strengths } from './pharmacy.schema.js';

/** The pharmacy's products as a prescription names them. */
@Injectable()
export class DrizzleMedicineCatalogue extends MedicineCatalogue {
  constructor(private readonly context: DbContext) {
    super();
  }

  private async select(where: SQL, order: SQL[] = [], limit?: number): Promise<Medicine[]> {
    const query = this.context.db
      .select({
        id: products.id,
        brandName: brands.name,
        formationName: formations.name,
        formationShortName: formations.shortName,
        strength: strengths.name,
        manufacturerName: manufacturers.name,
        genericId: generics.id,
        genericName: generics.name,
        isActive: products.isActive,
      })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .innerJoin(manufacturers, eq(manufacturers.id, brands.manufacturerId))
      .innerJoin(formations, eq(formations.id, products.formationId))
      .innerJoin(generics, eq(generics.id, products.genericId))
      .leftJoin(strengths, eq(strengths.id, products.strengthId))
      .where(where)
      .orderBy(...order);
    const rows = limit === undefined ? await query : await query.limit(limit);
    return rows.map((row) => ({
      id: row.id,
      name: displayName(row),
      genericId: row.genericId,
      genericName: row.genericName,
      isActive: row.isActive,
    }));
  }

  async find(ids: readonly string[]): Promise<Map<string, Medicine>> {
    if (ids.length === 0) return new Map();
    const rows = await this.select(inArray(products.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  search(text: string, limit: number): Promise<Medicine[]> {
    const term = escapeLike(text.trim());
    return this.select(
      and(eq(products.isActive, true), or(ilike(brands.name, `%${term}%`), ilike(generics.name, `%${term}%`)))!,
      [sql`${brands.name} not ilike ${`${term}%`}`, asc(brands.name), asc(formations.name)],
      limit,
    );
  }
}
