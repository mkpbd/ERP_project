import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ReagentRepository, type ReagentUse } from '../../domain/repositories.js';
import { labReagentUses, labStockDepartments, labTestReagents } from './laboratory.schema.js';

@Injectable()
export class DrizzleReagentRepository extends ReagentRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  recipe(testId: string) {
    return this.context.db
      .select({ variantId: labTestReagents.variantId, qty: labTestReagents.qty })
      .from(labTestReagents)
      .where(eq(labTestReagents.testId, testId))
      .orderBy(asc(labTestReagents.variantId));
  }

  async setRecipe(testId: string, lines: readonly { variantId: string; qty: number }[]): Promise<void> {
    await this.context.db.delete(labTestReagents).where(eq(labTestReagents.testId, testId));
    if (lines.length > 0) {
      await this.context.db.insert(labTestReagents).values(lines.map((line) => ({ ...line, testId })));
    }
  }

  stockDepartments() {
    return this.context.db
      .select({
        diagnosticDepartmentId: labStockDepartments.diagnosticDepartmentId,
        storeDepartmentId: labStockDepartments.storeDepartmentId,
      })
      .from(labStockDepartments);
  }

  async setStockDepartments(
    pairs: readonly { diagnosticDepartmentId: string; storeDepartmentId: string }[],
  ): Promise<void> {
    await this.context.db.delete(labStockDepartments);
    if (pairs.length > 0) await this.context.db.insert(labStockDepartments).values([...pairs]);
  }

  async storeOf(diagnosticDepartmentId: string): Promise<string | null> {
    const [row] = await this.context.db
      .select({ storeDepartmentId: labStockDepartments.storeDepartmentId })
      .from(labStockDepartments)
      .where(eq(labStockDepartments.diagnosticDepartmentId, diagnosticDepartmentId));
    return row?.storeDepartmentId ?? null;
  }

  async addUses(uses: readonly ReagentUse[]): Promise<void> {
    if (uses.length > 0) {
      await this.context.db.insert(labReagentUses).values(uses.map((use) => ({ ...use, id: randomUUID() })));
    }
  }
}
