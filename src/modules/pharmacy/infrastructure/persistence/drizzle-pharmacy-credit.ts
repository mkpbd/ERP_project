import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { PharmacyCredit } from '../../../../shared/application/contracts/pharmacy-credit.js';
import { pharmacySales } from './pharmacy.schema.js';

/** What companies owe the pharmacy, for the hospital's credit limit. */
@Injectable()
export class DrizzlePharmacyCredit extends PharmacyCredit {
  constructor(private readonly context: DbContext) {
    super();
  }

  async corporateDue(clientId: string): Promise<number> {
    const [row] = await this.context.db
      .select({
        due: sql<number>`coalesce(sum(${pharmacySales.due} - ${pharmacySales.collected} - ${pharmacySales.dueReturned}), 0)`.mapWith(
          Number,
        ),
      })
      .from(pharmacySales)
      .where(and(eq(pharmacySales.corporateClientId, clientId), eq(pharmacySales.status, 'completed')));
    return Math.round((row?.due ?? 0) * 100) / 100;
  }
}
