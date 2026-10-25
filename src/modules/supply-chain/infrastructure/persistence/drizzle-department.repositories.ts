import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { foreignKeyViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { DepartmentAdjustment, DepartmentConsumption, DepartmentReturn } from '../../domain/department.js';
import {
  AdjustmentRepository,
  ConsumptionRepository,
  DepartmentReturnRepository,
  GatePassRepository,
  SupplierReturnRepository,
  type NewGatePass,
} from '../../domain/repositories.js';
import { SupplierReturn } from '../../domain/supplier-return.js';
import {
  departmentAdjustmentLines,
  departmentAdjustments,
  departmentConsumptionLines,
  departmentConsumptions,
  departmentReturnLines,
  departmentReturns,
  gatePasses,
  supplierReturnLines,
  supplierReturns,
} from './supply-chain.schema.js';

/** Missing references, by the referenced table (names may come back shortened to 63 characters). */
const REFERENCED: [string, string][] = [
  ['store_departments', 'store_department'],
  ['sub_stores', 'sub_store'],
  ['main_stores', 'main_store'],
  ['suppliers', 'supplier'],
  ['item_variants', 'item_variant'],
  ['stock_lots', 'stock_lot'],
];

async function translated<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const reference = foreignKeyViolationConstraint(error);
    if (reference !== null) {
      const name = REFERENCED.find(
        ([table]) => reference.includes(`_${table}_id_fk`) || reference.endsWith(`_${table}`),
      );
      throw new NotFoundError(name?.[1] ?? 'referenced_record');
    }
    throw error;
  }
}

const withPositions = <T, K extends string>(lines: readonly T[], key: K, id: string) =>
  lines.map((line, position) => ({ ...line, [key]: id, position }) as T & Record<K, string> & { position: number });

@Injectable()
export class DrizzleConsumptionRepository extends ConsumptionRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<DepartmentConsumption | null> {
    const [row] = await this.context.db
      .select()
      .from(departmentConsumptions)
      .where(eq(departmentConsumptions.id, id))
      .for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(departmentConsumptionLines)
      .where(eq(departmentConsumptionLines.consumptionId, id))
      .orderBy(asc(departmentConsumptionLines.position));
    return DepartmentConsumption.restore({
      ...row,
      lines: lines.map(({ consumptionId: _id, position: _position, ...line }) => line),
    });
  }

  async insert(consumption: DepartmentConsumption): Promise<void> {
    const { lines, ...row } = consumption.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(departmentConsumptions).values(row);
      await this.context.db.insert(departmentConsumptionLines).values(withPositions(lines, 'consumptionId', row.id));
    });
  }

  async update(consumption: DepartmentConsumption): Promise<void> {
    const { lines: _lines, ...row } = consumption.toSnapshot();
    await this.context.db.update(departmentConsumptions).set(row).where(eq(departmentConsumptions.id, row.id));
  }
}

@Injectable()
export class DrizzleDepartmentReturnRepository extends DepartmentReturnRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<DepartmentReturn | null> {
    const [row] = await this.context.db
      .select()
      .from(departmentReturns)
      .where(eq(departmentReturns.id, id))
      .for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(departmentReturnLines)
      .where(eq(departmentReturnLines.returnId, id))
      .orderBy(asc(departmentReturnLines.position));
    return DepartmentReturn.restore({
      ...row,
      lines: lines.map(({ returnId: _id, position: _position, ...line }) => line),
    });
  }

  async insert(departmentReturn: DepartmentReturn): Promise<void> {
    const { lines, ...row } = departmentReturn.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(departmentReturns).values(row);
      await this.context.db.insert(departmentReturnLines).values(withPositions(lines, 'returnId', row.id));
    });
  }

  async update(departmentReturn: DepartmentReturn): Promise<void> {
    const { lines: _lines, ...row } = departmentReturn.toSnapshot();
    await this.context.db.update(departmentReturns).set(row).where(eq(departmentReturns.id, row.id));
  }
}

@Injectable()
export class DrizzleAdjustmentRepository extends AdjustmentRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<DepartmentAdjustment | null> {
    const [row] = await this.context.db
      .select()
      .from(departmentAdjustments)
      .where(eq(departmentAdjustments.id, id))
      .for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(departmentAdjustmentLines)
      .where(eq(departmentAdjustmentLines.adjustmentId, id))
      .orderBy(asc(departmentAdjustmentLines.position));
    return DepartmentAdjustment.restore({
      ...row,
      lines: lines.map(({ adjustmentId: _id, position: _position, ...line }) => line),
    });
  }

  async insert(adjustment: DepartmentAdjustment): Promise<void> {
    const { lines, ...row } = adjustment.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(departmentAdjustments).values(row);
      await this.context.db.insert(departmentAdjustmentLines).values(withPositions(lines, 'adjustmentId', row.id));
    });
  }

  async update(adjustment: DepartmentAdjustment): Promise<void> {
    const { lines, ...row } = adjustment.toSnapshot();
    await this.context.db.update(departmentAdjustments).set(row).where(eq(departmentAdjustments.id, row.id));
    await this.context.db.delete(departmentAdjustmentLines).where(eq(departmentAdjustmentLines.adjustmentId, row.id));
    await this.context.db.insert(departmentAdjustmentLines).values(withPositions(lines, 'adjustmentId', row.id));
  }
}

@Injectable()
export class DrizzleSupplierReturnRepository extends SupplierReturnRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<SupplierReturn | null> {
    const [row] = await this.context.db.select().from(supplierReturns).where(eq(supplierReturns.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(supplierReturnLines)
      .where(eq(supplierReturnLines.returnId, id))
      .orderBy(asc(supplierReturnLines.position));
    return SupplierReturn.restore({
      ...row,
      lines: lines.map(({ returnId: _id, position: _position, ...line }) => line),
    });
  }

  async insert(supplierReturn: SupplierReturn): Promise<void> {
    const { lines, ...row } = supplierReturn.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(supplierReturns).values(row);
      await this.context.db.insert(supplierReturnLines).values(withPositions(lines, 'returnId', row.id));
    });
  }

  async update(supplierReturn: SupplierReturn): Promise<void> {
    const { lines, ...row } = supplierReturn.toSnapshot();
    await translated(async () => {
      await this.context.db.update(supplierReturns).set(row).where(eq(supplierReturns.id, row.id));
      await this.context.db.delete(supplierReturnLines).where(eq(supplierReturnLines.returnId, row.id));
      await this.context.db.insert(supplierReturnLines).values(withPositions(lines, 'returnId', row.id));
    });
  }

  async delete(id: string): Promise<void> {
    await this.context.db.delete(supplierReturns).where(eq(supplierReturns.id, id));
  }
}

@Injectable()
export class DrizzleGatePassRepository extends GatePassRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insert(pass: NewGatePass): Promise<void> {
    await this.context.db.insert(gatePasses).values(pass);
  }
}
