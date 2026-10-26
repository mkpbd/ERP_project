import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import type { Page } from '../../../shared/application/pagination.js';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { PurchaseRequisition } from '../domain/requisition.js';
import {
  IndentRepository,
  RequestRepository,
  StockLedger,
  StoreAccess,
  StoreMoveRepository,
  type StoreRef,
  type TransferRecord,
} from '../domain/repositories.js';
import {
  acceptedLines,
  quantitiesOf,
  StoreIndent,
  StoreRequest,
  validMoveLines,
  type TransferKind,
} from '../domain/store-documents.js';
import { PurchaseDesk } from './purchase.handlers.js';
import { StockKeeper } from './stock-keeper.js';
import {
  ActOnIndentCommand,
  CloseRequestCommand,
  CreateIndentCommand,
  CreateIssueCommand,
  CreateRequestCommand,
  CreateTransferCommand,
  DecideIndentCommand,
  DecideTransferCommand,
  EditIndentCommand,
  GetIndentQuery,
  GetIssueQuery,
  GetRequestQuery,
  GetTransferQuery,
  IndentInboxQuery,
  IndentShortfallQuery,
  ListIndentsQuery,
  ListIssuesQuery,
  ListRequestsQuery,
  ListTransfersQuery,
  RaisePurchaseCommand,
  StoreReadRepository,
  type IndentSummary,
  type IndentView,
  type IssueSummary,
  type IssueView,
  type RequestSummary,
  type RequestView,
  type ShortfallLine,
  type TransferSummary,
  type TransferView,
} from './store.messages.js';
import { SCM_INDENT, SCM_ISSUE, SCM_MANAGE, SCM_PURCHASE, SCM_READ } from './supply-chain.constants.js';

/** What the store handlers share. */
@Injectable()
export class StoreDesk {
  constructor(
    readonly desk: PurchaseDesk,
    readonly indents: IndentRepository,
    readonly requests: RequestRepository,
    readonly moves: StoreMoveRepository,
    readonly storeAccess: StoreAccess,
    readonly keeper: StockKeeper,
    readonly ledger: StockLedger,
  ) {}

  async indent(id: string, version: number): Promise<StoreIndent> {
    const indent = await this.indents.findForUpdate(id);
    if (!indent) throw new NotFoundError('store_indent');
    indent.assertVersion(version);
    return indent;
  }

  async request(id: string, version?: number): Promise<StoreRequest> {
    const request = await this.requests.findForUpdate(id);
    if (!request) throw new NotFoundError('store_request');
    if (version !== undefined) request.assertVersion(version);
    return request;
  }

  async mainStoreOf(subStoreId: string): Promise<string> {
    const mainStoreId = await this.storeAccess.mainStoreOf(subStoreId);
    if (!mainStoreId) throw new NotFoundError('sub_store');
    return mainStoreId;
  }

  /** scm:manage overrides the per-store and per-department access lists. */
  private async manages(userId: string): Promise<boolean> {
    return this.desk.access.isAllowed(userId, { permissions: [SCM_MANAGE] });
  }

  async assertMayIndentFor(userId: string, departmentId: string | null): Promise<void> {
    if (!departmentId || (await this.storeAccess.mayIndentFor(userId, departmentId)) || (await this.manages(userId)))
      return;
    throw new ForbiddenError('no_department_access', 'You may not indent for this department');
  }

  async assertMayIssueFrom(userId: string, subStoreId: string): Promise<void> {
    if ((await this.storeAccess.mayIssueFrom(userId, subStoreId)) || (await this.manages(userId))) return;
    throw new ForbiddenError('no_store_access', 'You may not issue from this sub-store');
  }
}

async function indentLevel(stores: StoreDesk, actor: Actor, indent: StoreIndent) {
  const levels = await stores.indents.levels(indent.subStoreId);
  const level = levels.find((entry) => entry.order === indent.currentLevel);
  if (!level) throw new DomainError('store_indent_state', 'The indent is not waiting for an approval');
  const profile = await stores.desk.access.getProfile(actor.userId);
  if (!profile.roleIds.includes(level.roleId)) {
    throw new ForbiddenError('not_approver', `Only the ${level.name} approvers can decide at this level`);
  }
  if (indent.createdBy === actor.userId) {
    throw new ForbiddenError('self_approval', 'You cannot approve an indent you raised');
  }
  return { level, levels };
}

@CommandHandler(CreateIndentCommand)
export class CreateIndentHandler implements ICommandHandler<CreateIndentCommand> {
  constructor(private readonly stores: StoreDesk) {}

  async execute({ actor, header, lines }: CreateIndentCommand) {
    const { desk } = this.stores;
    await desk.access.authorize(actor.userId, { permissions: [SCM_INDENT] });
    await this.stores.assertMayIndentFor(actor.userId, header.departmentId);
    return desk.tx.run(async () => {
      const indent = StoreIndent.draft({
        id: randomUUID(),
        number: await desk.number('SI', header.indentDate),
        header,
        lines,
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await this.stores.indents.insert(indent);
      await desk.record('store_indent', 'drafted', actor, indent.id, { number: indent.number });
      return { id: indent.id, number: indent.number };
    });
  }
}

@CommandHandler(EditIndentCommand)
export class EditIndentHandler implements ICommandHandler<EditIndentCommand> {
  constructor(private readonly stores: StoreDesk) {}

  async execute({ actor, id, version, header, lines }: EditIndentCommand): Promise<void> {
    const { desk } = this.stores;
    await desk.access.authorize(actor.userId, { permissions: [SCM_INDENT] });
    await desk.tx.run(async () => {
      const indent = await this.stores.indent(id, version);
      indent.edit({ header, ...(lines ? { lines } : {}) }, desk.clock.now());
      await this.stores.assertMayIndentFor(actor.userId, indent.departmentId);
      await this.stores.indents.update(indent);
      await desk.record('store_indent', 'edited', actor, id);
    });
  }
}

@CommandHandler(ActOnIndentCommand)
export class ActOnIndentHandler implements ICommandHandler<ActOnIndentCommand> {
  constructor(private readonly stores: StoreDesk) {}

  async execute({ actor, id, version, action }: ActOnIndentCommand): Promise<void> {
    const { desk } = this.stores;
    if (action !== 'acknowledge') await desk.access.authorize(actor.userId, { permissions: [SCM_INDENT] });
    await desk.tx.run(async () => {
      const indent = await this.stores.indent(id, version);
      const now = desk.clock.now();
      if (action === 'delete') {
        indent.assertDeletable();
        await this.stores.indents.delete(id);
      } else {
        if (action === 'submit') indent.submit(await this.stores.indents.levels(indent.subStoreId), now);
        if (action === 'cancel') indent.cancel(now);
        if (action === 'acknowledge') {
          if (indent.createdBy !== actor.userId) {
            throw new ForbiddenError('not_indenter', 'Only the person who raised the indent acknowledges it');
          }
          indent.acknowledge(actor.userId, now);
        }
        await this.stores.indents.update(indent);
      }
      const done = { submit: 'submitted', cancel: 'cancelled', delete: 'deleted', acknowledge: 'acknowledged' };
      await desk.record('store_indent', done[action], actor, id);
    });
  }
}

@CommandHandler(DecideIndentCommand)
export class DecideIndentHandler implements ICommandHandler<DecideIndentCommand> {
  constructor(private readonly stores: StoreDesk) {}

  async execute({ actor, id, version, decision, remarks, quantities }: DecideIndentCommand) {
    const { desk } = this.stores;
    return desk.tx.run(async () => {
      const indent = await this.stores.indent(id, version);
      const { level, levels } = await indentLevel(this.stores, actor, indent);
      const now = desk.clock.now();
      if (decision === 'approve') indent.approve({ level, levels, quantities, by: actor.userId, remarks, now });
      else indent.reject({ level, by: actor.userId, remarks: remarks ?? '', now });
      await this.stores.indents.update(indent);
      await desk.record('store_indent', decision === 'approve' ? 'approved' : 'rejected', actor, id, {
        level: level.name,
        status: indent.status,
      });
      return { status: indent.status };
    });
  }
}

@CommandHandler(CreateRequestCommand)
export class CreateRequestHandler implements ICommandHandler<CreateRequestCommand> {
  constructor(private readonly stores: StoreDesk) {}

  async execute({ actor, subStoreId, requestDate, note, lines }: CreateRequestCommand) {
    const { desk } = this.stores;
    await desk.access.authorize(actor.userId, { permissions: [SCM_INDENT] });
    return desk.tx.run(async () => {
      const request = StoreRequest.open({
        id: randomUUID(),
        number: await desk.number('RQ', requestDate),
        subStoreId,
        mainStoreId: await this.stores.mainStoreOf(subStoreId),
        requestDate,
        note,
        lines,
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await this.stores.requests.insert(request);
      await desk.record('store_request', 'opened', actor, request.id, { number: request.number });
      return { id: request.id, number: request.number };
    });
  }
}

@CommandHandler(CloseRequestCommand)
export class CloseRequestHandler implements ICommandHandler<CloseRequestCommand> {
  constructor(private readonly stores: StoreDesk) {}

  async execute({ actor, id, version }: CloseRequestCommand): Promise<void> {
    const { desk } = this.stores;
    await desk.access.authorize(actor.userId, { permissions: [SCM_INDENT] });
    await desk.tx.run(async () => {
      const request = await this.stores.request(id, version);
      request.close(desk.clock.now());
      await this.stores.requests.update(request);
      await desk.record('store_request', 'closed', actor, id);
    });
  }
}

/** Old PRSubmitted: what the main store cannot give becomes a draft purchase requisition for it. */
@CommandHandler(RaisePurchaseCommand)
export class RaisePurchaseHandler implements ICommandHandler<RaisePurchaseCommand> {
  constructor(private readonly stores: StoreDesk) {}

  async execute({ actor, id, version, requisitionDate }: RaisePurchaseCommand) {
    const { desk } = this.stores;
    await desk.access.authorize(actor.userId, { permissions: [SCM_PURCHASE] });
    return desk.tx.run(async () => {
      const request = await this.stores.request(id, version);
      const now = desk.clock.now();
      const lines = [...request.outstanding().entries()].map(([variantId, requestedQty]) => ({
        variantId,
        requestedQty,
        approvedQty: null,
        description: `For ${request.number}`,
      }));
      if (lines.length === 0) throw new DomainError('nothing_outstanding', 'Everything on the request is served');
      const requisition = PurchaseRequisition.draft({
        id: randomUUID(),
        number: await desk.number('PR', requisitionDate),
        header: {
          mainStoreId: request.mainStoreId,
          subStoreId: request.subStoreId,
          departmentId: null,
          supplierId: null,
          requisitionDate,
          paymentTerm: null,
          note: `Raised from store request ${request.number}`,
          terms: null,
        },
        lines,
        createdBy: actor.userId,
        now,
      });
      await desk.requisitions.insert(requisition);
      request.linkPurchase(requisition.id, now);
      await this.stores.requests.update(request);
      const { number } = requisition.toSnapshot();
      await desk.record('store_request', 'sent_to_purchase', actor, id, { requisition: number });
      return { id: requisition.id, number };
    });
  }
}

/**
 * Old Issue: goods from a sub-store to a department, against an approved indent of that sub-store or
 * without one. Stock is checked and taken by lot (first expiring first, expired lots left out); the old save
 * took no lot, checked no stock and could serve more than was approved.
 */
@CommandHandler(CreateIssueCommand)
export class CreateIssueHandler implements ICommandHandler<CreateIssueCommand> {
  constructor(private readonly stores: StoreDesk) {}

  async execute({ actor, issue }: CreateIssueCommand) {
    const { desk } = this.stores;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ISSUE] });
    await this.stores.assertMayIssueFrom(actor.userId, issue.subStoreId);
    const lines = validMoveLines(issue.lines, 'issue');
    return desk.tx.run(async () => {
      if (issue.indentId) {
        const indent = await this.stores.indents.findForUpdate(issue.indentId);
        if (!indent) throw new NotFoundError('store_indent');
        if (indent.subStoreId !== issue.subStoreId) {
          throw new DomainError('wrong_sub_store', 'The indent is to another sub-store');
        }
        if (indent.departmentId && indent.departmentId !== issue.departmentId) {
          throw new DomainError('wrong_department', 'The indent is for another department');
        }
        indent.serve(quantitiesOf(lines), desk.clock.now());
        await this.stores.indents.update(indent);
      }
      const id = randomUUID();
      const number = await desk.number('IS', issue.issueDate);
      await this.stores.moves.insertIssue({
        ...issue,
        id,
        number,
        note: issue.note?.trim() || null,
        issuedBy: actor.userId,
        lines,
      });
      // The goods leave the sub-store and become the department's stock, lot by lot.
      const document = { id, number, on: issue.issueDate };
      const taken = await this.stores.keeper.takeOut({ subStoreId: issue.subStoreId }, lines, document, 'issue');
      await this.stores.keeper.putIn({ departmentId: issue.departmentId }, taken, document, 'issue', {
        subStoreId: issue.subStoreId,
      });
      await desk.record('store_issue', 'issued', actor, id, { number, lines: lines.length });
      return { id, number };
    });
  }
}

function transferKind(from: StoreRef, to: StoreRef): TransferKind {
  if ('mainStoreId' in from && 'subStoreId' in to) return 'main_to_sub';
  if ('subStoreId' in from && 'mainStoreId' in to) return 'sub_to_main';
  if ('subStoreId' in from && 'subStoreId' in to) {
    if (from.subStoreId === to.subStoreId) throw new DomainError('same_store', 'The stores must differ');
    return 'sub_to_sub';
  }
  throw new DomainError('invalid_transfer', 'Main stores do not transfer to each other');
}

/**
 * Transfers: main store → its sub-store (old SStockTransfer, optionally serving a store request), sub-store →
 * its main store (old SubStoreToMainTransfer) complete at once; sub-store → sub-store (old SCMStockTransfer)
 * waits for the receiving store to accept. Lots and their cost travel with the goods (the old returns and
 * store-to-store moves took no lot).
 */
@CommandHandler(CreateTransferCommand)
export class CreateTransferHandler implements ICommandHandler<CreateTransferCommand> {
  constructor(private readonly stores: StoreDesk) {}

  async execute({ actor, transfer }: CreateTransferCommand) {
    const { desk, keeper } = this.stores;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ISSUE] });
    const kind = transferKind(transfer.from, transfer.to);
    if ('subStoreId' in transfer.from) await this.stores.assertMayIssueFrom(actor.userId, transfer.from.subStoreId);
    const lines = validMoveLines(transfer.lines, 'transfer');
    return desk.tx.run(async () => {
      if (kind !== 'sub_to_sub') {
        const sub =
          'subStoreId' in transfer.to ? transfer.to.subStoreId : (transfer.from as { subStoreId: string }).subStoreId;
        const main =
          'mainStoreId' in transfer.from
            ? transfer.from.mainStoreId
            : (transfer.to as { mainStoreId: string }).mainStoreId;
        if ((await this.stores.mainStoreOf(sub)) !== main) {
          throw new DomainError('wrong_main_store', 'The sub-store belongs to another main store');
        }
      }
      if (transfer.requestId) {
        if (kind !== 'main_to_sub')
          throw new DomainError('invalid_transfer', 'Only main store transfers serve a request');
        const request = await this.stores.request(transfer.requestId);
        if (
          request.subStoreId !== (transfer.to as { subStoreId: string }).subStoreId ||
          request.mainStoreId !== (transfer.from as { mainStoreId: string }).mainStoreId
        ) {
          throw new DomainError('wrong_store', 'The request is between other stores');
        }
        request.serve(quantitiesOf(lines), desk.clock.now());
        await this.stores.requests.update(request);
      }
      const id = randomUUID();
      const number = await desk.number('TR', transfer.transferDate);
      const record: TransferRecord = {
        id,
        number,
        kind,
        from: transfer.from,
        to: transfer.to,
        requestId: transfer.requestId,
        transferDate: transfer.transferDate,
        status: kind === 'sub_to_sub' ? 'pending' : 'completed',
        note: transfer.note?.trim() || null,
        rejectReason: null,
        sentBy: actor.userId,
        decidedBy: null,
        decidedAt: null,
        version: 1,
        lines: lines.map((line) => ({ ...line, acceptedQty: kind === 'sub_to_sub' ? null : line.qty })),
      };
      await this.stores.moves.insertTransfer(record);
      if (kind !== 'sub_to_sub') {
        const document = { id, number, on: transfer.transferDate };
        const taken = await keeper.takeOut(transfer.from, lines, document, 'transfer');
        await keeper.putIn(transfer.to, taken, document, 'transfer', transfer.from);
      }
      await desk.record('stock_transfer', 'sent', actor, id, { number, kind });
      return { id, number, status: record.status };
    });
  }
}

@CommandHandler(DecideTransferCommand)
export class DecideTransferHandler implements ICommandHandler<DecideTransferCommand> {
  constructor(private readonly stores: StoreDesk) {}

  async execute({ actor, id, version, decision, reason, accepted, on }: DecideTransferCommand) {
    const { desk, keeper, moves } = this.stores;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ISSUE] });
    return desk.tx.run(async () => {
      const transfer = await moves.findTransferForUpdate(id);
      if (!transfer) throw new NotFoundError('stock_transfer');
      if (transfer.version !== version) {
        throw new ConflictError('stale_stock_transfer', 'The transfer was changed by someone else; reload it');
      }
      if (transfer.status !== 'pending') {
        throw new DomainError('stock_transfer_state', `A ${transfer.status} transfer cannot be decided`);
      }
      await this.stores.assertMayIssueFrom(actor.userId, (transfer.to as { subStoreId: string }).subStoreId);
      if (decision === 'reject') {
        const text = reason?.trim() ?? '';
        if (text.length === 0) throw new DomainError('invalid_remarks', 'Give a reason');
        transfer.status = 'rejected';
        transfer.rejectReason = text;
      } else {
        if (!on) throw new DomainError('invalid_date', 'Give the date the goods arrived');
        if (on < transfer.transferDate)
          throw new DomainError('invalid_date', 'A transfer is not accepted before it is sent');
        const acceptedNow = acceptedLines(transfer.lines, accepted);
        transfer.lines = acceptedNow;
        const lines = acceptedNow
          .filter((line) => line.acceptedQty > 0)
          .map((line) => ({ ...line, qty: line.acceptedQty }));
        const document = { id, number: transfer.number, on };
        const taken = await keeper.takeOut(transfer.from, lines, document, 'transfer');
        await keeper.putIn(transfer.to, taken, document, 'transfer', transfer.from);
        transfer.status = 'completed';
      }
      transfer.decidedBy = actor.userId;
      transfer.decidedAt = desk.clock.now();
      transfer.version += 1;
      await moves.updateTransfer(transfer);
      await desk.record('stock_transfer', decision === 'accept' ? 'accepted' : 'rejected', actor, id, {
        number: transfer.number,
      });
      return { status: transfer.status };
    });
  }
}

// Queries

@Injectable()
export class StoreQueries {
  constructor(
    readonly read: StoreReadRepository,
    readonly access: AccessControl,
  ) {}

  async authorize(actor: Actor): Promise<void> {
    await this.access.authorize(actor.userId, { permissions: [SCM_READ] });
  }
}

@QueryHandler(ListIndentsQuery)
export class ListIndentsHandler implements IQueryHandler<ListIndentsQuery> {
  constructor(private readonly queries: StoreQueries) {}
  async execute({ actor, filter }: ListIndentsQuery): Promise<Page<IndentSummary>> {
    await this.queries.authorize(actor);
    return this.queries.read.listIndents(filter);
  }
}

@QueryHandler(GetIndentQuery)
export class GetIndentHandler implements IQueryHandler<GetIndentQuery> {
  constructor(private readonly queries: StoreQueries) {}
  async execute({ actor, id }: GetIndentQuery): Promise<IndentView> {
    await this.queries.authorize(actor);
    const indent = await this.queries.read.getIndent(id);
    if (!indent) throw new NotFoundError('store_indent');
    return indent;
  }
}

/** Anyone signed in: only the indents waiting for one of their roles. */
@QueryHandler(IndentInboxQuery)
export class IndentInboxHandler implements IQueryHandler<IndentInboxQuery> {
  constructor(private readonly queries: StoreQueries) {}
  async execute({ actor }: IndentInboxQuery): Promise<IndentSummary[]> {
    const { roleIds } = await this.queries.access.getProfile(actor.userId);
    return roleIds.length === 0 ? [] : this.queries.read.indentInbox(roleIds);
  }
}

/** Old PR-indent shortfall: approved and not issued, less what the sub-store holds (expired lots left out). */
@QueryHandler(IndentShortfallQuery)
export class IndentShortfallHandler implements IQueryHandler<IndentShortfallQuery> {
  constructor(
    private readonly queries: StoreQueries,
    private readonly indents: IndentRepository,
    private readonly ledger: StockLedger,
  ) {}

  async execute({ actor, id, on }: IndentShortfallQuery): Promise<ShortfallLine[]> {
    await this.queries.authorize(actor);
    const indent = await this.indents.findForUpdate(id);
    if (!indent) throw new NotFoundError('store_indent');
    const open = indent.open();
    const balances = await this.ledger.balances({ subStoreId: indent.subStoreId }, [...open.keys()]);
    const items = await this.queries.read.items([...open.keys()]);
    return [...open.entries()].map(([variantId, qty]) => {
      const inStock =
        Math.round(
          (balances.get(variantId) ?? [])
            .filter((lot) => lot.expiryDate === null || lot.expiryDate > on)
            .reduce((sum, lot) => sum + lot.qty, 0) * 1000,
        ) / 1000;
      return {
        ...items.get(variantId)!,
        open: qty,
        inStock,
        shortfall: Math.max(0, Math.round((qty - inStock) * 1000) / 1000),
      };
    });
  }
}

@QueryHandler(ListRequestsQuery)
export class ListRequestsHandler implements IQueryHandler<ListRequestsQuery> {
  constructor(private readonly queries: StoreQueries) {}
  async execute({ actor, filter }: ListRequestsQuery): Promise<Page<RequestSummary>> {
    await this.queries.authorize(actor);
    return this.queries.read.listRequests(filter);
  }
}

@QueryHandler(GetRequestQuery)
export class GetRequestHandler implements IQueryHandler<GetRequestQuery> {
  constructor(private readonly queries: StoreQueries) {}
  async execute({ actor, id }: GetRequestQuery): Promise<RequestView> {
    await this.queries.authorize(actor);
    const request = await this.queries.read.getRequest(id);
    if (!request) throw new NotFoundError('store_request');
    return request;
  }
}

@QueryHandler(ListIssuesQuery)
export class ListIssuesHandler implements IQueryHandler<ListIssuesQuery> {
  constructor(private readonly queries: StoreQueries) {}
  async execute({ actor, filter }: ListIssuesQuery): Promise<Page<IssueSummary>> {
    await this.queries.authorize(actor);
    return this.queries.read.listIssues(filter);
  }
}

@QueryHandler(GetIssueQuery)
export class GetIssueHandler implements IQueryHandler<GetIssueQuery> {
  constructor(private readonly queries: StoreQueries) {}
  async execute({ actor, id }: GetIssueQuery): Promise<IssueView> {
    await this.queries.authorize(actor);
    const issue = await this.queries.read.getIssue(id);
    if (!issue) throw new NotFoundError('store_issue');
    return issue;
  }
}

@QueryHandler(ListTransfersQuery)
export class ListTransfersHandler implements IQueryHandler<ListTransfersQuery> {
  constructor(private readonly queries: StoreQueries) {}
  async execute({ actor, filter }: ListTransfersQuery): Promise<Page<TransferSummary>> {
    await this.queries.authorize(actor);
    return this.queries.read.listTransfers(filter);
  }
}

@QueryHandler(GetTransferQuery)
export class GetTransferHandler implements IQueryHandler<GetTransferQuery> {
  constructor(private readonly queries: StoreQueries) {}
  async execute({ actor, id }: GetTransferQuery): Promise<TransferView> {
    await this.queries.authorize(actor);
    const transfer = await this.queries.read.getTransfer(id);
    if (!transfer) throw new NotFoundError('stock_transfer');
    return transfer;
  }
}

export const STORE_HANDLERS = [
  StoreDesk,
  StoreQueries,
  StockKeeper,
  CreateIndentHandler,
  EditIndentHandler,
  ActOnIndentHandler,
  DecideIndentHandler,
  CreateRequestHandler,
  CloseRequestHandler,
  RaisePurchaseHandler,
  CreateIssueHandler,
  CreateTransferHandler,
  DecideTransferHandler,
  ListIndentsHandler,
  GetIndentHandler,
  IndentInboxHandler,
  IndentShortfallHandler,
  ListRequestsHandler,
  GetRequestHandler,
  ListIssuesHandler,
  GetIssueHandler,
  ListTransfersHandler,
  GetTransferHandler,
];
