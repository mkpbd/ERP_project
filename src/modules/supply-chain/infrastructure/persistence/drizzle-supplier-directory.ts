import { Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  SupplierDirectory,
  type SupplierSummary,
} from '../../../../shared/application/contracts/supplier-directory.js';
import { suppliers } from './supply-chain.schema.js';

@Injectable()
export class DrizzleSupplierDirectory extends SupplierDirectory {
  constructor(private readonly context: DbContext) {
    super();
  }

  async find(ids: readonly string[]): Promise<SupplierSummary[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    return this.context.db
      .select({
        id: suppliers.id,
        name: suppliers.name,
        address: suppliers.address,
        isActive: suppliers.isActive,
        glAccountId: suppliers.glAccountId,
        subLedgerId: suppliers.subLedgerId,
      })
      .from(suppliers)
      .where(inArray(suppliers.id, unique));
  }
}
