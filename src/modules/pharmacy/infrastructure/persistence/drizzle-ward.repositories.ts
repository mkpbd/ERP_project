import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, lte, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { InpatientMedicine, type MedicineCharge } from '../../../../shared/application/contracts/inpatient-medicine.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  WardReadRepository,
  type WardIndentFilter,
  type WardIndentSummary,
  type WardIndentView,
  type WardIssueFilter,
  type WardIssueSummary,
  type WardIssueView,
  type WardMedicineLine,
} from '../../application/ward.messages.js';
import { WardRepository, type WardReturnRecord } from '../../domain/repositories.js';
import { WardIndent, WardIssue } from '../../domain/ward.js';
import { productRef, productsById } from './drizzle-pharmacy.read-repository.js';
import {
  outlets,
  pharmacyLots,
  wardIndentLines,
  wardIndents,
  wardIssueLines,
  wardIssues,
  wardReturnLines,
  wardReturns,
} from './pharmacy.schema.js';

const charged = sql<number>`${wardIssues.total} - ${wardIssues.returned}`.mapWith(Number);

@Injectable()
export class DrizzleWardRepository extends WardRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async indentForUpdate(id: string): Promise<WardIndent | null> {
    const [row] = await this.context.db.select().from(wardIndents).where(eq(wardIndents.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select({ productId: wardIndentLines.productId, qty: wardIndentLines.qty })
      .from(wardIndentLines)
      .where(eq(wardIndentLines.indentId, id))
      .orderBy(asc(wardIndentLines.position));
    return WardIndent.restore({ ...row, lines });
  }

  async insertIndent(indent: WardIndent): Promise<void> {
    const { lines, ...row } = indent.toSnapshot();
    await this.context.db.insert(wardIndents).values(row);
    await this.context.db
      .insert(wardIndentLines)
      .values(lines.map((line, index) => ({ ...line, indentId: row.id, position: index + 1 })));
  }

  async updateIndent(indent: WardIndent): Promise<void> {
    const { lines: _lines, id, ...row } = indent.toSnapshot();
    await this.context.db.update(wardIndents).set(row).where(eq(wardIndents.id, id));
  }

  async issueForUpdate(id: string): Promise<WardIssue | null> {
    const [row] = await this.context.db.select().from(wardIssues).where(eq(wardIssues.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select({
        productId: wardIssueLines.productId,
        lotId: wardIssueLines.lotId,
        qty: wardIssueLines.qty,
        saleRate: wardIssueLines.saleRate,
        unitCost: wardIssueLines.unitCost,
        discountPercent: wardIssueLines.discountPercent,
        amount: wardIssueLines.amount,
        discount: wardIssueLines.discount,
        total: wardIssueLines.total,
        returnedQty: wardIssueLines.returnedQty,
      })
      .from(wardIssueLines)
      .where(eq(wardIssueLines.issueId, id))
      .orderBy(asc(wardIssueLines.position));
    return WardIssue.restore({ ...row, lines });
  }

  async insertIssue(issue: WardIssue): Promise<void> {
    const { lines, ...row } = issue.toSnapshot();
    await this.context.db.insert(wardIssues).values(row);
    await this.context.db
      .insert(wardIssueLines)
      .values(lines.map((line, index) => ({ ...line, issueId: row.id, position: index + 1 })));
  }

  async updateIssue(issue: WardIssue): Promise<void> {
    const { lines, id, ...row } = issue.toSnapshot();
    await this.context.db.update(wardIssues).set(row).where(eq(wardIssues.id, id));
    for (const [index, line] of lines.entries()) {
      await this.context.db
        .update(wardIssueLines)
        .set({ returnedQty: line.returnedQty })
        .where(and(eq(wardIssueLines.issueId, id), eq(wardIssueLines.position, index + 1)));
    }
  }

  async insertReturn(record: WardReturnRecord): Promise<void> {
    const { parts, ...row } = record;
    await this.context.db.insert(wardReturns).values(row);
    await this.context.db.insert(wardReturnLines).values(
      parts.map((part, index) => ({
        returnId: row.id,
        position: index + 1,
        issueLine: part.issueLine,
        productId: part.productId,
        lotId: part.lotId,
        qty: part.qty,
        unitCost: part.unitCost,
        amount: part.amount,
        discount: part.discount,
        total: part.total,
      })),
    );
  }
}

@Injectable()
export class DrizzleWardReadRepository extends WardReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private indentSummaries() {
    return this.context.db
      .select({
        id: wardIndents.id,
        number: wardIndents.number,
        outletId: wardIndents.outletId,
        outletName: outlets.name,
        admissionId: wardIndents.admissionId,
        requestedOn: wardIndents.requestedOn,
        status: wardIndents.status,
        lineCount:
          sql<number>`(select count(*) from ${wardIndentLines} where ${wardIndentLines.indentId} = ${wardIndents.id})`.mapWith(
            Number,
          ),
        version: wardIndents.version,
      })
      .from(wardIndents)
      .innerJoin(outlets, eq(outlets.id, wardIndents.outletId));
  }

  async indents(filter: WardIndentFilter): Promise<Page<WardIndentSummary>> {
    const where = and(
      filter.outletId ? eq(wardIndents.outletId, filter.outletId) : undefined,
      filter.admissionId ? eq(wardIndents.admissionId, filter.admissionId) : undefined,
      filter.status ? eq(wardIndents.status, filter.status) : undefined,
    );
    const rows = await this.indentSummaries()
      .where(where)
      .orderBy(desc(wardIndents.requestedOn), desc(wardIndents.number))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    const [total] = await this.context.db.select({ n: count() }).from(wardIndents).where(where);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async indent(id: string): Promise<WardIndentView | null> {
    const [summary] = await this.indentSummaries().where(eq(wardIndents.id, id));
    if (!summary) return null;
    const [extra] = await this.context.db
      .select({ note: wardIndents.note, cancelReason: wardIndents.cancelReason, issueId: wardIndents.issueId })
      .from(wardIndents)
      .where(eq(wardIndents.id, id));
    const lines = await this.context.db
      .select({ productId: wardIndentLines.productId, qty: wardIndentLines.qty })
      .from(wardIndentLines)
      .where(eq(wardIndentLines.indentId, id))
      .orderBy(asc(wardIndentLines.position));
    const named = await productsById(
      this.context,
      lines.map((line) => line.productId),
    );
    return {
      ...summary,
      ...extra!,
      lines: lines.map((line) => ({ ...line, productName: productRef(named.get(line.productId)!).displayName })),
    };
  }

  private issueSummaries() {
    return this.context.db
      .select({
        id: wardIssues.id,
        number: wardIssues.number,
        outletId: wardIssues.outletId,
        outletName: outlets.name,
        admissionId: wardIssues.admissionId,
        indentId: wardIssues.indentId,
        issuedOn: wardIssues.issuedOn,
        amount: wardIssues.amount,
        discount: wardIssues.discount,
        total: wardIssues.total,
        returned: wardIssues.returned,
        charged,
        version: wardIssues.version,
      })
      .from(wardIssues)
      .innerJoin(outlets, eq(outlets.id, wardIssues.outletId));
  }

  async issues(filter: WardIssueFilter): Promise<Page<WardIssueSummary>> {
    const where = and(
      filter.outletId ? eq(wardIssues.outletId, filter.outletId) : undefined,
      filter.admissionId ? eq(wardIssues.admissionId, filter.admissionId) : undefined,
      filter.from ? gte(wardIssues.issuedOn, filter.from) : undefined,
      filter.to ? lte(wardIssues.issuedOn, filter.to) : undefined,
    );
    const rows = await this.issueSummaries()
      .where(where)
      .orderBy(desc(wardIssues.issuedOn), desc(wardIssues.number))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    const [total] = await this.context.db.select({ n: count() }).from(wardIssues).where(where);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async issue(id: string): Promise<WardIssueView | null> {
    const [summary] = await this.issueSummaries().where(eq(wardIssues.id, id));
    if (!summary) return null;
    const [extra] = await this.context.db
      .select({ voucherNumber: wardIssues.voucherNumber })
      .from(wardIssues)
      .where(eq(wardIssues.id, id));
    const lines = await this.context.db
      .select({
        line: wardIssueLines.position,
        productId: wardIssueLines.productId,
        lotId: wardIssueLines.lotId,
        batchNo: pharmacyLots.batchNo,
        expiryDate: pharmacyLots.expiryDate,
        qty: wardIssueLines.qty,
        saleRate: wardIssueLines.saleRate,
        discountPercent: wardIssueLines.discountPercent,
        total: wardIssueLines.total,
        returnedQty: wardIssueLines.returnedQty,
      })
      .from(wardIssueLines)
      .innerJoin(pharmacyLots, eq(pharmacyLots.id, wardIssueLines.lotId))
      .where(eq(wardIssueLines.issueId, id))
      .orderBy(asc(wardIssueLines.position));
    const returns = await this.context.db
      .select({
        id: wardReturns.id,
        number: wardReturns.number,
        returnedOn: wardReturns.returnedOn,
        reason: wardReturns.reason,
        total: wardReturns.total,
      })
      .from(wardReturns)
      .where(eq(wardReturns.issueId, id))
      .orderBy(asc(wardReturns.createdAt));
    const named = await productsById(
      this.context,
      lines.map((line) => line.productId),
    );
    return {
      ...summary,
      ...extra!,
      lines: lines.map((line) => ({ ...line, productName: productRef(named.get(line.productId)!).displayName })),
      returns,
    };
  }

  async medicineOf(admissionId: string): Promise<WardMedicineLine[]> {
    const issued = await this.context.db
      .select({
        on: wardIssues.issuedOn,
        number: wardIssues.number,
        outletName: outlets.name,
        productId: wardIssueLines.productId,
        qty: wardIssueLines.qty,
        saleRate: wardIssueLines.saleRate,
        total: wardIssueLines.total,
        createdAt: wardIssues.createdAt,
      })
      .from(wardIssueLines)
      .innerJoin(wardIssues, eq(wardIssues.id, wardIssueLines.issueId))
      .innerJoin(outlets, eq(outlets.id, wardIssues.outletId))
      .where(eq(wardIssues.admissionId, admissionId))
      .orderBy(asc(wardIssues.createdAt), asc(wardIssueLines.position));
    const returned = await this.context.db
      .select({
        on: wardReturns.returnedOn,
        number: wardReturns.number,
        outletName: outlets.name,
        productId: wardReturnLines.productId,
        qty: wardReturnLines.qty,
        saleRate: wardIssueLines.saleRate,
        total: wardReturnLines.total,
        createdAt: wardReturns.createdAt,
      })
      .from(wardReturnLines)
      .innerJoin(wardReturns, eq(wardReturns.id, wardReturnLines.returnId))
      .innerJoin(wardIssues, eq(wardIssues.id, wardReturns.issueId))
      .innerJoin(
        wardIssueLines,
        and(eq(wardIssueLines.issueId, wardIssues.id), eq(wardIssueLines.position, wardReturnLines.issueLine)),
      )
      .innerJoin(outlets, eq(outlets.id, wardIssues.outletId))
      .where(eq(wardIssues.admissionId, admissionId))
      .orderBy(asc(wardReturns.createdAt), asc(wardReturnLines.position));
    const named = await productsById(
      this.context,
      [...issued, ...returned].map((row) => row.productId),
    );
    const name = (id: string) => productRef(named.get(id)!).displayName;
    return [
      ...issued.map((row) => ({ ...row, kind: 'issue' as const })),
      ...returned.map((row) => ({ ...row, kind: 'return' as const, qty: -row.qty, total: -row.total })),
    ]
      .sort((a, b) => a.on.localeCompare(b.on) || a.createdAt.getTime() - b.createdAt.getTime())
      .map(({ productId, createdAt: _c, ...row }) => ({ ...row, productName: name(productId) }));
  }
}

/** The pharmacy's side of an admission's indoor bill. */
@Injectable()
export class DrizzleInpatientMedicine extends InpatientMedicine {
  constructor(private readonly context: DbContext) {
    super();
  }

  async charges(admissionId: string): Promise<MedicineCharge[]> {
    return this.context.db
      .select({
        issueId: wardIssues.id,
        number: wardIssues.number,
        issuedOn: wardIssues.issuedOn,
        outletName: outlets.name,
        amount: charged,
      })
      .from(wardIssues)
      .innerJoin(outlets, eq(outlets.id, wardIssues.outletId))
      .where(and(eq(wardIssues.admissionId, admissionId), gt(charged, 0)))
      .orderBy(asc(wardIssues.issuedOn), asc(wardIssues.number));
  }

  async openIndents(admissionId: string): Promise<number> {
    const [row] = await this.context.db
      .select({ n: count() })
      .from(wardIndents)
      .where(and(eq(wardIndents.admissionId, admissionId), eq(wardIndents.status, 'open')));
    return row?.n ?? 0;
  }
}
