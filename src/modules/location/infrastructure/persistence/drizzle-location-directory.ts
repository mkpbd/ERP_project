import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { LocationDirectory } from '../../../../shared/application/contracts/location-directory.js';
import { countries } from './location.schema.js';

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
}
