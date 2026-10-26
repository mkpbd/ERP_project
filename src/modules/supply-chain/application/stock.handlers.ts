import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { LedgerPosting, type LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import type { Page } from '../../../shared/application/pagination.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { MAX_DOCUMENT_LINES, paisa, taka, validAmount, validQuantity } from '../domain/documents.js';
import type { PurchaseOrder } from '../domain/purchase-order.js';
import {
  AssetRegister,
  assetNumber,
  CatalogueFacts,
  OpeningRepository,
  ReceiveRepository,
  StockLedger,
  type CatalogueVariant,
  type NewAsset,
  type NewMovement,
  type PayableSupplier,
} from '../domain/repositories.js';
import { placeRecord } from '../domain/places.js';
import { StockReceive, type ReceiveHeader } from '../domain/stock-receive.js';
import { PurchaseDesk } from './purchase.handlers.js';
import {
  CloseOrderCommand,
  CreateReceiveCommand,
  DeleteReceiveCommand,
  EditReceiveCommand,
  EnterOpeningStockCommand,
  GetReceiveQuery,
  GetStockCardQuery,
  GetStockQuery,
  ListReceivesQuery,
  PostReceiveCommand,
  StockReadRepository,
  type ReceiveSummary,
  type ReceiveView,
  type StockCard,
  type StockRow,
} from './stock.messages.js';
import { SCM_MANAGE, SCM_PURCHASE, SCM_READ, SCM_RECEIVE } from './supply-chain.constants.js';

/** The journal purchases post to (the old receive posted a journal voucher). */
export const PURCHASE_JOURNAL = 'JV';
/** GL roles: inventory for items without an item type, and the payable for suppliers without their own account. */
export const STORE_INVENTORY_ROLE = 'store_inventory';
export const SUPPLIER_PAYABLE_ROLE = 'supplier_payable';

/** What the receive handlers share on top of the purchase desk. */
@Injectable()
export class ReceiveDesk {
  constructor(
    readonly desk: PurchaseDesk,
    readonly receives: ReceiveRepository,
    readonly catalogue: CatalogueFacts,
    readonly stock: StockLedger,
    readonly ledger: LedgerPosting,
    readonly assets: AssetRegister,
  ) {}

  async receive(id: string, version: number): Promise<StockReceive> {
    const receive = await this.receives.findForUpdate(id);
    if (!receive) throw new NotFoundError('stock_receive');
    receive.assertVersion(version);
    return receive;
  }

  async supplier(id: string): Promise<PayableSupplier> {
    const supplier = await this.catalogue.supplier(id);
    if (!supplier) throw new NotFoundError('supplier');
    if (!supplier.isActive) throw new DomainError('inactive_supplier', 'The supplier is inactive');
    return supplier;
  }

  /** The order a receive is against: open or partly received, from the same supplier into the same store. */
  async order(header: ReceiveHeader): Promise<PurchaseOrder | null> {
    if (!header.purchaseOrderId) return null;
    const order = await this.desk.orders.findForUpdate(header.purchaseOrderId);
    if (!order) throw new NotFoundError('purchase_order');
    if (order.status !== 'open' && order.status !== 'partially_received') {
      throw new DomainError('purchase_order_state', `The order is ${order.status.replace('_', ' ')}`);
    }
    if (order.supplierId !== header.supplierId) {
      throw new DomainError('wrong_supplier', 'The order is to another supplier');
    }
    if (order.mainStoreId !== header.mainStoreId) {
      throw new DomainError('wrong_main_store', 'The order is for another main store');
    }
    return order;
  }
}

/**
 * The purchase voucher: inventory (the item type's account, else the store_inventory role) debited with each
 * line's total, the supplier's payable account (else the supplier_payable role) credited on their sub-ledger.
 */
export function purchaseVoucherLines(
  receive: StockReceive,
  variants: ReadonlyMap<string, CatalogueVariant>,
  supplier: PayableSupplier,
): LedgerPostingLine[] {
  const debits = new Map<string, number>();
  for (const line of receive.lines) {
    const account = variants.get(line.variantId)?.inventoryGlAccountId ?? '';
    debits.set(account, (debits.get(account) ?? 0) + paisa(line.total));
  }
  const narration = `${receive.number} from ${supplier.name}`;
  return [
    ...[...debits.entries()]
      .filter(([, amount]) => amount > 0)
      .map(([account, amount]) => ({
        account: account ? { id: account } : { role: STORE_INVENTORY_ROLE },
        debit: taka(amount),
        credit: 0,
        narration,
      })),
    {
      account: supplier.glAccountId ? { id: supplier.glAccountId } : { role: SUPPLIER_PAYABLE_ROLE },
      debit: 0,
      credit: receive.total,
      narration,
      subLedgerId: supplier.subLedgerId,
    },
  ];
}

/** Fixed-asset items come in whole pieces (the old receive dropped the fraction when numbering them). */
function assertWholePieces(
  lines: readonly { variantId: string; qty: number }[],
  variants: ReadonlyMap<string, CatalogueVariant>,
): void {
  lines.forEach((line, index) => {
    if (variants.get(line.variantId)?.isAsset && !Number.isInteger(line.qty)) {
      throw new DomainError('whole_pieces', `Line ${index + 1}: a fixed asset comes in whole pieces`);
    }
  });
}

/**
 * Old GenerateFixedAssetNumbersCommand, now inside the posting: every piece of a fixed-asset item gets an asset
 * number (FA-000001, one series), its unit cost and the place it went into.
 */
async function registerPieces(
  desk: PurchaseDesk,
  assets: AssetRegister,
  movements: readonly NewMovement[],
  variants: ReadonlyMap<string, CatalogueVariant>,
  source: { id: string; number: string },
  supplierId: string | null,
  acquiredOn: string,
): Promise<void> {
  const pieces: NewAsset[] = [];
  for (const movement of movements) {
    if (!variants.get(movement.variantId)?.isAsset) continue;
    for (let piece = 0; piece < movement.qty; piece += 1) {
      pieces.push({
        id: randomUUID(),
        assetNo: assetNumber(await desk.sequences.next('FA', 0)),
        variantId: movement.variantId,
        lotId: movement.lotId,
        sourceDocumentId: source.id,
        sourceNumber: source.number,
        supplierId,
        cost: Math.round(movement.unitCost * 100) / 100,
        acquiredOn,
        place: movement.store,
      });
    }
  }
  if (pieces.length > 0) await assets.add(pieces);
}

@CommandHandler(CreateReceiveCommand)
export class CreateReceiveHandler implements ICommandHandler<CreateReceiveCommand> {
  constructor(private readonly receiving: ReceiveDesk) {}

  async execute({ actor, header, lines }: CreateReceiveCommand) {
    const { desk } = this.receiving;
    await desk.access.authorize(actor.userId, { permissions: [SCM_RECEIVE] });
    return desk.tx.run(async () => {
      await this.receiving.supplier(header.supplierId);
      await this.receiving.order(header);
      const receive = StockReceive.draft({
        id: randomUUID(),
        number: await desk.number('SR', header.receivedOn),
        header,
        lines,
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await this.receiving.receives.insert(receive);
      await desk.record('stock_receive', 'drafted', actor, receive.id, {
        number: receive.number,
        total: receive.total,
      });
      return { id: receive.id, number: receive.number };
    });
  }
}

@CommandHandler(EditReceiveCommand)
export class EditReceiveHandler implements ICommandHandler<EditReceiveCommand> {
  constructor(private readonly receiving: ReceiveDesk) {}

  async execute({ actor, id, version, header, lines }: EditReceiveCommand): Promise<void> {
    const { desk } = this.receiving;
    await desk.access.authorize(actor.userId, { permissions: [SCM_RECEIVE] });
    await desk.tx.run(async () => {
      const receive = await this.receiving.receive(id, version);
      receive.edit({ header, ...(lines ? { lines } : {}) }, desk.clock.now());
      await this.receiving.supplier(receive.header.supplierId);
      await this.receiving.order(receive.header);
      await this.receiving.receives.update(receive);
      await desk.record('stock_receive', 'edited', actor, id, { total: receive.total });
    });
  }
}

/**
 * Posting: the order takes the quantities (not beyond what is still to come), each line goes into stock in
 * its lot at its own unit cost, the items' purchase price becomes the received rate, and the purchase is
 * posted to accounts on the supplier's sub-ledger (old: a voucher only when integrated accounts were on, and
 * only the first one per supplier ever succeeded).
 */
@CommandHandler(PostReceiveCommand)
export class PostReceiveHandler implements ICommandHandler<PostReceiveCommand> {
  constructor(private readonly receiving: ReceiveDesk) {}

  async execute({ actor, id, version }: PostReceiveCommand): Promise<{ voucherNumber: string | null }> {
    const { desk, catalogue, stock, ledger, receives } = this.receiving;
    await desk.access.authorize(actor.userId, { permissions: [SCM_RECEIVE] });
    return desk.tx.run(async () => {
      const now = desk.clock.now();
      const receive = await this.receiving.receive(id, version);
      const { header } = receive;
      const supplier = await this.receiving.supplier(header.supplierId);
      const variants = await catalogue.variants(receive.lines.map((line) => line.variantId));
      receive.checkPostable(variants);
      assertWholePieces(receive.lines, variants);
      const order = await this.receiving.order(header);
      if (order) {
        order.receive(receive.quantities(), now);
        await desk.orders.update(order);
      }
      const voucher =
        receive.total > 0
          ? await ledger.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: header.receivedOn,
              narration: [
                `Stock receive ${receive.number} from ${supplier.name}`,
                header.supplierInvoiceNo ? `invoice ${header.supplierInvoiceNo}` : null,
                order ? `order ${order.number}` : null,
              ]
                .filter(Boolean)
                .join(', '),
              source: { module: 'scm', reference: receive.id },
              lines: purchaseVoucherLines(receive, variants, supplier),
              postedBy: actor.userId,
            })
          : null;
      receive.post({
        variants,
        voucher: voucher && { id: voucher.voucherId, number: voucher.number },
        by: actor.userId,
        now,
      });
      const lotIds: string[] = [];
      const movements: NewMovement[] = [];
      for (const line of receive.lines) {
        const lotId = await stock.lot(line.variantId, line.batchNo, line.expiryDate);
        lotIds.push(lotId);
        movements.push({
          store: { mainStoreId: header.mainStoreId },
          variantId: line.variantId,
          lotId,
          qty: line.qty,
          unitCost: Math.round((line.total / line.qty) * 10_000) / 10_000,
          movedOn: header.receivedOn,
          kind: 'receive',
          documentId: receive.id,
          documentNumber: receive.number,
        });
      }
      await stock.add(movements);
      await registerPieces(
        desk,
        this.receiving.assets,
        movements,
        variants,
        receive,
        header.supplierId,
        header.receivedOn,
      );
      await receives.update(receive);
      await receives.setLots(receive.id, lotIds);
      await catalogue.updatePurchasePrices(
        new Map(receive.lines.filter((line) => line.rate > 0).map((line) => [line.variantId, line.rate])),
      );
      await desk.record('stock_receive', 'posted', actor, id, {
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
  constructor(private readonly receiving: ReceiveDesk) {}

  async execute({ actor, id, version }: DeleteReceiveCommand): Promise<void> {
    const { desk } = this.receiving;
    await desk.access.authorize(actor.userId, { permissions: [SCM_RECEIVE] });
    await desk.tx.run(async () => {
      const receive = await this.receiving.receive(id, version);
      receive.assertDeletable();
      await this.receiving.receives.delete(id);
      await desk.record('stock_receive', 'deleted', actor, id, { number: receive.number });
    });
  }
}

@CommandHandler(CloseOrderCommand)
export class CloseOrderHandler implements ICommandHandler<CloseOrderCommand> {
  constructor(private readonly desk: PurchaseDesk) {}

  async execute({ actor, id, version, reason }: CloseOrderCommand): Promise<void> {
    await this.desk.access.authorize(actor.userId, { permissions: [SCM_PURCHASE] });
    await this.desk.tx.run(async () => {
      const order = await this.desk.order(id, version);
      order.close(reason, this.desk.clock.now());
      await this.desk.orders.update(order);
      await this.desk.record('purchase_order', 'closed', actor, id, { reason });
    });
  }
}

/** Old OpeningQty on the item: opening stock by store, lot and cost. Accounts take their own opening balances. */
@CommandHandler(EnterOpeningStockCommand)
export class EnterOpeningStockHandler implements ICommandHandler<EnterOpeningStockCommand> {
  constructor(
    private readonly receiving: ReceiveDesk,
    private readonly openings: OpeningRepository,
  ) {}

  async execute({ actor, store, openedOn, note, lines }: EnterOpeningStockCommand) {
    const { desk, catalogue, stock } = this.receiving;
    await desk.access.authorize(actor.userId, { permissions: [SCM_MANAGE] });
    if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
      throw new DomainError('invalid_lines', `Opening stock has 1 to ${MAX_DOCUMENT_LINES} lines`);
    }
    return desk.tx.run(async () => {
      const variants = await catalogue.variants(lines.map((line) => line.variantId));
      lines.forEach((line, index) => {
        const at = `Line ${index + 1}`;
        validQuantity(line.qty, at);
        validAmount(line.unitCost, at);
        if (variants.get(line.variantId)?.expiryRequired && !line.expiryDate) {
          throw new DomainError('expiry_required', `${at}: the item needs an expiry date`);
        }
      });
      assertWholePieces(lines, variants);
      const id = randomUUID();
      const number = await desk.number('OS', openedOn);
      await this.openings.insert({ id, number, store, openedOn, note: note?.trim() || null, createdBy: actor.userId });
      const movements: NewMovement[] = [];
      for (const line of lines) {
        movements.push({
          store,
          variantId: line.variantId,
          lotId: await stock.lot(line.variantId, line.batchNo?.trim() || null, line.expiryDate),
          qty: line.qty,
          unitCost: line.unitCost,
          movedOn: openedOn,
          kind: 'opening',
          documentId: id,
          documentNumber: number,
        });
      }
      await stock.add(movements);
      await registerPieces(desk, this.receiving.assets, movements, variants, { id, number }, null, openedOn);
      await desk.record('stock_opening', 'entered', actor, id, { number, lines: lines.length });
      return { id, number };
    });
  }
}

@QueryHandler(ListReceivesQuery)
export class ListReceivesHandler implements IQueryHandler<ListReceivesQuery> {
  constructor(
    private readonly read: StockReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListReceivesQuery): Promise<Page<ReceiveSummary>> {
    await this.access.authorize(actor.userId, { permissions: [SCM_READ] });
    return this.read.listReceives(filter);
  }
}

@QueryHandler(GetReceiveQuery)
export class GetReceiveHandler implements IQueryHandler<GetReceiveQuery> {
  constructor(
    private readonly read: StockReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetReceiveQuery): Promise<ReceiveView> {
    await this.access.authorize(actor.userId, { permissions: [SCM_READ] });
    const receive = await this.read.getReceive(id);
    if (!receive) throw new NotFoundError('stock_receive');
    return receive;
  }
}

@QueryHandler(GetStockQuery)
export class GetStockHandler implements IQueryHandler<GetStockQuery> {
  constructor(
    private readonly read: StockReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: GetStockQuery): Promise<StockRow[]> {
    await this.access.authorize(actor.userId, { permissions: [SCM_READ] });
    if ((await this.read.storeName(filter.store)) === null) {
      throw new NotFoundError(placeRecord(filter.store));
    }
    return this.read.stock(filter);
  }
}

@QueryHandler(GetStockCardQuery)
export class GetStockCardHandler implements IQueryHandler<GetStockCardQuery> {
  constructor(
    private readonly read: StockReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, store, variantId, from, to }: GetStockCardQuery): Promise<StockCard> {
    await this.access.authorize(actor.userId, { permissions: [SCM_READ] });
    if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
    const card = await this.read.card(store, variantId, from, to);
    if (!card) throw new NotFoundError('item_variant');
    return card;
  }
}

export const STOCK_HANDLERS = [
  ReceiveDesk,
  CreateReceiveHandler,
  EditReceiveHandler,
  PostReceiveHandler,
  DeleteReceiveHandler,
  CloseOrderHandler,
  EnterOpeningStockHandler,
  ListReceivesHandler,
  GetReceiveHandler,
  GetStockHandler,
  GetStockCardHandler,
];
