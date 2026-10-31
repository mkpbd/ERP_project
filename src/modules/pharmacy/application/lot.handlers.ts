import { randomUUID } from 'node:crypto';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { correctLot, type LotIdentity } from '../domain/lot-correction.js';
import { LotCorrectionRepository, type NewMovement } from '../domain/repositories.js';
import { PHARMACY_MANAGE } from './pharmacy.constants.js';
import { PharmacyDesk } from './purchase.handlers.js';

export class CorrectLotCommand extends Command<{ id: string; number: string; toLotId: string; units: number }> {
  constructor(
    readonly actor: Actor,
    readonly lotId: string,
    readonly wanted: LotIdentity,
    readonly reason: string,
    readonly correctedOn: string,
  ) {
    super();
  }
}

/**
 * Old UpdateProductInStock: a lot whose batch, expiry or sale rate was entered wrong. The old page edited the lot (and
 * the product's price) in place; here the units still in stock at each outlet move to the lot as it should have been,
 * at their cost there, so what was sold from the old lot stays as it was sold. Expired lots are moved too: a wrong
 * expiry may be the very thing corrected.
 */
@CommandHandler(CorrectLotCommand)
export class CorrectLotHandler implements ICommandHandler<CorrectLotCommand> {
  constructor(
    private readonly desk: PharmacyDesk,
    private readonly lots: LotCorrectionRepository,
  ) {}

  async execute({ actor, lotId, wanted, reason, correctedOn }: CorrectLotCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_MANAGE] });
    return desk.tx.run(async () => {
      const lot = await this.lots.lot(lotId);
      if (!lot) throw new NotFoundError('lot');
      const corrected = correctLot(lot, wanted, reason);
      const toLotId = await desk.ledger.lot(lot.productId, corrected.batchNo, corrected.expiryDate, corrected.saleRate);
      const outlets = (await this.lots.holdings(lotId)).map((holding) => holding.outletId).sort();
      for (const outletId of outlets) await desk.tx.lock(`pharmacy:stock:${outletId}:${lot.productId}`);
      const id = randomUUID();
      const number = await desk.number('LC', correctedOn);
      const movements: NewMovement[] = [];
      for (const outletId of outlets) {
        // Read again under the outlet's lock: a sale may have taken units meanwhile.
        const [balances, costs] = await Promise.all([
          desk.ledger.balances(outletId, [lotId]),
          desk.ledger.lotCosts(outletId, [lotId]),
        ]);
        const qty = balances.get(lotId) ?? 0;
        if (qty <= 0) continue;
        const unitCost = costs.get(lotId) ?? 0;
        const move = {
          outletId,
          productId: lot.productId,
          unitCost,
          movedOn: correctedOn,
          kind: 'lot_correction' as const,
        };
        movements.push(
          { ...move, lotId, qty: -qty, documentId: id, documentNumber: number },
          { ...move, lotId: toLotId, qty, documentId: id, documentNumber: number },
        );
      }
      const units = movements.filter((movement) => movement.qty > 0).reduce((sum, movement) => sum + movement.qty, 0);
      if (units === 0) throw new DomainError('lot_not_in_stock', 'No outlet holds units of this lot');
      await desk.ledger.add(movements);
      await this.lots.insert({
        id,
        number,
        productId: lot.productId,
        fromLotId: lotId,
        toLotId,
        correctedOn,
        units,
        reason: corrected.reason,
        correctedBy: actor.userId,
      });
      await desk.record('lot', 'corrected', actor, id, {
        number,
        fromLot: lotId,
        toLot: toLotId,
        units,
        expiry: `${lot.expiryDate} -> ${corrected.expiryDate}`,
        saleRate: `${lot.saleRate} -> ${corrected.saleRate}`,
        reason: corrected.reason,
      });
      return { id, number, toLotId, units };
    });
  }
}

export const LOT_HANDLERS = [CorrectLotHandler];
