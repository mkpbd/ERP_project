import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import type { LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { allocate } from '../domain/allocation.js';
import { DEFAULT_POLICY, discountPercent, lineDiscount, validDiscountPercent } from '../domain/discount.js';
import { MAX_DOCUMENT_LINES, paisa, taka, text, validUnits } from '../domain/documents.js';
import { DiscountRules, SaleRepository } from '../domain/repositories.js';
import { allocateCollection, PharmacySale, type PaymentMethod, type SalePart } from '../domain/sale.js';
import { PHARMACY_MANAGE, PHARMACY_READ, PHARMACY_SELL } from './pharmacy.constants.js';
import { PHARMACY_INVENTORY_ROLE, PharmacyDesk, PURCHASE_JOURNAL } from './purchase.handlers.js';
import {
  CancelSaleCommand,
  CollectDueCommand,
  GetDiscountPolicyQuery,
  GetMemberDuesQuery,
  GetSaleQuery,
  ListSalesQuery,
  MakeSaleCommand,
  QuoteSaleQuery,
  SaleReadRepository,
  SetDiscountPolicyCommand,
  type SaleLineInput,
} from './sale.messages.js';
import { PharmacyKeeper } from './stock-keeper.js';

/** GL roles of counter sales. */
export const PHARMACY_SALES_ROLE = 'pharmacy_sales';
export const PHARMACY_COGS_ROLE = 'pharmacy_cogs';
export const PHARMACY_RECEIVABLE_ROLE = 'pharmacy_receivable';
/** Where each way of paying is received. */
export const RECEIPT_ROLES: Record<PaymentMethod, string> = {
  cash: 'cash_in_hand',
  card: 'card_receipts',
  mobile: 'mobile_wallet_receipts',
};

const validLines = (lines: readonly SaleLineInput[]) => {
  if (lines.length === 0 || lines.length > MAX_DOCUMENT_LINES) {
    throw new DomainError('invalid_lines', `A sale has 1 to ${MAX_DOCUMENT_LINES} lines`);
  }
  lines.forEach((line, index) => validUnits(line.qty, `Line ${index + 1}`));
};

/** What the sale handlers share on top of the pharmacy desk. */
@Injectable()
export class SaleDesk {
  constructor(
    readonly desk: PharmacyDesk,
    readonly keeper: PharmacyKeeper,
    readonly rules: DiscountRules,
    readonly sales: SaleRepository,
  ) {}

  /** Product → discount percent over the counter. */
  async percents(productIds: readonly string[]): Promise<Map<string, number>> {
    const policy = (await this.rules.policy()) ?? DEFAULT_POLICY;
    const own = await this.rules.productRules(productIds);
    return new Map(productIds.map((id) => [id, discountPercent(policy, own.get(id) ?? null, 'opd')]));
  }

  async activeProducts(lines: readonly SaleLineInput[]): Promise<void> {
    const products = await this.desk.facts.products(lines.map((line) => line.productId));
    lines.forEach((line, index) => {
      if (!products.get(line.productId)!.isActive) {
        throw new DomainError('inactive_product', `Line ${index + 1}: the product is inactive`);
      }
    });
  }

  async sale(id: string, version: number): Promise<PharmacySale> {
    const sale = await this.sales.findForUpdate(id);
    if (!sale) throw new NotFoundError('sale');
    sale.assertVersion(version);
    return sale;
  }
}

@CommandHandler(SetDiscountPolicyCommand)
export class SetDiscountPolicyHandler implements ICommandHandler<SetDiscountPolicyCommand> {
  constructor(private readonly sales: SaleDesk) {}

  async execute({ actor, policy }: SetDiscountPolicyCommand): Promise<void> {
    const { desk, rules } = this.sales;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_MANAGE] });
    validDiscountPercent(policy.opdPercent, 'Over the counter');
    validDiscountPercent(policy.ipdPercent, 'Indoor');
    await desk.tx.run(async () => {
      await rules.savePolicy(policy, actor.userId);
      await desk.record('discount_policy', 'set', actor, '00000000-0000-0000-0000-000000000001', {
        allowedByDefault: policy.allowedByDefault,
        opdPercent: policy.opdPercent,
        ipdPercent: policy.ipdPercent,
      });
    });
  }
}

@QueryHandler(GetDiscountPolicyQuery)
export class GetDiscountPolicyHandler implements IQueryHandler<GetDiscountPolicyQuery> {
  constructor(
    private readonly rules: DiscountRules,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor }: GetDiscountPolicyQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return (await this.rules.policy()) ?? DEFAULT_POLICY;
  }
}

/** The figures of a sale before it is made (the old sale page worked them out itself). */
@QueryHandler(QuoteSaleQuery)
export class QuoteSaleHandler implements IQueryHandler<QuoteSaleQuery> {
  constructor(
    private readonly sales: SaleDesk,
    private readonly read: SaleReadRepository,
  ) {}

  async execute({ actor, outletId, on, lines }: QuoteSaleQuery) {
    const { desk } = this.sales;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    validLines(lines);
    if (!(await desk.facts.outletExists(outletId))) throw new NotFoundError('outlet');
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const [balances, percents, refs] = await Promise.all([
      desk.ledger.stockLots(outletId, productIds),
      this.sales.percents(productIds),
      this.read.productRefs(productIds),
    ]);
    const parts = lines.flatMap((line, index) => {
      const lots = (balances.get(line.productId) ?? []).map((lot) => ({ ...lot }));
      return allocate({ lots, qty: line.qty, on, lotId: line.lotId, at: `Line ${index + 1}` }).map((part) => ({
        ...part,
        productId: line.productId,
      }));
    });
    const labels = await this.read.lotLabels(parts.map((part) => part.lotId));
    const quoted = parts.map((part) => {
      const amount = taka(paisa(part.saleRate * part.qty));
      const percent = percents.get(part.productId) ?? 0;
      const discount = lineDiscount(amount, percent);
      return {
        ...refs.get(part.productId)!,
        lotId: part.lotId,
        ...labels.get(part.lotId)!,
        qty: part.qty,
        saleRate: part.saleRate,
        amount,
        discountPercent: percent,
        discount,
        total: taka(paisa(amount) - paisa(discount)),
      };
    });
    const sum = (pick: (line: (typeof quoted)[number]) => number) =>
      taka(quoted.reduce((total, line) => total + paisa(pick(line)), 0));
    return {
      lines: quoted,
      amount: sum((line) => line.amount),
      discount: sum((line) => line.discount),
      total: sum((line) => line.total),
    };
  }
}

/**
 * Old CreatePharmacySale / CreatePhInvoice: the outlet's stock leaves first expiring first (never an expired lot,
 * old PharmacySaleExpiryGuard) under a lock on its products; each part sells at its lot's sale rate less the
 * product's discount over the counter; and one voucher books it: Dr cash (card, wallet) for what is paid and the
 * receivable for a member's due / Cr pharmacy sales; Dr cost of medicines sold / Cr pharmacy inventory at cost.
 */
@CommandHandler(MakeSaleCommand)
export class MakeSaleHandler implements ICommandHandler<MakeSaleCommand> {
  constructor(private readonly sales: SaleDesk) {}

  async execute(command: MakeSaleCommand) {
    const { desk, keeper } = this.sales;
    const { actor, outletId, soldOn, loyalMemberId, lines } = command;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_SELL] });
    validLines(lines);
    return desk.tx.run(async () => {
      await desk.assertWorksAt(actor.userId, outletId);
      await this.sales.activeProducts(lines);
      if (loyalMemberId) {
        const active = await this.sales.sales.memberIsActive(loyalMemberId);
        if (active === null) throw new NotFoundError('loyal_member');
        if (!active) throw new DomainError('inactive_member', 'The loyal member is inactive');
      }
      const id = randomUUID();
      const number = await desk.number('SI', soldOn);
      const percents = await this.sales.percents(lines.map((line) => line.productId));
      const taken = await keeper.takeOut(outletId, lines, { id, number, on: soldOn }, 'sale');
      const parts: SalePart[] = taken.map((part) => ({
        productId: part.productId,
        lotId: part.lotId,
        qty: part.qty,
        saleRate: part.saleRate,
        unitCost: part.unitCost,
        discountPercent: percents.get(part.productId) ?? 0,
      }));
      const sale = PharmacySale.make({
        id,
        number,
        outletId,
        soldOn,
        customerName: command.customerName,
        mobileNo: command.mobileNo,
        loyalMemberId,
        parts,
        method: command.method,
        reference: command.reference,
        tendered: command.tendered,
        soldBy: actor.userId,
        now: desk.clock.now(),
      });
      const narration = `Medicine sale ${number}`;
      const voucherLines: LedgerPostingLine[] = [
        ...(sale.paid > 0
          ? [{ account: { role: RECEIPT_ROLES[sale.method] }, debit: sale.paid, credit: 0, narration }]
          : []),
        ...(sale.due > 0
          ? [{ account: { role: PHARMACY_RECEIVABLE_ROLE }, debit: sale.due, credit: 0, narration }]
          : []),
        ...(sale.total > 0
          ? [{ account: { role: PHARMACY_SALES_ROLE }, debit: 0, credit: sale.total, narration }]
          : []),
        ...(sale.cost > 0
          ? [
              { account: { role: PHARMACY_COGS_ROLE }, debit: sale.cost, credit: 0, narration },
              { account: { role: PHARMACY_INVENTORY_ROLE }, debit: 0, credit: sale.cost, narration },
            ]
          : []),
      ];
      const voucher =
        voucherLines.length > 0
          ? await desk.posting.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: soldOn,
              narration,
              source: { module: 'pharmacy', reference: id },
              lines: voucherLines,
              postedBy: actor.userId,
            })
          : null;
      sale.posted(voucher?.number ?? null);
      await this.sales.sales.insert(sale);
      await desk.record('sale', 'made', actor, id, { number, total: sale.total, due: sale.due });
      return {
        id,
        number,
        total: sale.total,
        change: sale.change,
        due: sale.due,
        voucherNumber: voucher?.number ?? null,
      };
    });
  }
}

/** A whole sale undone (pharmacy:manage): its lots come back at their cost and a reversing voucher is posted. */
@CommandHandler(CancelSaleCommand)
export class CancelSaleHandler implements ICommandHandler<CancelSaleCommand> {
  constructor(private readonly sales: SaleDesk) {}

  async execute({ actor, id, version, on, reason }: CancelSaleCommand): Promise<void> {
    const { desk, keeper } = this.sales;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_MANAGE] });
    await desk.tx.run(async () => {
      const sale = await this.sales.sale(id, version);
      const narration = `Cancelled sale ${sale.number}`;
      const lines: LedgerPostingLine[] = [
        ...(sale.paid > 0
          ? [{ account: { role: RECEIPT_ROLES[sale.method] }, debit: 0, credit: sale.paid, narration }]
          : []),
        ...(sale.due > 0
          ? [{ account: { role: PHARMACY_RECEIVABLE_ROLE }, debit: 0, credit: sale.due, narration }]
          : []),
        ...(sale.total > 0
          ? [{ account: { role: PHARMACY_SALES_ROLE }, debit: sale.total, credit: 0, narration }]
          : []),
        ...(sale.cost > 0
          ? [
              { account: { role: PHARMACY_COGS_ROLE }, debit: 0, credit: sale.cost, narration },
              { account: { role: PHARMACY_INVENTORY_ROLE }, debit: sale.cost, credit: 0, narration },
            ]
          : []),
      ];
      // Checked before posting: a refused cancellation posts nothing.
      sale.cancel({ reason, on, by: actor.userId, now: desk.clock.now() });
      const voucher =
        lines.length > 0
          ? await desk.posting.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: on,
              narration,
              source: { module: 'pharmacy', reference: sale.id },
              lines,
              postedBy: actor.userId,
            })
          : null;
      sale.cancelPosted(voucher?.number ?? null);
      await keeper.putIn(sale.outletId, sale.lines, { id: sale.id, number: sale.number, on }, 'sale_cancel');
      await this.sales.sales.update(sale);
      await desk.record('sale', 'cancelled', actor, id, { reason, voucher: voucher?.number ?? null });
    });
  }
}

/**
 * Old loyal member due collection: what the member pays goes to their dues oldest sale first, never above them;
 * Dr cash (card, wallet) / Cr the pharmacy receivable.
 */
@CommandHandler(CollectDueCommand)
export class CollectDueHandler implements ICommandHandler<CollectDueCommand> {
  constructor(private readonly sales: SaleDesk) {}

  async execute({ actor, loyalMemberId, collectedOn, amount, method, reference }: CollectDueCommand) {
    const { desk } = this.sales;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_SELL] });
    const ref = text(reference, 100, 'reference', 'Collection');
    return desk.tx.run(async () => {
      await desk.tx.lock(`pharmacy:member-dues:${loyalMemberId}`);
      if ((await this.sales.sales.memberIsActive(loyalMemberId)) === null) throw new NotFoundError('loyal_member');
      const parts = allocateCollection(amount, await this.sales.sales.memberDues(loyalMemberId));
      const id = randomUUID();
      const number = await desk.number('DC', collectedOn);
      const narration = `Due collection ${number}`;
      const voucher = await desk.posting.post({
        journal: PURCHASE_JOURNAL,
        voucherDate: collectedOn,
        narration,
        source: { module: 'pharmacy', reference: id },
        lines: [
          { account: { role: RECEIPT_ROLES[method] }, debit: amount, credit: 0, narration },
          { account: { role: PHARMACY_RECEIVABLE_ROLE }, debit: 0, credit: amount, narration },
        ],
        postedBy: actor.userId,
      });
      await this.sales.sales.insertCollection({
        id,
        number,
        loyalMemberId,
        collectedOn,
        method,
        reference: ref,
        amount,
        voucherNumber: voucher.number,
        createdBy: actor.userId,
        lines: parts,
      });
      await desk.record('due_collection', 'made', actor, id, { number, amount });
      return { id, number, voucherNumber: voucher.number };
    });
  }
}

@QueryHandler(ListSalesQuery)
export class ListSalesHandler implements IQueryHandler<ListSalesQuery> {
  constructor(
    private readonly read: SaleReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListSalesQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    return this.read.listSales(filter);
  }
}

@QueryHandler(GetSaleQuery)
export class GetSaleHandler implements IQueryHandler<GetSaleQuery> {
  constructor(
    private readonly read: SaleReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetSaleQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const sale = await this.read.getSale(id);
    if (!sale) throw new NotFoundError('sale');
    return sale;
  }
}

@QueryHandler(GetMemberDuesQuery)
export class GetMemberDuesHandler implements IQueryHandler<GetMemberDuesQuery> {
  constructor(
    private readonly read: SaleReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, loyalMemberId }: GetMemberDuesQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const dues = await this.read.memberDues(loyalMemberId);
    if (!dues) throw new NotFoundError('loyal_member');
    return dues;
  }
}

export const SALE_HANDLERS = [
  SaleDesk,
  SetDiscountPolicyHandler,
  GetDiscountPolicyHandler,
  QuoteSaleHandler,
  MakeSaleHandler,
  CancelSaleHandler,
  CollectDueHandler,
  ListSalesHandler,
  GetSaleHandler,
  GetMemberDuesHandler,
];
