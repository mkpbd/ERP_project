import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { DepartmentStock, type StockItem } from '../../../../shared/application/contracts/department-stock.js';
import { DomainError } from '../../../../shared/domain/errors.js';
import { DepartmentDesk } from '../../application/department.handlers.js';
import { DepartmentConsumption } from '../../domain/department.js';
import { items, itemVariants, storeDepartments } from './supply-chain.schema.js';

/** The store departments' stock as other modules use it up. */
@Injectable()
export class DrizzleDepartmentStock extends DepartmentStock {
  constructor(
    private readonly context: DbContext,
    private readonly departmentsDesk: DepartmentDesk,
  ) {
    super();
  }

  async items(variantIds: readonly string[]): Promise<Map<string, StockItem>> {
    if (variantIds.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        id: itemVariants.id,
        name: sql<string>`${items.name} || ' — ' || ${itemVariants.name}`,
        unit: items.unit,
        isActive: sql<boolean>`${items.isActive} and ${itemVariants.isActive}`,
        isAsset: items.isAsset,
      })
      .from(itemVariants)
      .innerJoin(items, eq(items.id, itemVariants.itemId))
      .where(inArray(itemVariants.id, [...new Set(variantIds)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async departments(ids: readonly string[]) {
    if (ids.length === 0) return new Map<string, { id: string; name: string }>();
    const rows = await this.context.db
      .select({ id: storeDepartments.id, name: storeDepartments.name })
      .from(storeDepartments)
      .where(inArray(storeDepartments.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  /**
   * Old ReAgent auto-consumption (TestAndRegAgentMappings): a department consumption like one entered by hand. The
   * stock is taken first; when it falls short nothing is written (its number stays unused), and null tells the caller.
   */
  async consume(params: {
    departmentId: string;
    on: string;
    note: string;
    lines: readonly { variantId: string; qty: number }[];
    by: string;
  }): Promise<{ number: string } | null> {
    const { desk, stores, consumptions } = this.departmentsDesk;
    const consumption = DepartmentConsumption.post({
      id: randomUUID(),
      number: await desk.number('DC', params.on),
      departmentId: params.departmentId,
      consumedOn: params.on,
      note: params.note,
      lines: params.lines.map((line) => ({ ...line, lotId: null })),
      createdBy: params.by,
      now: desk.clock.now(),
    });
    try {
      await stores.keeper.takeOut(
        { departmentId: params.departmentId },
        consumption.lines,
        { id: consumption.id, number: consumption.number, on: params.on },
        'consumption',
      );
    } catch (error) {
      if (error instanceof DomainError && error.code === 'insufficient_stock') return null;
      throw error;
    }
    await consumptions.insert(consumption);
    return { number: consumption.number };
  }
}
