import { randomUUID } from 'node:crypto';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import type { LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import { NotFoundError } from '../../../shared/domain/errors.js';
import { text } from '../domain/documents.js';
import { ReturnPolicies, SaleReturnRepository } from '../domain/repositories.js';
import { assertWithinReturnWindow, validReturnDays } from '../domain/return-window.js';
import { PHARMACY_MANAGE, PHARMACY_READ, PHARMACY_SELL } from './pharmacy.constants.js';
import { PHARMACY_INVENTORY_ROLE, PURCHASE_JOURNAL } from './purchase.handlers.js';

/** Medicines given back damaged or expired, written off at cost. */
export const PHARMACY_DAMAGE_ROLE = 'pharmacy_damage_loss';
import {
  GetReturnPoliciesQuery,
  GetSaleReturnQuery,
  ListSaleReturnsQuery,
  ReturnReadRepository,
  ReturnSaleCommand,
  SetReturnPolicyCommand,
} from './return.messages.js';
import {
  PHARMACY_COGS_ROLE,
  PHARMACY_DISCOUNT_ROLE,
  PHARMACY_RECEIVABLE_ROLE,
  PHARMACY_SALES_ROLE,
  RECEIPT_ROLES,
  SaleDesk,
} from './sale.handlers.js';

@CommandHandler(SetReturnPolicyCommand)
export class SetReturnPolicyHandler implements ICommandHandler<SetReturnPolicyCommand> {
  constructor(
    private readonly sales: SaleDesk,
    private readonly policies: ReturnPolicies,
  ) {}

  async execute({ actor, channel, policy }: SetReturnPolicyCommand): Promise<void> {
    const { desk } = this.sales;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_MANAGE] });
    validReturnDays(policy.days);
    await desk.tx.run(async () => {
      await this.policies.save(channel, policy, actor.userId);
      await desk.record('return_policy', 'set', actor, '00000000-0000-0000-0000-000000000002', {
        channel,
        isEnabled: policy.isEnabled,
        days: policy.days,
      });
    });
  }
}

@QueryHandler(GetReturnPoliciesQuery)
export class GetReturnPoliciesHandler implements IQueryHandler<GetReturnPoliciesQuery> {
  constructor(
    private readonly read: ReturnReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor }: GetReturnPoliciesQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.policies();
  }
}

/**
 * Old ProcessOpdProductReturn: medicines a customer brings back, within the return period (judged on the sale's
 * own date), never more than was sold less what came back before. They go back into the same lots at their cost,
 * except units marked damaged, written off; the refund takes the sale's open due down first and the rest is paid
 * back the way the sale was paid. One voucher: Dr pharmacy sales (gross) / Cr sales discount, cash (card, wallet)
 * and the receivable; Dr pharmacy inventory and damage loss / Cr cost of medicines sold. The sale's version guards
 * against submitting the same return twice.
 */
@CommandHandler(ReturnSaleCommand)
export class ReturnSaleHandler implements ICommandHandler<ReturnSaleCommand> {
  constructor(
    private readonly sales: SaleDesk,
    private readonly policies: ReturnPolicies,
    private readonly returns: SaleReturnRepository,
  ) {}

  async execute({ actor, saleId, version, returnedOn, reason, lines }: ReturnSaleCommand) {
    const { desk, keeper } = this.sales;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_SELL] });
    const why = text(reason, 500, 'reason', 'Return');
    return desk.tx.run(async () => {
      const sale = await this.sales.sale(saleId, version);
      await desk.assertWorksAt(actor.userId, sale.outletId);
      assertWithinReturnWindow(await this.policies.policy('opd'), sale.soldOn, returnedOn);
      const given = sale.giveBack(lines, desk.clock.now());
      const id = randomUUID();
      const number = await desk.number('SR', returnedOn);
      const narration = `Return ${number} of sale ${sale.number}`;
      const voucherLines: LedgerPostingLine[] = [
        ...(given.amount > 0
          ? [{ account: { role: PHARMACY_SALES_ROLE }, debit: given.amount, credit: 0, narration }]
          : []),
        ...(given.discount > 0
          ? [{ account: { role: PHARMACY_DISCOUNT_ROLE }, debit: 0, credit: given.discount, narration }]
          : []),
        ...(given.paidBack > 0
          ? [{ account: { role: RECEIPT_ROLES[sale.method] }, debit: 0, credit: given.paidBack, narration }]
          : []),
        ...(given.dueReduced > 0
          ? [{ account: { role: PHARMACY_RECEIVABLE_ROLE }, debit: 0, credit: given.dueReduced, narration }]
          : []),
        ...(given.cost - given.damagedCost > 0
          ? [
              {
                account: { role: PHARMACY_INVENTORY_ROLE },
                debit: Math.round((given.cost - given.damagedCost) * 100) / 100,
                credit: 0,
                narration,
              },
            ]
          : []),
        ...(given.damagedCost > 0
          ? [{ account: { role: PHARMACY_DAMAGE_ROLE }, debit: given.damagedCost, credit: 0, narration }]
          : []),
        ...(given.cost > 0 ? [{ account: { role: PHARMACY_COGS_ROLE }, debit: 0, credit: given.cost, narration }] : []),
      ];
      const voucher =
        voucherLines.length > 0
          ? await desk.posting.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: returnedOn,
              narration,
              source: { module: 'pharmacy', reference: id },
              lines: voucherLines,
              postedBy: actor.userId,
            })
          : null;
      const restocked = given.parts.filter((part) => !part.damaged);
      if (restocked.length > 0) {
        await keeper.putIn(sale.outletId, restocked, { id, number, on: returnedOn }, 'sale_return');
      }
      await this.sales.sales.update(sale);
      await this.returns.insert({
        id,
        number,
        saleId,
        outletId: sale.outletId,
        returnedOn,
        reason: why,
        amount: given.amount,
        discount: given.discount,
        refund: given.refund,
        dueReduced: given.dueReduced,
        paidBack: given.paidBack,
        cost: given.cost,
        damagedCost: given.damagedCost,
        voucherNumber: voucher?.number ?? null,
        createdBy: actor.userId,
        parts: given.parts,
      });
      await desk.record('sale_return', 'made', actor, id, { number, sale: sale.number, refund: given.refund });
      return {
        id,
        number,
        refund: given.refund,
        dueReduced: given.dueReduced,
        paidBack: given.paidBack,
        voucherNumber: voucher?.number ?? null,
      };
    });
  }
}

@QueryHandler(ListSaleReturnsQuery)
export class ListSaleReturnsHandler implements IQueryHandler<ListSaleReturnsQuery> {
  constructor(
    private readonly read: ReturnReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListSaleReturnsQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.listReturns(filter);
  }
}

@QueryHandler(GetSaleReturnQuery)
export class GetSaleReturnHandler implements IQueryHandler<GetSaleReturnQuery> {
  constructor(
    private readonly read: ReturnReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetSaleReturnQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const found = await this.read.getReturn(id);
    if (!found) throw new NotFoundError('sale_return');
    return found;
  }
}

export const RETURN_HANDLERS = [
  SetReturnPolicyHandler,
  GetReturnPoliciesHandler,
  ReturnSaleHandler,
  ListSaleReturnsHandler,
  GetSaleReturnHandler,
];
