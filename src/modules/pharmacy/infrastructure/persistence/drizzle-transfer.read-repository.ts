import { Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  TransferReadRepository,
  type IndentFilter,
  type IndentSummary,
  type IndentView,
  type TransferFilter,
  type TransferSummary,
  type TransferView,
} from '../../application/transfer.messages.js';
import { productRef, productsById } from './drizzle-pharmacy.read-repository.js';
import {
  outletIndentLines,
  outletIndents,
  outlets,
  outletTransferLines,
  outletTransfers,
  pharmacyLots,
  pharmacyMovements,
} from './pharmacy.schema.js';

const requesting = aliasedTable(outlets, 'requesting');
const supplying = aliasedTable(outlets, 'supplying');
const sender = aliasedTable(outlets, 'sender');
const receiver = aliasedTable(outlets, 'receiver');
const cents = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class DrizzleTransferReadRepository extends TransferReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private indentHeaders() {
    return this.context.db
      .select({
        id: outletIndents.id,
        number: outletIndents.number,
        indentDate: outletIndents.indentDate,
        requestingOutletId: outletIndents.requestingOutletId,
        requestingOutletName: requesting.name,
        supplyingOutletId: outletIndents.supplyingOutletId,
        supplyingOutletName: supplying.name,
        urgent: outletIndents.urgent,
        status: outletIndents.status,
        note: outletIndents.note,
        closeReason: outletIndents.closeReason,
        version: outletIndents.version,
      })
      .from(outletIndents)
      .innerJoin(requesting, eq(requesting.id, outletIndents.requestingOutletId))
      .innerJoin(supplying, eq(supplying.id, outletIndents.supplyingOutletId));
  }

  async listIndents(filter: IndentFilter): Promise<Page<IndentSummary>> {
    const where = and(
      filter.requestingOutletId ? eq(outletIndents.requestingOutletId, filter.requestingOutletId) : undefined,
      filter.supplyingOutletId ? eq(outletIndents.supplyingOutletId, filter.supplyingOutletId) : undefined,
      filter.status ? eq(outletIndents.status, filter.status as 'open') : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.indentHeaders()
        .where(where)
        .orderBy(desc(outletIndents.urgent), desc(outletIndents.indentDate), desc(outletIndents.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(outletIndents).where(where),
    ]);
    return toPage(
      rows.map(({ note: _n, closeReason: _c, ...row }) => row),
      total?.n ?? 0,
      filter,
    );
  }

  async getIndent(id: string, today: string): Promise<IndentView | null> {
    const [header] = await this.indentHeaders().where(eq(outletIndents.id, id));
    if (!header) return null;
    const lines = await this.context.db
      .select()
      .from(outletIndentLines)
      .where(eq(outletIndentLines.indentId, id))
      .orderBy(asc(outletIndentLines.position));
    const productIds = lines.map((line) => line.productId);
    const [named, available] = await Promise.all([
      productsById(this.context, productIds),
      productIds.length === 0
        ? []
        : this.context.db
            .select({
              productId: pharmacyMovements.productId,
              qty: sql<number>`coalesce(sum(${pharmacyMovements.qty}), 0)`.mapWith(Number),
            })
            .from(pharmacyMovements)
            .innerJoin(pharmacyLots, eq(pharmacyLots.id, pharmacyMovements.lotId))
            .where(
              and(
                eq(pharmacyMovements.outletId, header.supplyingOutletId),
                inArray(pharmacyMovements.productId, productIds),
                gt(pharmacyLots.expiryDate, today),
              ),
            )
            .groupBy(pharmacyMovements.productId),
    ]);
    const availableOf = new Map(available.map((row) => [row.productId, row.qty]));
    return {
      ...header,
      lines: lines.map((line) => ({
        ...productRef(named.get(line.productId)!),
        qty: line.qty,
        transferredQty: line.transferredQty,
        available: availableOf.get(line.productId) ?? 0,
      })),
    };
  }

  private transferHeaders() {
    return this.context.db
      .select({
        id: outletTransfers.id,
        number: outletTransfers.number,
        transferDate: outletTransfers.transferDate,
        indentId: outletTransfers.indentId,
        indentNumber: outletIndents.number,
        fromOutletId: outletTransfers.fromOutletId,
        fromOutletName: sender.name,
        toOutletId: outletTransfers.toOutletId,
        toOutletName: receiver.name,
        status: outletTransfers.status,
        value:
          sql<number>`(select coalesce(sum(${outletTransferLines.qty} * ${outletTransferLines.unitCost}), 0) from ${outletTransferLines} where ${outletTransferLines.transferId} = ${outletTransfers.id})`.mapWith(
            Number,
          ),
        note: outletTransfers.note,
        decidedOn: outletTransfers.decidedOn,
        rejectReason: outletTransfers.rejectReason,
        version: outletTransfers.version,
      })
      .from(outletTransfers)
      .innerJoin(sender, eq(sender.id, outletTransfers.fromOutletId))
      .innerJoin(receiver, eq(receiver.id, outletTransfers.toOutletId))
      .leftJoin(outletIndents, eq(outletIndents.id, outletTransfers.indentId));
  }

  async listTransfers(filter: TransferFilter): Promise<Page<TransferSummary>> {
    const where = and(
      filter.fromOutletId ? eq(outletTransfers.fromOutletId, filter.fromOutletId) : undefined,
      filter.toOutletId ? eq(outletTransfers.toOutletId, filter.toOutletId) : undefined,
      filter.status ? eq(outletTransfers.status, filter.status as 'in_transit') : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.transferHeaders()
        .where(where)
        .orderBy(desc(outletTransfers.transferDate), desc(outletTransfers.number))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(outletTransfers).where(where),
    ]);
    return toPage(
      rows.map(({ note: _n, decidedOn: _d, rejectReason: _r, ...row }) => ({ ...row, value: cents(row.value) })),
      total?.n ?? 0,
      filter,
    );
  }

  async getTransfer(id: string): Promise<TransferView | null> {
    const [header] = await this.transferHeaders().where(eq(outletTransfers.id, id));
    if (!header) return null;
    const lines = await this.context.db
      .select({
        productId: outletTransferLines.productId,
        lotId: outletTransferLines.lotId,
        batchNo: pharmacyLots.batchNo,
        expiryDate: pharmacyLots.expiryDate,
        qty: outletTransferLines.qty,
        unitCost: outletTransferLines.unitCost,
      })
      .from(outletTransferLines)
      .innerJoin(pharmacyLots, eq(pharmacyLots.id, outletTransferLines.lotId))
      .where(eq(outletTransferLines.transferId, id))
      .orderBy(asc(outletTransferLines.position));
    const named = await productsById(
      this.context,
      lines.map((line) => line.productId),
    );
    return {
      ...header,
      value: cents(header.value),
      lines: lines.map(({ productId, ...line }) => ({
        ...productRef(named.get(productId)!),
        ...line,
        value: cents(line.qty * line.unitCost),
      })),
    };
  }
}
