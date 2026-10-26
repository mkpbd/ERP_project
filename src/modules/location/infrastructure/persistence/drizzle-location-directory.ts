import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { LocationDirectory } from '../../../../shared/application/contracts/location-directory.js';
import { countries, districts } from './location.schema.js';

@Injectable()
export class DrizzleLocationDirectory extends LocationDirectory {
  constructor(private readonly context: DbContext) {
    super();
  }

  async nationality(countryId: string): Promise<string | null> {
    const [row] = await this.context.db
      .select({ nationality: countries.nationality })
      .from(countries)
      .where(eq(countries.id, countryId));
    return row?.nationality || null;
  }

  async districtNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({ id: districts.id, name: districts.name })
      .from(districts)
      .where(inArray(districts.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
