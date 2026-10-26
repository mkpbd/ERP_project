import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { SupplierDirectory } from '../../../../shared/application/contracts/supplier-directory.js';
import {
  SupplierReadRepository,
  type DueReceive,
  type PaymentFilter,
  type PaymentSummary,
  type PaymentView,
  type ReturnFilter,
  type ReturnSummary,
  type ReturnView,
} from '../../application/supplier.messages.js';
import { productRef, productsById } from './drizzle-pharmacy.read-repository.js';
import {
  outlets,
  pharmacyLots,
  pharmacyReceives,
  supplierPaymentLines,
  supplierPayments,
  supplierReturnLines,
  supplierReturns,
  supplierReturnSettlements,
} from './pharmacy.schema.js';

const cents = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class DrizzleSupplierReadRepository extends SupplierReadRepository {
  constructor(
    private readonly context: DbContext,
    private readonly suppliers: SupplierDirectory,
  ) {
    super();
  }

  private async withSuppliers<T extends { supplierId: string }>(rows: readonly T[]) {
    const found = new Map((await this.suppliers.find(rows.map((row) => row.supplierId))).map((s) => [s.id, s]));
    return rows.map((row) => ({
      ...row,
      supplierName: found.get(row.supplierId)?.name ?? '',
      supplierAddress: found.get(row.supplierId)?.address ?? null,
    }));
  }

  async dues(supplierId: string): Promise<DueReceive[]> {
    const paid = sql<number>`coalesce((select sum(${supplierPaymentLines.amount}) from ${supplierPaymentLines} where ${supplierPaymentLines.receiveId} = ${pharmacyReceives.id}), 0)`;
    const rows = await this.context.db
      .select({
        receiveId: pharmacyReceives.id,
        number: pharmacyReceives.number,
        receivedOn: pharmacyReceives.receivedOn,
        outletName: outlets.name,
        supplierInvoiceNo: pharmacyReceives.supplierInvoiceNo,
        total: pharmacyReceives.total,
        paid: paid.mapWith(Number),
      })
      .from(pharmacyReceives)
      .innerJoin(outlets, eq(outlets.id, pharmacyReceives.outletId))
      .where(
        and(
          eq(pharmacyReceives.supplierId, supplierId),
          eq(pharmacyReceives.status, 'posted'),
          sql`${pharmacyReceives.total} > ${paid}`,
        ),
      )
      .orderBy(asc(pharmacyReceives.receivedOn), asc(pharmacyReceives.number));
    return rows.map((row) => ({ ...row, due: cents(row.total - row.paid) }));
  }

  async listPayments(filter: PaymentFilter): Promise<Page<PaymentSummary>> {
    const where = and(
      filter.supplierId ? eq(supplierPayments.supplierId, filter.supplierId) : undefined,
      filter.from ? gte(supplierPayments.paidOn, filter.from) : undefined,
      filter.to ? lte(supplierPayments.paidOn, filter.to) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.context.db
        .select({
          id: supplierPayments.id,
          number: supplierPayments.number,
          supplierId: supplierPayments.supplierId,
          paidOn: supplierPayments.paidOn,
          method: supplierPayments.method,
          reference: supplierPayments.reference,
          total: supplierPayments.total,
          voucherNumber: supplierPayments.voucherNumber,
        })
        .from(supplierPayments)
        .where(where)
        .orderBy(desc(supplierPayments.paidOn), desc(supplierPayments.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(supplierPayments).where(where),
    ]);
    return toPage(
      (await this.withSuppliers(rows)).map(({ supplierAddress: _a, ...row }) => row),
      total?.n ?? 0,
      filter,
    );
  }

  async getPayment(id: string): Promise<PaymentView | null> {
    const [found] = await this.context.db
      .select({
        id: supplierPayments.id,
        number: supplierPayments.number,
        supplierId: supplierPayments.supplierId,
        paidOn: supplierPayments.paidOn,
        method: supplierPayments.method,
        reference: supplierPayments.reference,
        remarks: supplierPayments.remarks,
        total: supplierPayments.total,
        voucherNumber: supplierPayments.voucherNumber,
        bankAccountId: supplierPayments.bankAccountId,
      })
      .from(supplierPayments)
      .where(eq(supplierPayments.id, id));
    if (!found) return null;
    const lines = await this.context.db
      .select({
        receiveId: supplierPaymentLines.receiveId,
        receiveNumber: pharmacyReceives.number,
        receivedOn: pharmacyReceives.receivedOn,
        supplierInvoiceNo: pharmacyReceives.supplierInvoiceNo,
        dueBefore: supplierPaymentLines.dueBefore,
        amount: supplierPaymentLines.amount,
      })
      .from(supplierPaymentLines)
      .innerJoin(pharmacyReceives, eq(pharmacyReceives.id, supplierPaymentLines.receiveId))
      .where(eq(supplierPaymentLines.paymentId, id))
      .orderBy(asc(pharmacyReceives.receivedOn), asc(pharmacyReceives.number));
    const header = (await this.withSuppliers([found]))[0]!;
    return { ...header, lines: lines.map((line) => ({ ...line, dueAfter: cents(line.dueBefore - line.amount) })) };
  }

  private returnHeaders() {
    return this.context.db
      .select({
        id: supplierReturns.id,
        number: supplierReturns.number,
        returnDate: supplierReturns.returnDate,
        outletId: supplierReturns.outletId,
        outletName: outlets.name,
        supplierId: supplierReturns.supplierId,
        status: supplierReturns.status,
        value: supplierReturns.value,
        settledValue: supplierReturns.settledValue,
        reason: supplierReturns.reason,
        closeReason: supplierReturns.closeReason,
        sentVoucherNumber: supplierReturns.sentVoucherNumber,
        version: supplierReturns.version,
      })
      .from(supplierReturns)
      .innerJoin(outlets, eq(outlets.id, supplierReturns.outletId));
  }

  async listReturns(filter: ReturnFilter): Promise<Page<ReturnSummary>> {
    const where = and(
      filter.supplierId ? eq(supplierReturns.supplierId, filter.supplierId) : undefined,
      filter.outletId ? eq(supplierReturns.outletId, filter.outletId) : undefined,
      filter.status ? eq(supplierReturns.status, filter.status as 'draft') : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.returnHeaders()
        .where(where)
        .orderBy(desc(supplierReturns.returnDate), desc(supplierReturns.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(supplierReturns).where(where),
    ]);
    return toPage(
      (await this.withSuppliers(rows)).map(
        ({ supplierAddress: _a, reason: _r, closeReason: _c, sentVoucherNumber: _v, ...row }) => row,
      ),
      total?.n ?? 0,
      filter,
    );
  }

  async getReturn(id: string): Promise<ReturnView | null> {
    const [found] = await this.returnHeaders().where(eq(supplierReturns.id, id));
    if (!found) return null;
    const [lines, settlements] = await Promise.all([
      this.context.db
        .select({
          productId: supplierReturnLines.productId,
          lotId: supplierReturnLines.lotId,
          batchNo: pharmacyLots.batchNo,
          expiryDate: pharmacyLots.expiryDate,
          qty: supplierReturnLines.qty,
          unitCost: supplierReturnLines.unitCost,
          value: supplierReturnLines.value,
        })
        .from(supplierReturnLines)
        .innerJoin(pharmacyLots, eq(pharmacyLots.id, supplierReturnLines.lotId))
        .where(eq(supplierReturnLines.returnId, id))
        .orderBy(asc(supplierReturnLines.position)),
      this.context.db
        .select({
          productId: supplierReturnSettlements.productId,
          settledOn: supplierReturnSettlements.settledOn,
          batchNo: pharmacyLots.batchNo,
          expiryDate: pharmacyLots.expiryDate,
          qty: supplierReturnSettlements.qty,
          purchaseRate: supplierReturnSettlements.purchaseRate,
          value: supplierReturnSettlements.value,
          voucherNumber: supplierReturnSettlements.voucherNumber,
        })
        .from(supplierReturnSettlements)
        .innerJoin(pharmacyLots, eq(pharmacyLots.id, supplierReturnSettlements.lotId))
        .where(eq(supplierReturnSettlements.returnId, id))
        .orderBy(asc(supplierReturnSettlements.settledOn), asc(supplierReturnSettlements.createdAt)),
    ]);
    const named = await productsById(
      this.context,
      [...lines, ...settlements].map((line) => line.productId),
    );
    const { supplierAddress: _a, ...header } = (await this.withSuppliers([found]))[0]!;
    return {
      ...header,
      lines: lines.map(({ productId, ...line }) => ({ ...productRef(named.get(productId)!), ...line })),
      settlements: settlements.map(({ productId, ...line }) => ({ ...productRef(named.get(productId)!), ...line })),
    };
  }
}
