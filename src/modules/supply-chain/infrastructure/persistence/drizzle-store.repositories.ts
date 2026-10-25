import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { foreignKeyViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  IndentRepository,
  RequestRepository,
  StoreAccess,
  StoreMoveRepository,
  type IssueRecord,
  type PurchaseApprovalLevel,
  type StoreRef,
  type TransferRecord,
} from '../../domain/repositories.js';
import { StoreIndent, StoreRequest } from '../../domain/store-documents.js';
import {
  departmentStoreAccess,
  departmentUsers,
  issueStoreUsers,
  stockTransferLines,
  stockTransfers,
  storeIndentApprovalLevels,
  storeIndentApprovals,
  storeIndentLines,
  storeIndents,
  storeIssueLines,
  storeIssues,
  storeRequestLines,
  storeRequests,
  subStores,
} from './supply-chain.schema.js';

const REFERENCES: Record<string, string> = {
  store_indents_sub_store_id_sub_stores_id_fk: 'sub_store',
  store_indents_department_id_store_departments_id_fk: 'store_department',
  store_indent_lines_variant_id_item_variants_id_fk: 'item_variant',
  store_requests_sub_store_id_sub_stores_id_fk: 'sub_store',
  store_request_lines_variant_id_item_variants_id_fk: 'item_variant',
  store_issues_sub_store_id_sub_stores_id_fk: 'sub_store',
  store_issues_department_id_store_departments_id_fk: 'store_department',
  store_issues_received_by_staff_id_staff_records_id_fk: 'staff',
  store_issue_lines_variant_id_item_variants_id_fk: 'item_variant',
  store_issue_lines_lot_id_stock_lots_id_fk: 'stock_lot',
  stock_transfers_from_main_store_id_main_stores_id_fk: 'main_store',
  stock_transfers_to_main_store_id_main_stores_id_fk: 'main_store',
  stock_transfers_from_sub_store_id_sub_stores_id_fk: 'sub_store',
  stock_transfers_to_sub_store_id_sub_stores_id_fk: 'sub_store',
  stock_transfer_lines_variant_id_item_variants_id_fk: 'item_variant',
  stock_transfer_lines_lot_id_stock_lots_id_fk: 'stock_lot',
};

async function translated<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    const reference = foreignKeyViolationConstraint(error);
    if (reference !== null) {
      const name = Object.entries(REFERENCES).find(([key]) => key.slice(0, 63) === reference)?.[1];
      throw new NotFoundError(name ?? 'referenced_record');
    }
    throw error;
  }
}

const storeColumns = (prefix: 'from' | 'to', store: StoreRef) =>
  'mainStoreId' in store
    ? { [`${prefix}MainStoreId`]: store.mainStoreId, [`${prefix}SubStoreId`]: null }
    : { [`${prefix}MainStoreId`]: null, [`${prefix}SubStoreId`]: store.subStoreId };

@Injectable()
export class DrizzleIndentRepository extends IndentRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<StoreIndent | null> {
    const [row] = await this.context.db.select().from(storeIndents).where(eq(storeIndents.id, id)).for('update');
    if (!row) return null;
    const [lines, decisions] = await Promise.all([
      this.context.db
        .select()
        .from(storeIndentLines)
        .where(eq(storeIndentLines.indentId, id))
        .orderBy(asc(storeIndentLines.position)),
      this.context.db
        .select()
        .from(storeIndentApprovals)
        .where(eq(storeIndentApprovals.indentId, id))
        .orderBy(asc(storeIndentApprovals.levelOrder)),
    ]);
    return StoreIndent.restore({
      ...row,
      lines: lines.map(({ indentId: _id, position: _position, ...line }) => line),
      decisions: decisions.map(({ indentId: _id, ...decision }) => decision),
    });
  }

  async insert(indent: StoreIndent): Promise<void> {
    const { lines, decisions: _decisions, ...row } = indent.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(storeIndents).values(row);
      await this.context.db
        .insert(storeIndentLines)
        .values(lines.map((line, position) => ({ ...line, indentId: row.id, position })));
    });
  }

  async update(indent: StoreIndent): Promise<void> {
    const { lines, decisions, ...row } = indent.toSnapshot();
    await translated(async () => {
      await this.context.db.update(storeIndents).set(row).where(eq(storeIndents.id, row.id));
      await this.context.db.delete(storeIndentLines).where(eq(storeIndentLines.indentId, row.id));
      await this.context.db
        .insert(storeIndentLines)
        .values(lines.map((line, position) => ({ ...line, indentId: row.id, position })));
      await this.context.db.delete(storeIndentApprovals).where(eq(storeIndentApprovals.indentId, row.id));
      if (decisions.length > 0) {
        await this.context.db
          .insert(storeIndentApprovals)
          .values(decisions.map((decision) => ({ ...decision, indentId: row.id })));
      }
    });
  }

  async delete(id: string): Promise<void> {
    await this.context.db.delete(storeIndents).where(eq(storeIndents.id, id));
  }

  async levels(subStoreId: string): Promise<PurchaseApprovalLevel[]> {
    const rows = await this.context.db
      .select({
        order: storeIndentApprovalLevels.levelOrder,
        name: storeIndentApprovalLevels.name,
        roleId: storeIndentApprovalLevels.roleId,
      })
      .from(storeIndentApprovalLevels)
      .where(eq(storeIndentApprovalLevels.subStoreId, subStoreId))
      .orderBy(asc(storeIndentApprovalLevels.levelOrder));
    return rows.map((row) => ({ ...row, isFinal: false }));
  }
}

@Injectable()
export class DrizzleRequestRepository extends RequestRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<StoreRequest | null> {
    const [row] = await this.context.db.select().from(storeRequests).where(eq(storeRequests.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(storeRequestLines)
      .where(eq(storeRequestLines.requestId, id))
      .orderBy(asc(storeRequestLines.position));
    return StoreRequest.restore({
      ...row,
      lines: lines.map(({ requestId: _id, position: _position, ...line }) => line),
    });
  }

  async insert(request: StoreRequest): Promise<void> {
    const { lines, ...row } = request.toSnapshot();
    await translated(async () => {
      await this.context.db.insert(storeRequests).values(row);
      await this.context.db
        .insert(storeRequestLines)
        .values(lines.map((line, position) => ({ ...line, requestId: row.id, position })));
    });
  }

  async update(request: StoreRequest): Promise<void> {
    const { lines, ...row } = request.toSnapshot();
    await translated(async () => {
      await this.context.db.update(storeRequests).set(row).where(eq(storeRequests.id, row.id));
      for (const [position, line] of lines.entries()) {
        await this.context.db
          .update(storeRequestLines)
          .set({ servedQty: line.servedQty })
          .where(and(eq(storeRequestLines.requestId, row.id), eq(storeRequestLines.position, position)));
      }
    });
  }
}

@Injectable()
export class DrizzleStoreMoveRepository extends StoreMoveRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insertIssue({ lines, ...issue }: IssueRecord): Promise<void> {
    await translated(async () => {
      await this.context.db.insert(storeIssues).values(issue);
      await this.context.db
        .insert(storeIssueLines)
        .values(lines.map((line, position) => ({ ...line, issueId: issue.id, position })));
    });
  }

  async insertTransfer({ lines, from, to, ...transfer }: TransferRecord): Promise<void> {
    await translated(async () => {
      await this.context.db
        .insert(stockTransfers)
        .values({ ...transfer, ...storeColumns('from', from), ...storeColumns('to', to) });
      await this.context.db
        .insert(stockTransferLines)
        .values(lines.map((line, position) => ({ ...line, transferId: transfer.id, position })));
    });
  }

  async findTransferForUpdate(id: string): Promise<TransferRecord | null> {
    const [row] = await this.context.db.select().from(stockTransfers).where(eq(stockTransfers.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(stockTransferLines)
      .where(eq(stockTransferLines.transferId, id))
      .orderBy(asc(stockTransferLines.position));
    const { fromMainStoreId, fromSubStoreId, toMainStoreId, toSubStoreId, createdAt: _c, updatedAt: _u, ...rest } = row;
    return {
      ...rest,
      from: fromMainStoreId ? { mainStoreId: fromMainStoreId } : { subStoreId: fromSubStoreId! },
      to: toMainStoreId ? { mainStoreId: toMainStoreId } : { subStoreId: toSubStoreId! },
      lines: lines.map(({ transferId: _id, position: _position, ...line }) => line),
    };
  }

  async updateTransfer(transfer: TransferRecord): Promise<void> {
    await this.context.db
      .update(stockTransfers)
      .set({
        status: transfer.status,
        rejectReason: transfer.rejectReason,
        decidedBy: transfer.decidedBy,
        decidedAt: transfer.decidedAt,
        version: transfer.version,
        updatedAt: new Date(),
      })
      .where(eq(stockTransfers.id, transfer.id));
    for (const [position, line] of transfer.lines.entries()) {
      await this.context.db
        .update(stockTransferLines)
        .set({ acceptedQty: line.acceptedQty })
        .where(and(eq(stockTransferLines.transferId, transfer.id), eq(stockTransferLines.position, position)));
    }
  }
}

@Injectable()
export class DrizzleStoreAccess extends StoreAccess {
  constructor(private readonly context: DbContext) {
    super();
  }

  async mainStoreOf(subStoreId: string): Promise<string | null> {
    const [row] = await this.context.db
      .select({ mainStoreId: subStores.mainStoreId })
      .from(subStores)
      .where(eq(subStores.id, subStoreId));
    return row?.mainStoreId ?? null;
  }

  async mayIndentFor(userId: string, departmentId: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: departmentUsers.id })
      .from(departmentUsers)
      .where(and(eq(departmentUsers.userId, userId), eq(departmentUsers.departmentId, departmentId)))
      .limit(1);
    if (row) return true;
    const [access] = await this.context.db
      .select({ id: departmentStoreAccess.id })
      .from(departmentStoreAccess)
      .where(and(eq(departmentStoreAccess.userId, userId), eq(departmentStoreAccess.departmentId, departmentId)))
      .limit(1);
    return access !== undefined;
  }

  async mayIssueFrom(userId: string, subStoreId: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: issueStoreUsers.id })
      .from(issueStoreUsers)
      .where(and(eq(issueStoreUsers.userId, userId), eq(issueStoreUsers.subStoreId, subStoreId)))
      .limit(1);
    return row !== undefined;
  }
}
