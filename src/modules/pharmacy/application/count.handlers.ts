import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import type { LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { text, validAmount, validRate } from '../domain/documents.js';
import { StockCountRepository, type NewMovement } from '../domain/repositories.js';
import { StockCount } from '../domain/stock-count.js';
import {
  AddCountLotCommand,
  ApplyCountCommand,
  CancelCountCommand,
  CountReadRepository,
  GetCountQuery,
  ListCountsQuery,
  OpenCountCommand,
  RecordCountsCommand,
} from './count.messages.js';
import { PHARMACY_COUNT, PHARMACY_MANAGE, PHARMACY_READ } from './pharmacy.constants.js';
import { PHARMACY_INVENTORY_ROLE, PharmacyDesk, PURCHASE_JOURNAL } from './purchase.handlers.js';
import { PHARMACY_DAMAGE_ROLE } from './return.handlers.js';

/** GL roles of stock count deviations. */
export const PHARMACY_COUNT_LOSS_ROLE = 'pharmacy_count_loss';
export const PHARMACY_COUNT_GAIN_ROLE = 'pharmacy_count_gain';

const cost4 = (value: number) => Math.round(value * 10_000) / 10_000;

@Injectable()
export class CountDesk {
  constructor(
    readonly desk: PharmacyDesk,
    readonly counts: StockCountRepository,
  ) {}

  async count(id: string, version: number): Promise<StockCount> {
    const count = await this.counts.findForUpdate(id);
    if (!count) throw new NotFoundError('stock_count');
    count.assertVersion(version);
    return count;
  }
}

/** Old AuditInitializeCommand: every lot the outlet holds as of the count date, at its cost there. */
@CommandHandler(OpenCountCommand)
export class OpenCountHandler implements ICommandHandler<OpenCountCommand> {
  constructor(private readonly counting: CountDesk) {}

  async execute({ actor, outletId, countDate, note, productIds }: OpenCountCommand) {
    const { desk, counts } = this.counting;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_COUNT] });
    return desk.tx.run(async () => {
      await desk.assertWorksAt(actor.userId, outletId);
      if (productIds) await desk.facts.products(productIds);
      const lots = await counts.lotsAsOf(outletId, countDate, productIds ?? undefined);
      const count = StockCount.open({
        id: randomUUID(),
        number: await desk.number('SC', countDate),
        outletId,
        countDate,
        note,
        lots: lots.map((lot) => ({ ...lot, unitCost: lot.qty > 0 ? cost4(lot.value / lot.qty) : 0 })),
        createdBy: actor.userId,
        now: desk.clock.now(),
      });
      await counts.insert(count);
      await desk.record('stock_count', 'opened', actor, count.id, { number: count.number, lines: lots.length });
      return { id: count.id, number: count.number, lines: count.lines.length };
    });
  }
}

@CommandHandler(RecordCountsCommand)
export class RecordCountsHandler implements ICommandHandler<RecordCountsCommand> {
  constructor(private readonly counting: CountDesk) {}

  async execute({ actor, id, version, counts }: RecordCountsCommand): Promise<void> {
    const { desk } = this.counting;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_COUNT] });
    await desk.tx.run(async () => {
      const count = await this.counting.count(id, version);
      await desk.assertWorksAt(actor.userId, count.outletId);
      count.record(counts, desk.clock.now());
      await this.counting.counts.update(count);
      await desk.record('stock_count', 'counted', actor, id, { lots: counts.length });
    });
  }
}

/** A lot on the shelf the count does not list: its own lot (made when new), at its cost here or the cost given. */
@CommandHandler(AddCountLotCommand)
export class AddCountLotHandler implements ICommandHandler<AddCountLotCommand> {
  constructor(private readonly counting: CountDesk) {}

  async execute({ actor, id, version, lot }: AddCountLotCommand): Promise<void> {
    const { desk, counts } = this.counting;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_COUNT] });
    validAmount(lot.saleRate, 'Lot');
    if (lot.unitCost !== null) validRate(lot.unitCost, 'Lot');
    await desk.tx.run(async () => {
      const count = await this.counting.count(id, version);
      await desk.assertWorksAt(actor.userId, count.outletId);
      await desk.facts.products([lot.productId]);
      const lotId = await desk.ledger.lot(
        lot.productId,
        text(lot.batchNo, 50, 'batch number', 'Lot'),
        lot.expiryDate,
        lot.saleRate,
      );
      const held = (await counts.balancesAsOf(count.outletId, [lotId], count.countDate)).get(lotId) ?? 0;
      const known = (await desk.ledger.lotCosts(count.outletId, [lotId])).get(lotId);
      const unitCost = lot.unitCost ?? known;
      if (unitCost === undefined) {
        throw new DomainError('cost_needed', 'The outlet never held this lot; give what a unit cost');
      }
      count.addLot(
        { productId: lot.productId, lotId, systemQty: held, unitCost, countedQty: lot.countedQty },
        desk.clock.now(),
      );
      await counts.update(count);
      await desk.record('stock_count', 'lot_added', actor, id, { lotId });
    });
  }
}

/**
 * Old ApplyStockAudit / UpdateStockOnAudit, made atomic: the products counted are locked; each lot moves by the count
 * less the ledger as of the count date (movements dated the count date, into that lot, at its cost); shortage
 * Dr pharmacy count loss / Cr pharmacy inventory, units written off (expired or damaged) Dr pharmacy damage loss /
 * Cr pharmacy inventory, excess Dr pharmacy inventory / Cr pharmacy count gain.
 */
@CommandHandler(ApplyCountCommand)
export class ApplyCountHandler implements ICommandHandler<ApplyCountCommand> {
  constructor(private readonly counting: CountDesk) {}

  async execute({ actor, id, version }: ApplyCountCommand) {
    const { desk, counts } = this.counting;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_MANAGE] });
    return desk.tx.run(async () => {
      const count = await this.counting.count(id, version);
      for (const productId of [...new Set(count.lines.map((line) => line.productId))].sort()) {
        await desk.tx.lock(`pharmacy:stock:${count.outletId}:${productId}`);
      }
      const balances = await counts.balancesAsOf(
        count.outletId,
        count.lines.map((line) => line.lotId),
        count.countDate,
      );
      const { adjustments, shortage, writtenOff, excess } = count.apply({
        balances,
        by: actor.userId,
        now: desk.clock.now(),
      });
      const narration = `Stock count ${count.number}`;
      const lines: LedgerPostingLine[] = [
        ...(shortage > 0
          ? [
              { account: { role: PHARMACY_COUNT_LOSS_ROLE }, debit: shortage, credit: 0, narration },
              { account: { role: PHARMACY_INVENTORY_ROLE }, debit: 0, credit: shortage, narration },
            ]
          : []),
        ...(writtenOff > 0
          ? [
              { account: { role: PHARMACY_DAMAGE_ROLE }, debit: writtenOff, credit: 0, narration },
              { account: { role: PHARMACY_INVENTORY_ROLE }, debit: 0, credit: writtenOff, narration },
            ]
          : []),
        ...(excess > 0
          ? [
              { account: { role: PHARMACY_INVENTORY_ROLE }, debit: excess, credit: 0, narration },
              { account: { role: PHARMACY_COUNT_GAIN_ROLE }, debit: 0, credit: excess, narration },
            ]
          : []),
      ];
      const voucher =
        lines.length > 0
          ? await desk.posting.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: count.countDate,
              narration,
              source: { module: 'pharmacy', reference: count.id },
              lines,
              postedBy: actor.userId,
            })
          : null;
      const movements: NewMovement[] = adjustments.map((adjustment) => ({
        outletId: count.outletId,
        productId: adjustment.productId,
        lotId: adjustment.lotId,
        qty: adjustment.qty,
        unitCost: adjustment.unitCost,
        movedOn: count.countDate,
        kind: 'count_adjustment',
        documentId: count.id,
        documentNumber: count.number,
      }));
      await desk.ledger.add(movements);
      count.applied(voucher?.number ?? null);
      await counts.update(count);
      await desk.record('stock_count', 'applied', actor, id, {
        shortage,
        writtenOff,
        excess,
        voucher: voucher?.number ?? null,
      });
      return { shortage, writtenOff, excess, voucherNumber: voucher?.number ?? null };
    });
  }
}

@CommandHandler(CancelCountCommand)
export class CancelCountHandler implements ICommandHandler<CancelCountCommand> {
  constructor(private readonly counting: CountDesk) {}

  async execute({ actor, id, version, reason }: CancelCountCommand): Promise<void> {
    const { desk } = this.counting;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_COUNT] });
    await desk.tx.run(async () => {
      const count = await this.counting.count(id, version);
      await desk.assertWorksAt(actor.userId, count.outletId);
      count.cancel(reason, desk.clock.now());
      await this.counting.counts.update(count);
      await desk.record('stock_count', 'cancelled', actor, id, { reason });
    });
  }
}

@QueryHandler(ListCountsQuery)
export class ListCountsHandler implements IQueryHandler<ListCountsQuery> {
  constructor(
    private readonly read: CountReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListCountsQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.listCounts(filter);
  }
}

@QueryHandler(GetCountQuery)
export class GetCountHandler implements IQueryHandler<GetCountQuery> {
  constructor(
    private readonly read: CountReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetCountQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const count = await this.read.getCount(id);
    if (!count) throw new NotFoundError('stock_count');
    return count;
  }
}

export const COUNT_HANDLERS = [
  CountDesk,
  OpenCountHandler,
  RecordCountsHandler,
  AddCountLotHandler,
  ApplyCountHandler,
  CancelCountHandler,
  ListCountsHandler,
  GetCountHandler,
];
