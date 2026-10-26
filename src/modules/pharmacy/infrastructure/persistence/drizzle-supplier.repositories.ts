import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { foreignKeyViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  PaymentRepository,
  SupplierReturnRepository,
  type PaymentRecord,
  type SettlementRecord,
} from '../../domain/repositories.js';
import type { ReceiveDue } from '../../domain/supplier-payment.js';
import { SupplierReturn } from '../../domain/supplier-return.js';
import {
  pharmacyReceives,
  supplierPaymentLines,
  supplierPayments,
  supplierReturnLines,
  supplierReturns,
  supplierReturnSettlements,
} from './pharmacy.schema.js';

const REFERENCES: Record<string, string> = {
  pharmacy_supplier_payments_bank_account_id_gl_accounts_id_fk: 'gl_account',
  pharmacy_supplier_payments_supplier_id_suppliers_id_fk: 'supplier',
  pharmacy_supplier_returns_outlet_id_pharmacy_outlets_id_fk: 'outlet',
  pharmacy_supplier_returns_supplier_id_suppliers_id_fk: 'supplier',
};

async function translated<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const reference = foreignKeyViolationConstraint(error);
    if (reference !== null) {
      const name =
        REFERENCES[reference] ?? Object.entries(REFERENCES).find(([key]) => key.slice(0, 63) === reference)?.[1];
      throw new NotFoundError(name ?? 'referenced_record');
    }
    throw error;
  }
}

@Injectable()
export class DrizzlePaymentRepository extends PaymentRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async dues(receiveIds: readonly string[]): Promise<Map<string, ReceiveDue>> {
    const unique = [...new Set(receiveIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        id: pharmacyReceives.id,
        supplierId: pharmacyReceives.supplierId,
        number: pharmacyReceives.number,
        total: pharmacyReceives.total,
        paid: sql<number>`coalesce((select sum(${supplierPaymentLines.amount}) from ${supplierPaymentLines} where ${supplierPaymentLines.receiveId} = ${pharmacyReceives.id}), 0)`.mapWith(
          Number,
        ),
      })
      .from(pharmacyReceives)
      .where(and(inArray(pharmacyReceives.id, unique), eq(pharmacyReceives.status, 'posted')));
    return new Map(rows.map(({ id, ...due }) => [id, due]));
  }

  async insert({ allocations, ...payment }: PaymentRecord): Promise<void> {
    await translated(async () => {
      await this.context.db.insert(supplierPayments).values(payment);
      await this.context.db
        .insert(supplierPaymentLines)
        .values(allocations.map((line) => ({ ...line, paymentId: payment.id })));
    });
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
      await this.saveLines(row.id, lines);
    });
  }

  async update(supplierReturn: SupplierReturn): Promise<void> {
    const { lines, ...row } = supplierReturn.toSnapshot();
    await translated(async () => {
      await this.context.db.update(supplierReturns).set(row).where(eq(supplierReturns.id, row.id));
      await this.context.db.delete(supplierReturnLines).where(eq(supplierReturnLines.returnId, row.id));
      await this.saveLines(row.id, lines);
    });
  }

  async delete(id: string): Promise<void> {
    await this.context.db.delete(supplierReturns).where(eq(supplierReturns.id, id));
  }

  async addSettlements(settlements: readonly SettlementRecord[]): Promise<void> {
    if (settlements.length > 0) await this.context.db.insert(supplierReturnSettlements).values([...settlements]);
  }

  private async saveLines(id: string, lines: ReturnType<SupplierReturn['toSnapshot']>['lines']) {
    await this.context.db
      .insert(supplierReturnLines)
      .values(lines.map((line, position) => ({ ...line, returnId: id, position })));
  }
}
