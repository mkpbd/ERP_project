import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { LedgerPosting, type LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { documentNumber, MAX_DOCUMENT_LINES, text, validAmount, validRate, validUnits } from '../domain/documents.js';
import { PharmacyOrder } from '../domain/purchase-order.js';
import { PharmacyReceive, type ReceiveHeader } from '../domain/receive.js';
import {
  OpeningRepository,
  OrderRepository,
  PharmacyFacts,
  PharmacyLedger,
  PharmacySequences,
  ReceiveRepository,
  type NewMovement,
  type PayableSupplier,
} from '../domain/repositories.js';
import {
  CreateOrderCommand,
  CreateReceiveCommand,
  DeleteReceiveCommand,
  EditOrderCommand,
  EditReceiveCommand,
  EndOrderCommand,
  EnterOpeningStockCommand,
  GetOrderQuery,
  GetReceiveQuery,
  GetStockCardQuery,
  GetStockQuery,
  ListOrdersQuery,
  ListReceivesQuery,
  PharmacyReadRepository,
  PostReceiveCommand,
} from './purchase.messages.js';
import { PHARMACY_MANAGE, PHARMACY_PURCHASE, PHARMACY_READ, PHARMACY_RECEIVE } from './pharmacy.constants.js';

/** The journal purchases post to. */
export const PURCHASE_JOURNAL = 'JV';
/** GL roles: the pharmacy's medicine inventory, and the payable for suppliers without their own account. */
export const PHARMACY_INVENTORY_ROLE = 'pharmacy_inventory';
export const SUPPLIER_PAYABLE_ROLE = 'supplier_payable';

export type DocumentKind =
  'PO' | 'GR' | 'OP' | 'SP' | 'RT' | 'OI' | 'TT' | 'SI' | 'DC' | 'SR' | 'SC' | 'WN' | 'WI' | 'WR' | 'LC';

/** What the purchase and stock handlers share. */
@Injectable()
export class PharmacyDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly sequences: PharmacySequences,
    readonly facts: PharmacyFacts,
    readonly ledger: PharmacyLedger,
    readonly posting: LedgerPosting,
    readonly orders: OrderRepository,
    readonly receives: ReceiveRepository,
    readonly openings: OpeningRepository,
  ) {}

  async number(kind: DocumentKind, date: string): Promise<string> {
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
      action: `pharmacy.${resourceType}_${action}`,
      actorUserId: actor.userId,
      resourceType,
      resourceId: id,
      metadata,
    });
  }

  async supplier(id: string): Promise<PayableSupplier> {
    const supplier = await this.facts.supplier(id);
    if (!supplier) throw new NotFoundError('supplier');
    if (!supplier.isActive) throw new DomainError('inactive_supplier', 'The supplier is inactive');
    return supplier;
  }

  /** Working at the outlet, or pharmacy:manage. */
  async assertWorksAt(userId: string, outletId: string): Promise<void> {
    if (!(await this.facts.outletExists(outletId))) throw new NotFoundError('outlet');
    if (await this.facts.worksAt(userId, outletId)) return;
    if (await this.access.isAllowed(userId, { permissions: [PHARMACY_MANAGE] })) return;
    throw new ForbiddenError('no_outlet_access', 'You do not work at this outlet');
  }

  async order(id: string, version?: number): Promise<PharmacyOrder> {
    const order = await this.orders.findForUpdate(id);
    if (!order) throw new NotFoundError('purchase_order');
    if (version !== undefined) order.assertVersion(version);
    return order;
  }

  async receive(id: string, version: number): Promise<PharmacyReceive> {
    const receive = await this.receives.findForUpdate(id);
    if (!receive) throw new NotFoundError('pharmacy_receive');
    receive.assertVersion(version);
    return receive;
  }

  /** The order a receive is against: open or partly received, from the same supplier for the same outlet. */
  async orderFor(header: ReceiveHeader): Promise<PharmacyOrder | null> {
    if (!header.purchaseOrderId) return null;
    const order = await this.order(header.purchaseOrderId);
    if (order.header.supplierId !== header.supplierId || order.header.outletId !== header.outletId) {
      throw new DomainError('order_mismatch', 'The order is for another supplier or outlet');
    }
    if (order.status !== 'open' && order.status !== 'partly_received') {
      throw new DomainError('purchase_order_state', `A ${order.status.replace('_', ' ')} order takes no receives`);
    }
    return order;
  }
}

/** Cost per unit to four decimals. */
const unitCost = (total: number, qty: number) => Math.round((total / qty) * 10_000) / 10_000;

@CommandHandler(CreateOrderCommand)
export class CreateOrderHandler implements ICommandHandler<CreateOrderCommand> {
  constructor(private readonly desk: PharmacyDesk) {}

  async execute({ actor, header, lines }: CreateOrderCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_PURCHASE] });
    return desk.tx.run(async () => {
      await desk.supplier(header.supplierId);
      if (!(await desk.facts.outletExists(header.outletId))) throw new NotFoundError('outlet');
      await desk.facts.products(lines.map((line) => line.productId));
      const order = PharmacyOrder.open({
        id: randomUUID(),
        number: await desk.number('PO', header.orderDate),
        header,
        lines,
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await desk.orders.insert(order);
      await desk.record('purchase_order', 'opened', actor, order.id, { number: order.number });
      return { id: order.id, number: order.number };
    });
  }
}

@CommandHandler(EditOrderCommand)
export class EditOrderHandler implements ICommandHandler<EditOrderCommand> {
  constructor(private readonly desk: PharmacyDesk) {}

  async execute({ actor, id, version, header, lines }: EditOrderCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_PURCHASE] });
    await desk.tx.run(async () => {
      const order = await desk.order(id, version);
      order.edit({ header, ...(lines ? { lines } : {}) }, desk.clock.now());
      await desk.supplier(order.header.supplierId);
      if (!(await desk.facts.outletExists(order.header.outletId))) throw new NotFoundError('outlet');
      await desk.facts.products(order.lines.map((line) => line.productId));
      await desk.orders.update(order);
      await desk.record('purchase_order', 'edited', actor, id);
    });
  }
}

@CommandHandler(EndOrderCommand)
export class EndOrderHandler implements ICommandHandler<EndOrderCommand> {
  constructor(private readonly desk: PharmacyDesk) {}

  async execute({ actor, id, version, action, reason }: EndOrderCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_PURCHASE] });
    await desk.tx.run(async () => {
      const order = await desk.order(id, version);
      if (action === 'cancel') order.cancel(reason, desk.clock.now());
      else order.close(reason, desk.clock.now());
      await desk.orders.update(order);
      await desk.record('purchase_order', action === 'cancel' ? 'cancelled' : 'closed', actor, id, { reason });
    });
  }
}

@CommandHandler(CreateReceiveCommand)
export class CreateReceiveHandler implements ICommandHandler<CreateReceiveCommand> {
  constructor(private readonly desk: PharmacyDesk) {}

  async execute({ actor, header, lines }: CreateReceiveCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_RECEIVE] });
    return desk.tx.run(async () => {
      await desk.assertWorksAt(actor.userId, header.outletId);
      await desk.supplier(header.supplierId);
      await desk.orderFor(header);
      await desk.facts.products(lines.map((line) => line.productId));
      const receive = PharmacyReceive.draft({
        id: randomUUID(),
        number: await desk.number('GR', header.receivedOn),
        header,
        lines,
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await desk.receives.insert(receive);
      await desk.record('receive', 'drafted', actor, receive.id, { number: receive.number, total: receive.total });
      return { id: receive.id, number: receive.number };
    });
  }
}

@CommandHandler(EditReceiveCommand)
export class EditReceiveHandler implements ICommandHandler<EditReceiveCommand> {
  constructor(private readonly desk: PharmacyDesk) {}

  async execute({ actor, id, version, header, lines }: EditReceiveCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_RECEIVE] });
    await desk.tx.run(async () => {
      const receive = await desk.receive(id, version);
      await desk.assertWorksAt(actor.userId, receive.header.outletId);
      receive.edit({ header, ...(lines ? { lines } : {}) }, desk.clock.now());
      await desk.assertWorksAt(actor.userId, receive.header.outletId);
      await desk.supplier(receive.header.supplierId);
      await desk.orderFor(receive.header);
      await desk.facts.products(receive.lines.map((line) => line.productId));
      await desk.receives.update(receive);
      await desk.record('receive', 'edited', actor, id, { total: receive.total });
    });
  }
}

/**
 * Posting: the order takes the paid quantities (not beyond what is still to come), each line goes into stock in
 * its lot, bonus units included, at its own unit cost (line total with VAT, less discount, over every unit), the
 * products' purchase and sale price become the received rates, and the purchase is posted Dr pharmacy inventory /
 * Cr the supplier's payable on its sub-ledger.
 */
@CommandHandler(PostReceiveCommand)
export class PostReceiveHandler implements ICommandHandler<PostReceiveCommand> {
  constructor(private readonly desk: PharmacyDesk) {}

  async execute({ actor, id, version }: PostReceiveCommand): Promise<{ voucherNumber: string | null }> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_RECEIVE] });
    return desk.tx.run(async () => {
      const now = desk.clock.now();
      const receive = await desk.receive(id, version);
      const { header } = receive;
      await desk.assertWorksAt(actor.userId, header.outletId);
      const supplier = await desk.supplier(header.supplierId);
      const products = await desk.facts.products(receive.lines.map((line) => line.productId));
      const order = await desk.orderFor(header);
      if (order) {
        order.receive(receive.quantities(), now);
        await desk.orders.update(order);
      }
      const narration = [
        `Medicine receive ${receive.number} from ${supplier.name}`,
        header.supplierInvoiceNo ? `invoice ${header.supplierInvoiceNo}` : null,
        order ? `order ${order.number}` : null,
      ]
        .filter(Boolean)
        .join(', ');
      const lines: LedgerPostingLine[] = [
        { account: { role: PHARMACY_INVENTORY_ROLE }, debit: receive.total, credit: 0, narration },
        {
          account: supplier.glAccountId ? { id: supplier.glAccountId } : { role: SUPPLIER_PAYABLE_ROLE },
          debit: 0,
          credit: receive.total,
          narration,
          subLedgerId: supplier.subLedgerId,
        },
      ];
      const voucher =
        receive.total > 0
          ? await desk.posting.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: header.receivedOn,
              narration,
              source: { module: 'pharmacy', reference: receive.id },
              lines,
              postedBy: actor.userId,
            })
          : null;
      receive.post({
        products,
        voucher: voucher && { id: voucher.voucherId, number: voucher.number },
        by: actor.userId,
        now,
      });
      const lotIds: string[] = [];
      const movements: NewMovement[] = [];
      for (const line of receive.lines) {
        const lotId = await desk.ledger.lot(line.productId, line.batchNo, line.expiryDate, line.saleRate);
        lotIds.push(lotId);
        movements.push({
          outletId: header.outletId,
          productId: line.productId,
          lotId,
          qty: line.qty + line.bonusQty,
          unitCost: unitCost(line.total, line.qty + line.bonusQty),
          movedOn: header.receivedOn,
          kind: 'receive',
          documentId: receive.id,
          documentNumber: receive.number,
        });
      }
      await desk.ledger.add(movements);
      await desk.receives.update(receive);
      await desk.receives.setLots(receive.id, lotIds);
      await desk.facts.updatePrices(
        new Map(
          receive.lines.map((line) => [line.productId, { purchaseRate: line.purchaseRate, saleRate: line.saleRate }]),
        ),
      );
      await desk.record('receive', 'posted', actor, id, {
        number: receive.number,
        total: receive.total,
        voucher: voucher?.number ?? null,
      });
      return { voucherNumber: voucher?.number ?? null };
    });
  }
}

@CommandHandler(DeleteReceiveCommand)
export class DeleteReceiveHandler implements ICommandHandler<DeleteReceiveCommand> {
  constructor(private readonly desk: PharmacyDesk) {}

  async execute({ actor, id, version }: DeleteReceiveCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_RECEIVE] });
    await desk.tx.run(async () => {
      const receive = await desk.receive(id, version);
      await desk.assertWorksAt(actor.userId, receive.header.outletId);
      receive.assertDeletable();
      await desk.receives.delete(id);
      await desk.record('receive', 'deleted', actor, id, { number: receive.number });
    });
  }
}

/**
 * Opening stock of an outlet (old: typed straight into Stocks): each line in its lot at the given unit cost.
 * Not posted to accounts — the opening balances are entered there.
 */
@CommandHandler(EnterOpeningStockCommand)
export class EnterOpeningStockHandler implements ICommandHandler<EnterOpeningStockCommand> {
  constructor(private readonly desk: PharmacyDesk) {}

  async execute({ actor, outletId, openedOn, note, lines }: EnterOpeningStockCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_MANAGE] });
    if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
      throw new DomainError('invalid_lines', `Opening stock has 1 to ${MAX_DOCUMENT_LINES} lines`);
    }
    lines.forEach((line, index) => {
      const at = `Line ${index + 1}`;
      validUnits(line.qty, at);
      validRate(line.unitCost, at);
      validAmount(line.saleRate, at);
      text(line.batchNo, 50, 'batch number', at);
      if (line.expiryDate <= openedOn) throw new DomainError('expired_lot', `${at}: the lot has expired by then`);
    });
    return desk.tx.run(async () => {
      if (!(await desk.facts.outletExists(outletId))) throw new NotFoundError('outlet');
      const products = await desk.facts.products(lines.map((line) => line.productId));
      lines.forEach((line, index) => {
        if (!products.get(line.productId)!.isActive) {
          throw new DomainError('inactive_product', `Line ${index + 1}: the product is inactive`);
        }
      });
      const id = randomUUID();
      const number = await desk.number('OP', openedOn);
      await desk.openings.insert({
        id,
        number,
        outletId,
        openedOn,
        note: text(note, 1000, 'note', 'Opening stock'),
        createdBy: actor.userId,
      });
      const movements: NewMovement[] = [];
      for (const line of lines) {
        movements.push({
          outletId,
          productId: line.productId,
          lotId: await desk.ledger.lot(
            line.productId,
            text(line.batchNo, 50, 'batch number', ''),
            line.expiryDate,
            line.saleRate,
          ),
          qty: line.qty,
          unitCost: line.unitCost,
          movedOn: openedOn,
          kind: 'opening',
          documentId: id,
          documentNumber: number,
        });
      }
      await desk.ledger.add(movements);
      await desk.record('opening_stock', 'entered', actor, id, { number, lines: lines.length });
      return { id, number };
    });
  }
}

@QueryHandler(ListOrdersQuery)
export class ListOrdersHandler implements IQueryHandler<ListOrdersQuery> {
  constructor(
    private readonly read: PharmacyReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListOrdersQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.listOrders(filter);
  }
}

@QueryHandler(GetOrderQuery)
export class GetOrderHandler implements IQueryHandler<GetOrderQuery> {
  constructor(
    private readonly read: PharmacyReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetOrderQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const order = await this.read.getOrder(id);
    if (!order) throw new NotFoundError('purchase_order');
    return order;
  }
}

@QueryHandler(ListReceivesQuery)
export class ListReceivesHandler implements IQueryHandler<ListReceivesQuery> {
  constructor(
    private readonly read: PharmacyReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListReceivesQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.listReceives(filter);
  }
}

@QueryHandler(GetReceiveQuery)
export class GetReceiveHandler implements IQueryHandler<GetReceiveQuery> {
  constructor(
    private readonly read: PharmacyReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetReceiveQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const receive = await this.read.getReceive(id);
    if (!receive) throw new NotFoundError('pharmacy_receive');
    return receive;
  }
}

@QueryHandler(GetStockQuery)
export class GetStockHandler implements IQueryHandler<GetStockQuery> {
  constructor(
    private readonly read: PharmacyReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: GetStockQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    if ((await this.read.outletName(filter.outletId)) === null) throw new NotFoundError('outlet');
    return this.read.stock(filter);
  }
}

@QueryHandler(GetStockCardQuery)
export class GetStockCardHandler implements IQueryHandler<GetStockCardQuery> {
  constructor(
    private readonly read: PharmacyReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, outletId, productId, from, to }: GetStockCardQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
    if ((await this.read.outletName(outletId)) === null) throw new NotFoundError('outlet');
    const card = await this.read.card(outletId, productId, from, to);
    if (!card) throw new NotFoundError('product');
    return card;
  }
}

export const PURCHASE_HANDLERS = [
  PharmacyDesk,
  CreateOrderHandler,
  EditOrderHandler,
  EndOrderHandler,
  CreateReceiveHandler,
  EditReceiveHandler,
  PostReceiveHandler,
  DeleteReceiveHandler,
  EnterOpeningStockHandler,
  ListOrdersHandler,
  GetOrderHandler,
  ListReceivesHandler,
  GetReceiveHandler,
  GetStockHandler,
  GetStockCardHandler,
];
