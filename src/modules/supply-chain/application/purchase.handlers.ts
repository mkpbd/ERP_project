import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { StaffDirectory } from '../../../shared/application/contracts/staff-directory.js';
import type { Page } from '../../../shared/application/pagination.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { ComparativeStudy } from '../domain/comparative-study.js';
import { documentNumber, type ApprovalLevel } from '../domain/documents.js';
import { orderTotals, PurchaseOrder, type OrderAllowance } from '../domain/purchase-order.js';
import { PurchaseRequisition } from '../domain/requisition.js';
import {
  ApprovalLevels,
  OrderRepository,
  RequisitionRepository,
  ScmSequences,
  StudyRepository,
} from '../domain/repositories.js';
import {
  ActOnRequisitionCommand,
  ActOnStudyCommand,
  CancelOrderCommand,
  CreateOrderCommand,
  CreateRequisitionCommand,
  CreateStudyCommand,
  DecideRequisitionCommand,
  DecideStudyCommand,
  EditOrderCommand,
  EditRequisitionCommand,
  EditStudyCommand,
  GetOrderQuery,
  GetRequisitionQuery,
  GetStudyQuery,
  ListOrdersQuery,
  ListRequisitionsQuery,
  ListStudiesQuery,
  PurchaseReadRepository,
  RequisitionInboxQuery,
  StudyInboxQuery,
  type OrderSummary,
  type OrderView,
  type RequisitionSummary,
  type RequisitionView,
  type StudySummary,
  type StudyView,
} from './purchase.messages.js';
import { SCM_PURCHASE, SCM_READ } from './supply-chain.constants.js';

/** What the purchase handlers share: access, transactions, numbering and the audit trail. */
@Injectable()
export class PurchaseDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly sequences: ScmSequences,
    readonly levels: ApprovalLevels,
    readonly staff: StaffDirectory,
    readonly requisitions: RequisitionRepository,
    readonly studies: StudyRepository,
    readonly orders: OrderRepository,
  ) {}

  async number(kind: 'PR' | 'CS' | 'PO' | 'SR' | 'OS', date: string): Promise<string> {
    const year = Number(date.slice(0, 4));
    return documentNumber(kind, year, await this.sequences.next(kind, year));
  }

  record(
    resourceType: string,
    action: string,
    actor: Actor,
    id: string,
    metadata: Record<string, string | number | boolean | string[] | null> = {},
  ): Promise<void> {
    return this.audit.record({
      action: `scm.${resourceType}_${action}`,
      actorUserId: actor.userId,
      resourceType,
      resourceId: id,
      metadata,
    });
  }

  async requisition(id: string, version: number): Promise<PurchaseRequisition> {
    const requisition = await this.requisitions.findForUpdate(id);
    if (!requisition) throw new NotFoundError('purchase_requisition');
    requisition.assertVersion(version);
    return requisition;
  }

  async study(id: string, version: number): Promise<ComparativeStudy> {
    const study = await this.studies.findForUpdate(id);
    if (!study) throw new NotFoundError('comparative_study');
    study.assertVersion(version);
    return study;
  }

  async order(id: string, version: number): Promise<PurchaseOrder> {
    const order = await this.orders.findForUpdate(id);
    if (!order) throw new NotFoundError('purchase_order');
    order.assertVersion(version);
    return order;
  }

  /** What an approved requisition still allows to be ordered, leaving out one order's own lines. */
  async allowance(requisitionId: string | null, exceptOrderId?: string): Promise<OrderAllowance | null> {
    if (!requisitionId) return null;
    const requisition = await this.requisitions.findForUpdate(requisitionId);
    if (!requisition) throw new NotFoundError('purchase_requisition');
    if (requisition.status !== 'approved') {
      throw new DomainError('requisition_not_approved', `The requisition is ${requisition.status}, not approved`);
    }
    const ordered = await this.orders.orderedFor(requisitionId, exceptOrderId);
    return new Map(
      requisition.lines
        .filter((line) => (line.approvedQty ?? 0) > 0)
        .map((line) => [
          line.variantId,
          Math.round(((line.approvedQty ?? 0) - (ordered.get(line.variantId) ?? 0)) * 1000) / 1000,
        ]),
    );
  }
}

/** The requisition level the actor may decide at: they must hold the level's role and not have raised it. */
async function requisitionLevel(desk: PurchaseDesk, actor: Actor, requisition: PurchaseRequisition) {
  const levels = await desk.levels.purchase(requisition.mainStoreId);
  const level = levels.find((entry) => entry.order === requisition.currentLevel);
  if (!level) throw new DomainError('requisition_state', 'The requisition is not waiting for an approval');
  const profile = await desk.access.getProfile(actor.userId);
  if (!profile.roleIds.includes(level.roleId)) {
    throw new ForbiddenError('not_approver', `Only the ${level.name} approvers can decide at this level`);
  }
  if (requisition.toSnapshot().createdBy === actor.userId) {
    throw new ForbiddenError('self_approval', 'You cannot approve a requisition you raised');
  }
  return { level, levels };
}

@CommandHandler(CreateRequisitionCommand)
export class CreateRequisitionHandler implements ICommandHandler<CreateRequisitionCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, header, lines }: CreateRequisitionCommand) {
    await this.desk.access.authorize(actor.userId, { permissions: [SCM_PURCHASE] });
    return this.desk.tx.run(async () => {
      const requisition = PurchaseRequisition.draft({
        id: randomUUID(),
        number: await this.desk.number('PR', header.requisitionDate),
        header,
        lines: lines.map((line) => ({ ...line, approvedQty: null })),
        createdBy: actor.userId,
        now: this.desk.clock.now(),
      });
      await this.desk.requisitions.insert(requisition);
      const { id, number } = requisition.toSnapshot();
      await this.desk.record('purchase_requisition', 'drafted', actor, id, { number });
      return { id, number };
    });
  }
}

@CommandHandler(EditRequisitionCommand)
export class EditRequisitionHandler implements ICommandHandler<EditRequisitionCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, id, version, header, lines }: EditRequisitionCommand): Promise<void> {
    await this.desk.access.authorize(actor.userId, { permissions: [SCM_PURCHASE] });
    await this.desk.tx.run(async () => {
      const requisition = await this.desk.requisition(id, version);
      requisition.edit(
        { header, ...(lines ? { lines: lines.map((line) => ({ ...line, approvedQty: null })) } : {}) },
        this.desk.clock.now(),
      );
      await this.desk.requisitions.update(requisition);
      await this.desk.record('purchase_requisition', 'edited', actor, id);
    });
  }
}

@CommandHandler(ActOnRequisitionCommand)
export class ActOnRequisitionHandler implements ICommandHandler<ActOnRequisitionCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, id, version, action }: ActOnRequisitionCommand): Promise<void> {
    await this.desk.access.authorize(actor.userId, { permissions: [SCM_PURCHASE] });
    await this.desk.tx.run(async () => {
      const requisition = await this.desk.requisition(id, version);
      const now = this.desk.clock.now();
      if (action === 'delete') {
        requisition.assertDeletable();
        await this.desk.requisitions.delete(id);
      } else {
        if (action === 'submit') requisition.submit(await this.desk.levels.purchase(requisition.mainStoreId), now);
        if (action === 'cancel') {
          if (await this.desk.orders.hasOrders(id)) {
            throw new DomainError('requisition_ordered', 'Orders use the requisition; cancel them first');
          }
          requisition.cancel(now);
        }
        await this.desk.requisitions.update(requisition);
      }
      await this.desk.record('purchase_requisition', action === 'submit' ? 'submitted' : `${action}d`, actor, id);
    });
  }
}

@CommandHandler(DecideRequisitionCommand)
export class DecideRequisitionHandler implements ICommandHandler<DecideRequisitionCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, id, version, decision, remarks, quantities }: DecideRequisitionCommand) {
    return this.desk.tx.run(async () => {
      const requisition = await this.desk.requisition(id, version);
      const { level, levels } = await requisitionLevel(this.desk, actor, requisition);
      const now = this.desk.clock.now();
      if (decision === 'approve') {
        requisition.approve({ level, levels, quantities, by: actor.userId, remarks, now });
      } else {
        requisition.reject({ level, by: actor.userId, remarks: remarks ?? '', now });
      }
      await this.desk.requisitions.update(requisition);
      await this.desk.record('purchase_requisition', decision === 'approve' ? 'approved' : 'rejected', actor, id, {
        level: level.name,
        status: requisition.status,
      });
      return { status: requisition.status };
    });
  }
}

@QueryHandler(ListRequisitionsQuery)
export class ListRequisitionsHandler implements IQueryHandler<ListRequisitionsQuery> {
  constructor(
    private readonly read: PurchaseReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListRequisitionsQuery): Promise<Page<RequisitionSummary>> {
    await this.access.authorize(actor.userId, { permissions: [SCM_READ] });
    return this.read.listRequisitions(filter);
  }
}

@QueryHandler(GetRequisitionQuery)
export class GetRequisitionHandler implements IQueryHandler<GetRequisitionQuery> {
  constructor(
    private readonly read: PurchaseReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetRequisitionQuery): Promise<RequisitionView> {
    await this.access.authorize(actor.userId, { permissions: [SCM_READ] });
    const requisition = await this.read.getRequisition(id);
    if (!requisition) throw new NotFoundError('purchase_requisition');
    return requisition;
  }
}

/** Anyone signed in: the list holds only what their roles may approve. */
@QueryHandler(RequisitionInboxQuery)
export class RequisitionInboxHandler implements IQueryHandler<RequisitionInboxQuery> {
  constructor(
    private readonly read: PurchaseReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor }: RequisitionInboxQuery): Promise<RequisitionSummary[]> {
    const { roleIds } = await this.access.getProfile(actor.userId);
    return roleIds.length === 0 ? [] : this.read.requisitionInbox(roleIds);
  }
}

/** The study level the actor may decide at: they must be the level's approver. */
async function studyLevel(desk: PurchaseDesk, actor: Actor, study: ComparativeStudy) {
  const levels = await desk.levels.study();
  const level = levels.find((entry) => entry.order === study.currentLevel);
  if (!level) throw new DomainError('comparative_study_state', 'The study is not waiting for an approval');
  if ((await desk.staff.staffIdForUser(actor.userId)) !== level.approverStaffId) {
    throw new ForbiddenError('not_approver', `Only the ${level.name} approver can decide at this level`);
  }
  return { level: level as ApprovalLevel, levels };
}

async function checkStudyRequisition(desk: PurchaseDesk, requisitionId: string | null | undefined) {
  if (!requisitionId) return;
  const status = await desk.studies.requisitionStatus(requisitionId);
  if (status === null) throw new NotFoundError('purchase_requisition');
  if (status !== 'approved' && status !== 'pending') {
    throw new DomainError('requisition_not_open', `The requisition is ${status}`);
  }
}

@CommandHandler(CreateStudyCommand)
export class CreateStudyHandler implements ICommandHandler<CreateStudyCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, header, quotes }: CreateStudyCommand) {
    await this.desk.access.authorize(actor.userId, { permissions: [SCM_PURCHASE] });
    return this.desk.tx.run(async () => {
      await checkStudyRequisition(this.desk, header.requisitionId);
      const study = ComparativeStudy.draft({
        id: randomUUID(),
        number: await this.desk.number('CS', header.studyDate),
        header,
        quotes: quotes.map((quote) => ({ ...quote, id: randomUUID() })),
        createdBy: actor.userId,
        now: this.desk.clock.now(),
      });
      await this.desk.studies.insert(study);
      const { id, number } = study.toSnapshot();
      await this.desk.record('comparative_study', 'drafted', actor, id, { number });
      return { id, number };
    });
  }
}

@CommandHandler(EditStudyCommand)
export class EditStudyHandler implements ICommandHandler<EditStudyCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, id, version, header, quotes }: EditStudyCommand): Promise<void> {
    await this.desk.access.authorize(actor.userId, { permissions: [SCM_PURCHASE] });
    await this.desk.tx.run(async () => {
      const study = await this.desk.study(id, version);
      if (header.requisitionId !== undefined) await checkStudyRequisition(this.desk, header.requisitionId);
      study.edit(
        { header, ...(quotes ? { quotes: quotes.map((quote) => ({ ...quote, id: randomUUID() })) } : {}) },
        this.desk.clock.now(),
      );
      await this.desk.studies.update(study);
      await this.desk.record('comparative_study', 'edited', actor, id);
    });
  }
}

@CommandHandler(ActOnStudyCommand)
export class ActOnStudyHandler implements ICommandHandler<ActOnStudyCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, id, version, action }: ActOnStudyCommand): Promise<void> {
    await this.desk.access.authorize(actor.userId, { permissions: [SCM_PURCHASE] });
    await this.desk.tx.run(async () => {
      const study = await this.desk.study(id, version);
      if (action === 'delete') {
        study.assertDeletable();
        await this.desk.studies.delete(id);
      } else {
        study.submit(await this.desk.levels.study(), this.desk.clock.now());
        await this.desk.studies.update(study);
      }
      await this.desk.record('comparative_study', action === 'submit' ? 'submitted' : 'deleted', actor, id);
    });
  }
}

@CommandHandler(DecideStudyCommand)
export class DecideStudyHandler implements ICommandHandler<DecideStudyCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, id, version, decision, remarks, keep }: DecideStudyCommand) {
    return this.desk.tx.run(async () => {
      const study = await this.desk.study(id, version);
      const { level, levels } = await studyLevel(this.desk, actor, study);
      const now = this.desk.clock.now();
      if (decision === 'approve') study.approve({ level, levels, keep, by: actor.userId, remarks, now });
      else study.reject({ level, by: actor.userId, remarks: remarks ?? '', now });
      await this.desk.studies.update(study);
      await this.desk.record('comparative_study', decision === 'approve' ? 'approved' : 'rejected', actor, id, {
        level: level.name,
        status: study.status,
        kept: decision === 'approve' ? keep.length : 0,
      });
      return { status: study.status };
    });
  }
}

@QueryHandler(ListStudiesQuery)
export class ListStudiesHandler implements IQueryHandler<ListStudiesQuery> {
  constructor(
    private readonly read: PurchaseReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListStudiesQuery): Promise<Page<StudySummary>> {
    await this.access.authorize(actor.userId, { permissions: [SCM_READ] });
    return this.read.listStudies(filter);
  }
}

@QueryHandler(GetStudyQuery)
export class GetStudyHandler implements IQueryHandler<GetStudyQuery> {
  constructor(
    private readonly read: PurchaseReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetStudyQuery): Promise<StudyView> {
    await this.access.authorize(actor.userId, { permissions: [SCM_READ] });
    const study = await this.read.getStudy(id);
    if (!study) throw new NotFoundError('comparative_study');
    return study;
  }
}

/** Anyone signed in: the list holds only the studies waiting for them. */
@QueryHandler(StudyInboxQuery)
export class StudyInboxHandler implements IQueryHandler<StudyInboxQuery> {
  constructor(
    private readonly read: PurchaseReadRepository,
    private readonly staff: StaffDirectory,
  ) {}

  async execute({ actor }: StudyInboxQuery): Promise<StudySummary[]> {
    const staffId = await this.staff.staffIdForUser(actor.userId);
    return staffId ? this.read.studyInbox(staffId) : [];
  }
}

@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, header, lines }: CreateOrderCommand) {
    await this.desk.access.authorize(actor.userId, { permissions: [SCM_PURCHASE] });
    return this.desk.tx.run(async () => {
      // Orders of one requisition are serialized, so two of them cannot both take the last approved quantity.
      if (header.requisitionId) await this.desk.tx.lock(`scm:requisition-orders:${header.requisitionId}`);
      const allowance = await this.desk.allowance(header.requisitionId);
      if (allowance && header.requisitionId) {
        const requisition = await this.desk.requisitions.findForUpdate(header.requisitionId);
        if (requisition?.mainStoreId !== header.mainStoreId) {
          throw new DomainError('wrong_main_store', "The order must go to the requisition's main store");
        }
      }
      if (header.comparativeStudyId) {
        const winners = await this.desk.orders.studyWinners(header.comparativeStudyId);
        if (!winners) throw new DomainError('study_not_approved', 'The comparative study is not approved');
        if (!winners.supplierIds.has(header.supplierId)) {
          throw new DomainError('supplier_not_chosen', 'The supplier did not win any quote of the study');
        }
      }
      const order = PurchaseOrder.open({
        id: randomUUID(),
        number: await this.desk.number('PO', header.orderDate),
        header,
        lines,
        allowance,
        createdBy: actor.userId,
        now: this.desk.clock.now(),
      });
      await this.desk.orders.insert(order);
      const { id, number } = order.toSnapshot();
      await this.desk.record('purchase_order', 'opened', actor, id, { number, total: orderTotals(lines).total });
      return { id, number };
    });
  }
}

@CommandHandler(EditOrderCommand)
export class EditOrderHandler implements ICommandHandler<EditOrderCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, id, version, header, lines }: EditOrderCommand): Promise<void> {
    await this.desk.access.authorize(actor.userId, { permissions: [SCM_PURCHASE] });
    await this.desk.tx.run(async () => {
      const order = await this.desk.order(id, version);
      if (order.requisitionId) await this.desk.tx.lock(`scm:requisition-orders:${order.requisitionId}`);
      const allowance = lines ? await this.desk.allowance(order.requisitionId, id) : null;
      order.edit({ header, ...(lines ? { lines } : {}) }, allowance, this.desk.clock.now());
      await this.desk.orders.update(order);
      await this.desk.record('purchase_order', 'edited', actor, id, { total: orderTotals(order.lines).total });
    });
  }
}

@CommandHandler(CancelOrderCommand)
export class CancelOrderHandler implements ICommandHandler<CancelOrderCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, id, version, reason }: CancelOrderCommand): Promise<void> {
    await this.desk.access.authorize(actor.userId, { permissions: [SCM_PURCHASE] });
    await this.desk.tx.run(async () => {
      const order = await this.desk.order(id, version);
      order.cancel(reason, this.desk.clock.now());
      await this.desk.orders.update(order);
      await this.desk.record('purchase_order', 'cancelled', actor, id, { reason });
    });
  }
}

@QueryHandler(ListOrdersQuery)
export class ListOrdersHandler implements IQueryHandler<ListOrdersQuery> {
  constructor(
    private readonly read: PurchaseReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListOrdersQuery): Promise<Page<OrderSummary>> {
    await this.access.authorize(actor.userId, { permissions: [SCM_READ] });
    return this.read.listOrders(filter);
  }
}

@QueryHandler(GetOrderQuery)
export class GetOrderHandler implements IQueryHandler<GetOrderQuery> {
  constructor(
    private readonly read: PurchaseReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetOrderQuery): Promise<OrderView> {
    await this.access.authorize(actor.userId, { permissions: [SCM_READ] });
    const order = await this.read.getOrder(id);
    if (!order) throw new NotFoundError('purchase_order');
    return order;
  }
}

export const PURCHASE_HANDLERS = [
  PurchaseDesk,
  CreateRequisitionHandler,
  EditRequisitionHandler,
  ActOnRequisitionHandler,
  DecideRequisitionHandler,
  ListRequisitionsHandler,
  GetRequisitionHandler,
  RequisitionInboxHandler,
  CreateStudyHandler,
  EditStudyHandler,
  ActOnStudyHandler,
  DecideStudyHandler,
  ListStudiesHandler,
  GetStudyHandler,
  StudyInboxHandler,
  CreateOrderHandler,
  EditOrderHandler,
  CancelOrderHandler,
  ListOrdersHandler,
  GetOrderHandler,
];
