import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { LotCorrectionRepository, type LotCorrectionRow, type StockedLot } from '../../domain/repositories.js';
import { pharmacyLotCorrections, pharmacyLots, pharmacyMovements } from './pharmacy.schema.js';

@Injectable()
export class DrizzleLotCorrectionRepository extends LotCorrectionRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async lot(id: string): Promise<StockedLot | null> {
    const [row] = await this.context.db
      .select({
        id: pharmacyLots.id,
        productId: pharmacyLots.productId,
        batchNo: pharmacyLots.batchNo,
        expiryDate: pharmacyLots.expiryDate,
        saleRate: pharmacyLots.saleRate,
      })
      .from(pharmacyLots)
      .where(eq(pharmacyLots.id, id));
    return row ?? null;
  }

  async holdings(lotId: string): Promise<{ outletId: string; qty: number }[]> {
    const qty = sql<number>`sum(${pharmacyMovements.qty})`.mapWith(Number);
    return this.context.db
      .select({ outletId: pharmacyMovements.outletId, qty })
      .from(pharmacyMovements)
      .where(eq(pharmacyMovements.lotId, lotId))
      .groupBy(pharmacyMovements.outletId)
      .having(sql`sum(${pharmacyMovements.qty}) > 0`);
  }

  async insert(row: LotCorrectionRow): Promise<void> {
    await this.context.db.insert(pharmacyLotCorrections).values(row);
  }
}
