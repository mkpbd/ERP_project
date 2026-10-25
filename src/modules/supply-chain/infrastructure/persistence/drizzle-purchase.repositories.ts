import { Injectable } from '@nestjs/common';
import { and, asc, eq, ne, sql, sum } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { foreignKeyViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { ComparativeStudy } from '../../domain/comparative-study.js';
import type { Decision } from '../../domain/documents.js';
import { PurchaseOrder } from '../../domain/purchase-order.js';
import { PurchaseRequisition } from '../../domain/requisition.js';
import {
  ApprovalLevels,
  OrderRepository,
  RequisitionRepository,
  ScmSequences,
  StudyRepository,
  type PurchaseApprovalLevel,
  type StudyApprovalLevel,
} from '../../domain/repositories.js';
import {
  comparativeStudies,
  comparativeStudyApprovals,
  comparativeStudyQuotes,
  csApprovalLevels,
  purchaseApprovalLevels,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequisitionApprovals,
  purchaseRequisitionLines,
  purchaseRequisitions,
  scmSequences,
} from './supply-chain.schema.js';

/** Foreign key → the record reported missing. */
const REFERENCES: Record<string, string> = {
  purchase_requisitions_main_store_id_main_stores_id_fk: 'main_store',
  purchase_requisitions_sub_store_id_sub_stores_id_fk: 'sub_store',
  purchase_requisitions_department_id_store_departments_id_fk: 'store_department',
  purchase_requisitions_supplier_id_suppliers_id_fk: 'supplier',
  purchase_requisition_lines_variant_id_item_variants_id_fk: 'item_variant',
  comparative_studies_requisition_id_purchase_requisitions_id_fk: 'purchase_requisition',
  comparative_study_quotes_supplier_id_suppliers_id_fk: 'supplier',
  comparative_study_quotes_variant_id_item_variants_id_fk: 'item_variant',
  purchase_orders_supplier_id_suppliers_id_fk: 'supplier',
  purchase_orders_main_store_id_main_stores_id_fk: 'main_store',
  purchase_orders_requisition_id_purchase_requisitions_id_fk: 'purchase_requisition',
  purchase_orders_comparative_study_id_comparative_studies_id_fk: 'comparative_study',
  purchase_order_lines_variant_id_item_variants_id_fk: 'item_variant',
};

async function translated<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const reference = foreignKeyViolationConstraint(error);
    if (reference !== null) throw new NotFoundError(REFERENCES[reference] ?? 'referenced_record');
    throw error;
  }
}

const decisionRows = (column: 'requisitionId' | 'studyId', id: string, decisions: readonly Decision[]) =>
  decisions.map((decision) => ({ [column]: id, ...decision }) as Decision & Record<typeof column, string>);

@Injectable()
export class DrizzleScmSequences extends ScmSequences {
  constructor(private readonly context: DbContext) {
    super();
  }

  async next(kind: string, year: number): Promise<number> {
    const [row] = await this.context.db
      .insert(scmSequences)
      .values({ kind, year, last: 1 })
      .onConflictDoUpdate({
        target: [scmSequences.kind, scmSequences.year],
        set: { last: sql`${scmSequences.last} + 1` },
      })
      .returning({ last: scmSequences.last });
    return row!.last;
  }
}

@Injectable()
export class DrizzleApprovalLevels extends ApprovalLevels {
  constructor(private readonly context: DbContext) {
    super();
  }

  async purchase(mainStoreId: string): Promise<PurchaseApprovalLevel[]> {
    const rows = await this.context.db
      .select({
        order: purchaseApprovalLevels.levelOrder,
        name: purchaseApprovalLevels.name,
        roleId: purchaseApprovalLevels.roleId,
      })
      .from(purchaseApprovalLevels)
      .where(eq(purchaseApprovalLevels.mainStoreId, mainStoreId))
      .orderBy(asc(purchaseApprovalLevels.levelOrder));
    return rows.map((row) => ({ ...row, isFinal: false }));
  }

  async study(): Promise<StudyApprovalLevel[]> {
    return this.context.db
      .select({
        order: csApprovalLevels.levelOrder,
        name: csApprovalLevels.name,
        approverStaffId: csApprovalLevels.approverStaffId,
        isFinal: csApprovalLevels.isFinal,
      })
      .from(csApprovalLevels)
      .orderBy(asc(csApprovalLevels.levelOrder));
  }
}

@Injectable()
export class DrizzleRequisitionRepository extends RequisitionRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<PurchaseRequisition | null> {
    const [row] = await this.context.db
      .select()
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, id))
      .for('update');
    if (!row) return null;
    const [lines, decisions] = await Promise.all([
      this.context.db
        .select()
        .from(purchaseRequisitionLines)
        .where(eq(purchaseRequisitionLines.requisitionId, id))
        .orderBy(asc(purchaseRequisitionLines.position)),
      this.context.db
        .select()
        .from(purchaseRequisitionApprovals)
        .where(eq(purchaseRequisitionApprovals.requisitionId, id))
        .orderBy(asc(purchaseRequisitionApprovals.levelOrder)),
    ]);
    return PurchaseRequisition.restore({
      ...row,
      lines: lines.map(({ requisitionId: _id, position: _position, ...line }) => line),
      decisions: decisions.map(({ requisitionId: _id, ...decision }) => decision),
    });
  }

  async insert(requisition: PurchaseRequisition): Promise<void> {
    const { lines, decisions: _decisions, ...row } = requisition.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(purchaseRequisitions).values(row);
      await this.saveLines(row.id, lines);
    });
  }

  async update(requisition: PurchaseRequisition): Promise<void> {
    const { lines, decisions, ...row } = requisition.toSnapshot();
    await translated(async () => {
      await this.context.db.update(purchaseRequisitions).set(row).where(eq(purchaseRequisitions.id, row.id));
      await this.context.db.delete(purchaseRequisitionLines).where(eq(purchaseRequisitionLines.requisitionId, row.id));
      await this.saveLines(row.id, lines);
      await this.context.db
        .delete(purchaseRequisitionApprovals)
        .where(eq(purchaseRequisitionApprovals.requisitionId, row.id));
      if (decisions.length > 0) {
        await this.context.db
          .insert(purchaseRequisitionApprovals)
          .values(decisionRows('requisitionId', row.id, decisions));
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.context.db.delete(purchaseRequisitions).where(eq(purchaseRequisitions.id, id));
  }

  private async saveLines(id: string, lines: ReturnType<PurchaseRequisition['toSnapshot']>['lines']) {
    await this.context.db
      .insert(purchaseRequisitionLines)
      .values(lines.map((line, position) => ({ ...line, requisitionId: id, position })));
  }
}

@Injectable()
export class DrizzleStudyRepository extends StudyRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<ComparativeStudy | null> {
    const [row] = await this.context.db
      .select()
      .from(comparativeStudies)
      .where(eq(comparativeStudies.id, id))
      .for('update');
    if (!row) return null;
    const [quotes, decisions] = await Promise.all([
      this.context.db
        .select()
        .from(comparativeStudyQuotes)
        .where(eq(comparativeStudyQuotes.studyId, id))
        .orderBy(asc(comparativeStudyQuotes.position)),
      this.context.db
        .select()
        .from(comparativeStudyApprovals)
        .where(eq(comparativeStudyApprovals.studyId, id))
        .orderBy(asc(comparativeStudyApprovals.levelOrder)),
    ]);
    return ComparativeStudy.restore({
      ...row,
      quotes: quotes.map(({ studyId: _id, position: _position, ...quote }) => quote),
      decisions: decisions.map(({ studyId: _id, ...decision }) => decision),
    });
  }

  async insert(study: ComparativeStudy): Promise<void> {
    const { quotes, decisions: _decisions, ...row } = study.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(comparativeStudies).values(row);
      await this.saveQuotes(row.id, quotes);
    });
  }

  async update(study: ComparativeStudy): Promise<void> {
    const { quotes, decisions, ...row } = study.toSnapshot();
    await translated(async () => {
      await this.context.db.update(comparativeStudies).set(row).where(eq(comparativeStudies.id, row.id));
      await this.context.db.delete(comparativeStudyQuotes).where(eq(comparativeStudyQuotes.studyId, row.id));
      await this.saveQuotes(row.id, quotes);
      await this.context.db.delete(comparativeStudyApprovals).where(eq(comparativeStudyApprovals.studyId, row.id));
      if (decisions.length > 0) {
        await this.context.db.insert(comparativeStudyApprovals).values(decisionRows('studyId', row.id, decisions));
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.context.db.delete(comparativeStudies).where(eq(comparativeStudies.id, id));
  }

  async requisitionStatus(requisitionId: string): Promise<string | null> {
    const [row] = await this.context.db
      .select({ status: purchaseRequisitions.status })
      .from(purchaseRequisitions)
      .where(eq(purchaseRequisitions.id, requisitionId));
    return row?.status ?? null;
  }

  private async saveQuotes(id: string, quotes: ReturnType<ComparativeStudy['toSnapshot']>['quotes']) {
    await this.context.db
      .insert(comparativeStudyQuotes)
      .values(quotes.map((quote, position) => ({ ...quote, studyId: id, position })));
  }
}

@Injectable()
export class DrizzleOrderRepository extends OrderRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<PurchaseOrder | null> {
    const [row] = await this.context.db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderId, id))
      .orderBy(asc(purchaseOrderLines.position));
    return PurchaseOrder.restore({
      ...row,
      lines: lines.map(({ orderId: _id, position: _position, ...line }) => line),
    });
  }

  async insert(order: PurchaseOrder): Promise<void> {
    const { lines, ...row } = order.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(purchaseOrders).values(row);
      await this.saveLines(row.id, lines);
    });
  }

  async update(order: PurchaseOrder): Promise<void> {
    const { lines, ...row } = order.toSnapshot();
    await translated(async () => {
      await this.context.db.update(purchaseOrders).set(row).where(eq(purchaseOrders.id, row.id));
      await this.context.db.delete(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, row.id));
      await this.saveLines(row.id, lines);
    });
  }

  async orderedFor(requisitionId: string, exceptOrderId?: string): Promise<Map<string, number>> {
    const rows = await this.context.db
      .select({ variantId: purchaseOrderLines.variantId, qty: sum(purchaseOrderLines.qty).mapWith(Number) })
      .from(purchaseOrderLines)
      .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.orderId))
      .where(
        and(
          eq(purchaseOrders.requisitionId, requisitionId),
          ne(purchaseOrders.status, 'cancelled'),
          exceptOrderId ? ne(purchaseOrders.id, exceptOrderId) : undefined,
        ),
      )
      .groupBy(purchaseOrderLines.variantId);
    return new Map(rows.map((row) => [row.variantId, row.qty]));
  }

  async hasOrders(requisitionId: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.requisitionId, requisitionId), ne(purchaseOrders.status, 'cancelled')))
      .limit(1);
    return row !== undefined;
  }

  async studyWinners(studyId: string): Promise<{ supplierIds: Set<string> } | null> {
    const [study] = await this.context.db
      .select({ status: comparativeStudies.status })
      .from(comparativeStudies)
      .where(eq(comparativeStudies.id, studyId));
    if (!study) throw new NotFoundError('comparative_study');
    if (study.status !== 'approved') return null;
    const rows = await this.context.db
      .selectDistinct({ supplierId: comparativeStudyQuotes.supplierId })
      .from(comparativeStudyQuotes)
      .where(and(eq(comparativeStudyQuotes.studyId, studyId), eq(comparativeStudyQuotes.selected, true)));
    return { supplierIds: new Set(rows.map((row) => row.supplierId)) };
  }

  private async saveLines(id: string, lines: ReturnType<PurchaseOrder['toSnapshot']>['lines']) {
    await this.context.db
      .insert(purchaseOrderLines)
      .values(lines.map((line, position) => ({ ...line, orderId: id, position })));
  }
}
