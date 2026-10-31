import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { CorporateAccounts, type CreditClient } from '../../../../shared/application/contracts/corporate-accounts.js';
import { PharmacyCredit } from '../../../../shared/application/contracts/pharmacy-credit.js';
import { OpdBillRepository } from '../../domain/repositories.js';
import { corporateClients } from './hospital.schema.js';

/** The hospital's corporate clients as other modules sell to them on credit. */
@Injectable()
export class DrizzleCorporateAccounts extends CorporateAccounts {
  constructor(
    private readonly context: DbContext,
    private readonly bills: OpdBillRepository,
    private readonly pharmacy: PharmacyCredit,
  ) {
    super();
  }

  async lockForCredit(clientId: string): Promise<CreditClient | null> {
    const [row] = await this.client(clientId).for('update');
    return row ?? null;
  }

  async find(clientId: string): Promise<CreditClient | null> {
    const [row] = await this.client(clientId);
    return row ?? null;
  }

  private client(clientId: string) {
    return this.context.db
      .select({
        id: corporateClients.id,
        name: corporateClients.name,
        payment: corporateClients.payment,
        creditLimit: corporateClients.creditLimit,
        isActive: corporateClients.isActive,
      })
      .from(corporateClients)
      .where(eq(corporateClients.id, clientId));
  }

  async owed(clientId: string): Promise<number> {
    const hospital = await this.bills.corporateDue(clientId);
    const pharmacy = await this.pharmacy.corporateDue(clientId);
    return (Math.round(hospital * 100) + Math.round(pharmacy * 100)) / 100;
  }

  async names(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({ id: corporateClients.id, name: corporateClients.name })
      .from(corporateClients)
      .where(inArray(corporateClients.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}
