import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { CorporateAccounts, type CreditClient } from '../../../shared/application/contracts/corporate-accounts.js';
import type { LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import { StaffDirectory, type StaffSummary } from '../../../shared/application/contracts/staff-directory.js';
import { StaffLedger } from '../../../shared/application/contracts/staff-ledger.js';
import { DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { allocate } from '../domain/allocation.js';
import { DEFAULT_POLICY, discountPercent, lineDiscount, validDiscountPercent } from '../domain/discount.js';
import { MAX_DOCUMENT_LINES, paisa, taka, text, validUnits } from '../domain/documents.js';
import { DiscountRules, SaleRepository } from '../domain/repositories.js';
import type { CollectionRecord } from '../domain/repositories.js';
import {
  allocateCollection,
  PharmacySale,
  type PaymentMethod,
  type SaleDebtor,
  type SalePart,
} from '../domain/sale.js';
import { PHARMACY_MANAGE, PHARMACY_READ, PHARMACY_SELL } from './pharmacy.constants.js';
import { PHARMACY_INVENTORY_ROLE, PharmacyDesk, PURCHASE_JOURNAL } from './purchase.handlers.js';
import {
  CancelSaleCommand,
  CollectCorporateDueCommand,
  CollectDueCommand,
  CollectStaffDueCommand,
  GetCorporateDuesQuery,
  GetDiscountPolicyQuery,
  GetMemberDuesQuery,
  GetStaffDuesQuery,
  GetSaleQuery,
  ListSalesQuery,
  MakeSaleCommand,
  QuoteSaleQuery,
  SaleReadRepository,
  SetDiscountPolicyCommand,
  type SaleLineInput,
  type SaleSummary,
} from './sale.messages.js';
import { PharmacyKeeper } from './stock-keeper.js';

/** GL roles of counter sales. */
export const PHARMACY_SALES_ROLE = 'pharmacy_sales';
/** Discounts given, kept apart from gross sales. */
export const PHARMACY_DISCOUNT_ROLE = 'pharmacy_sales_discount';
export const PHARMACY_COGS_ROLE = 'pharmacy_cogs';
export const PHARMACY_RECEIVABLE_ROLE = 'pharmacy_receivable';
/** The hospital's: one receivable for what a company owes, whichever desk sold to it. */
export const CORPORATE_RECEIVABLE_ROLE = 'corporate_receivable';
/** The hospital's: what staff owe, recovered from their salary. */
export const STAFF_RECEIVABLE_ROLE = 'staff_receivable';

/** Where a sale's due stands in the books: by who owes it. */
export function receivableRole(debtor: SaleDebtor | null): string {
  if (debtor?.kind === 'corporate') return CORPORATE_RECEIVABLE_ROLE;
  if (debtor?.kind === 'staff') return STAFF_RECEIVABLE_ROLE;
  return PHARMACY_RECEIVABLE_ROLE;
}
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
    readonly corporate: CorporateAccounts,
    readonly staff: StaffDirectory,
    readonly ledger: StaffLedger,
  ) {}

  /** The company a sale is left with, locked so that its credits and its limit never cross. */
  async client(id: string): Promise<CreditClient> {
    const client = await this.corporate.lockForCredit(id);
    if (!client) throw new NotFoundError('corporate_client');
    if (!client.isActive) throw new DomainError('inactive_client', `${client.name} is not active`);
    return client;
  }

  /** A company takes a due only on credit, and within its limit across the hospital and the pharmacy. */
  async assertCredit(client: CreditClient, due: number): Promise<void> {
    if (client.payment !== 'credit') {
      throw new DomainError('cash_client', `${client.name} pays cash; it takes no credit`);
    }
    if (client.creditLimit === null) return;
    const owed = await this.corporate.owed(client.id);
    if (paisa(owed) + paisa(due) > paisa(client.creditLimit)) {
      throw new DomainError(
        'credit_limit',
        `${client.name} owes ${owed.toFixed(2)}; with ${due.toFixed(2)} more it is over its limit of ${client.creditLimit.toFixed(2)}`,
      );
    }
  }

  async person(id: string): Promise<StaffSummary> {
    const [person] = await this.staff.findSummaries([id]);
    if (!person) throw new NotFoundError('staff');
    return person;
  }

  /** A staff sale's due on their staff ledger: owed when sold; taken off when cancelled or given back. */
  async staffEntry(sale: PharmacySale, on: string, particulars: string, amount: number, owed: boolean) {
    const debtor = sale.debtor;
    if (debtor?.kind !== 'staff' || amount <= 0) return;
    await this.ledger.post({
      staffId: debtor.id,
      entryDate: on,
      particulars,
      debit: owed ? amount : 0,
      credit: owed ? 0 : amount,
      reference: sale.number,
    });
  }

  /** A payment against dues: one receipt number, one voucher (Dr the way paid / Cr the receivable), the record. */
  async collection(
    actor: Actor,
    payer: Pick<CollectionRecord, 'loyalMemberId' | 'corporateClientId' | 'staffId'>,
    receivable: string,
    narrate: (number: string) => string,
    params: { collectedOn: string; amount: number; method: PaymentMethod; reference: string | null },
    lines: CollectionRecord['lines'],
  ) {
    const { desk } = this;
    const id = randomUUID();
    const number = await desk.number('DC', params.collectedOn);
    const narration = narrate(number);
    const voucher = await desk.posting.post({
      journal: PURCHASE_JOURNAL,
      voucherDate: params.collectedOn,
      narration,
      source: { module: 'pharmacy', reference: id },
      lines: [
        { account: { role: RECEIPT_ROLES[params.method] }, debit: params.amount, credit: 0, narration },
        { account: { role: receivable }, debit: 0, credit: params.amount, narration },
      ],
      postedBy: actor.userId,
    });
    await this.sales.insertCollection({
      id,
      number,
      ...payer,
      collectedOn: params.collectedOn,
      method: params.method,
      reference: params.reference,
      amount: params.amount,
      voucherNumber: voucher.number,
      createdBy: actor.userId,
      lines,
    });
    await desk.record('due_collection', 'made', actor, id, { number, amount: params.amount });
    return { id, number, voucherNumber: voucher.number };
  }

  /** The company and staff names of sales, from the hospital and HR. */
  async named<T extends Pick<SaleSummary, 'corporateClientId' | 'staffId'>>(rows: readonly T[]) {
    const clients = await this.corporate.names(rows.flatMap((row) => row.corporateClientId ?? []));
    const staffIds = [...new Set(rows.flatMap((row) => row.staffId ?? []))];
    const people = new Map(
      (staffIds.length > 0 ? await this.staff.findSummaries(staffIds) : []).map((person) => [person.id, person]),
    );
    return rows.map((row) => ({
      ...row,
      corporateClientName: row.corporateClientId ? (clients.get(row.corporateClientId) ?? null) : null,
      staffName: row.staffId ? (people.get(row.staffId)?.fullName ?? null) : null,
    }));
  }

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
 * product's discount over the counter; and one voucher books it: Dr cash (card, wallet) for what is paid, the
 * receivable of whoever owes the due (a member's, the company's or the staff's) and the sales discount / Cr pharmacy
 * sales (gross); Dr cost of medicines sold / Cr pharmacy inventory at cost. A company's due must be within its limit;
 * a staff member's goes on their staff ledger.
 */
@CommandHandler(MakeSaleCommand)
export class MakeSaleHandler implements ICommandHandler<MakeSaleCommand> {
  constructor(private readonly sales: SaleDesk) {}

  async execute(command: MakeSaleCommand) {
    const { desk, keeper } = this.sales;
    const { actor, outletId, soldOn, loyalMemberId, corporateClientId, staffId, lines } = command;
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
      const client = corporateClientId ? await this.sales.client(corporateClientId) : null;
      if (staffId && (await this.sales.person(staffId)).status !== 'active') {
        throw new DomainError('inactive_staff', 'The staff member is not active');
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
        corporateClientId,
        staffId,
        parts,
        method: command.method,
        reference: command.reference,
        tendered: command.tendered,
        soldBy: actor.userId,
        now: desk.clock.now(),
      });
      if (client && sale.due > 0) await this.sales.assertCredit(client, sale.due);
      const narration = `Medicine sale ${number}`;
      const voucherLines: LedgerPostingLine[] = [
        ...(sale.paid > 0
          ? [{ account: { role: RECEIPT_ROLES[sale.method] }, debit: sale.paid, credit: 0, narration }]
          : []),
        ...(sale.due > 0
          ? [{ account: { role: receivableRole(sale.debtor) }, debit: sale.due, credit: 0, narration }]
          : []),
        ...(sale.discount > 0
          ? [{ account: { role: PHARMACY_DISCOUNT_ROLE }, debit: sale.discount, credit: 0, narration }]
          : []),
        ...(sale.amount > 0
          ? [{ account: { role: PHARMACY_SALES_ROLE }, debit: 0, credit: sale.amount, narration }]
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
      await this.sales.staffEntry(sale, soldOn, narration, sale.due, true);
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

/**
 * A whole sale undone: its lots come back at their cost and a reversing voucher is posted. By pharmacy:manage, or by
 * the seller (pharmacy:sell) on their own sale, dated the day of the sale, within a day of making it.
 */
@CommandHandler(CancelSaleCommand)
export class CancelSaleHandler implements ICommandHandler<CancelSaleCommand> {
  constructor(private readonly sales: SaleDesk) {}

  async execute({ actor, id, version, on, reason }: CancelSaleCommand): Promise<void> {
    const { desk, keeper } = this.sales;
    const manages = await desk.access.isAllowed(actor.userId, { permissions: [PHARMACY_MANAGE] });
    if (!manages) await desk.access.authorize(actor.userId, { permissions: [PHARMACY_SELL] });
    await desk.tx.run(async () => {
      const sale = await this.sales.sale(id, version);
      if (!manages && !sale.isOwnSameDay(actor.userId, on, desk.clock.now())) {
        throw new ForbiddenError('not_own_sale_today', 'Only a manager cancels a sale other than your own of today');
      }
      const narration = `Cancelled sale ${sale.number}`;
      const lines: LedgerPostingLine[] = [
        ...(sale.paid > 0
          ? [{ account: { role: RECEIPT_ROLES[sale.method] }, debit: 0, credit: sale.paid, narration }]
          : []),
        ...(sale.due > 0
          ? [{ account: { role: receivableRole(sale.debtor) }, debit: 0, credit: sale.due, narration }]
          : []),
        ...(sale.discount > 0
          ? [{ account: { role: PHARMACY_DISCOUNT_ROLE }, debit: 0, credit: sale.discount, narration }]
          : []),
        ...(sale.amount > 0
          ? [{ account: { role: PHARMACY_SALES_ROLE }, debit: sale.amount, credit: 0, narration }]
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
      await this.sales.staffEntry(sale, on, narration, sale.due, false);
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
      return this.sales.collection(
        actor,
        { loyalMemberId, corporateClientId: null, staffId: null },
        PHARMACY_RECEIVABLE_ROLE,
        (number) => `Due collection ${number}`,
        { collectedOn, amount, method, reference: ref },
        parts,
      );
    });
  }
}

/**
 * Old pharmacy corporate client due collection: what a company pays at the pharmacy goes to its credit sales oldest
 * first, never above them (its hospital bills are collected at the hospital's counter); Dr cash (card, wallet) / Cr
 * the corporate receivable.
 */
@CommandHandler(CollectCorporateDueCommand)
export class CollectCorporateDueHandler implements ICommandHandler<CollectCorporateDueCommand> {
  constructor(private readonly sales: SaleDesk) {}

  async execute({ actor, corporateClientId, collectedOn, amount, method, reference }: CollectCorporateDueCommand) {
    const { desk } = this.sales;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_SELL] });
    const ref = text(reference, 100, 'reference', 'Collection');
    return desk.tx.run(async () => {
      const client = await this.sales.corporate.lockForCredit(corporateClientId);
      if (!client) throw new NotFoundError('corporate_client');
      const parts = allocateCollection(amount, await this.sales.sales.corporateDues(corporateClientId));
      return this.sales.collection(
        actor,
        { loyalMemberId: null, corporateClientId, staffId: null },
        CORPORATE_RECEIVABLE_ROLE,
        (number) => `${client.name} paid ${number}`,
        { collectedOn, amount, method, reference: ref },
        parts,
      );
    });
  }
}

/**
 * Old staff due collection at a counter: what a staff member pays against their staff ledger (every unit's credit and
 * old dues), never above what they owe; Dr cash (card, wallet) / Cr the staff receivable, and a credit on the ledger.
 * Someone who has left may still pay.
 */
@CommandHandler(CollectStaffDueCommand)
export class CollectStaffDueHandler implements ICommandHandler<CollectStaffDueCommand> {
  constructor(private readonly sales: SaleDesk) {}

  async execute({ actor, staffId, collectedOn, amount, method, reference }: CollectStaffDueCommand) {
    const { desk } = this.sales;
    await desk.access.authorize(actor.userId, { permissions: [PHARMACY_SELL] });
    const ref = text(reference, 100, 'reference', 'Collection');
    if (!Number.isFinite(amount) || amount <= 0 || Math.abs(paisa(amount) - amount * 100) > 1e-6) {
      throw new DomainError('invalid_amount', 'Collect more than 0, in taka and paisa');
    }
    return desk.tx.run(async () => {
      const person = await this.sales.person(staffId);
      const owed = await this.sales.ledger.lockBalance(staffId);
      if (paisa(amount) > paisa(owed)) {
        throw new DomainError('overpayment', `Only ${Math.max(0, owed).toFixed(2)} is owed by ${person.fullName}`);
      }
      const collected = await this.sales.collection(
        actor,
        { loyalMemberId: null, corporateClientId: null, staffId },
        STAFF_RECEIVABLE_ROLE,
        (number) => `${person.fullName} paid ${number}`,
        { collectedOn, amount, method, reference: ref },
        [],
      );
      await this.sales.ledger.post({
        staffId,
        entryDate: collectedOn,
        particulars: `Paid at the pharmacy ${collected.number}`,
        debit: 0,
        credit: amount,
        reference: collected.number,
      });
      return collected;
    });
  }
}

@QueryHandler(ListSalesQuery)
export class ListSalesHandler implements IQueryHandler<ListSalesQuery> {
  constructor(
    private readonly read: SaleReadRepository,
    private readonly access: AccessControl,
    private readonly sales: SaleDesk,
  ) {}

  async execute({ actor, filter }: ListSalesQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const page = await this.read.listSales(filter);
    return { ...page, items: await this.sales.named(page.items) };
  }
}

@QueryHandler(GetSaleQuery)
export class GetSaleHandler implements IQueryHandler<GetSaleQuery> {
  constructor(
    private readonly read: SaleReadRepository,
    private readonly access: AccessControl,
    private readonly sales: SaleDesk,
  ) {}

  async execute({ actor, id }: GetSaleQuery) {
    await this.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const sale = await this.read.getSale(id);
    if (!sale) throw new NotFoundError('sale');
    const [named] = await this.sales.named([sale]);
    return named!;
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

/** A company's credit at the pharmacy: what it owes in all against its limit, and the pharmacy sales still owing. */
@QueryHandler(GetCorporateDuesQuery)
export class GetCorporateDuesHandler implements IQueryHandler<GetCorporateDuesQuery> {
  constructor(
    private readonly read: SaleReadRepository,
    private readonly sales: SaleDesk,
  ) {}

  async execute({ actor, corporateClientId }: GetCorporateDuesQuery) {
    await this.sales.desk.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const client = await this.sales.corporate.find(corporateClientId);
    if (!client) throw new NotFoundError('corporate_client');
    const sales = await this.read.corporateSales(corporateClientId);
    return {
      corporateClientId,
      name: client.name,
      payment: client.payment,
      creditLimit: client.creditLimit,
      owed: await this.sales.corporate.owed(corporateClientId),
      due: taka(sales.reduce((total, sale) => total + paisa(sale.due) - paisa(sale.collected), 0)),
      sales,
    };
  }
}

/** What a staff member owes on their staff ledger, and their latest credit sales at the pharmacy. */
@QueryHandler(GetStaffDuesQuery)
export class GetStaffDuesHandler implements IQueryHandler<GetStaffDuesQuery> {
  constructor(
    private readonly read: SaleReadRepository,
    private readonly sales: SaleDesk,
  ) {}

  async execute({ actor, staffId }: GetStaffDuesQuery) {
    await this.sales.desk.access.authorize(actor.userId, { permissions: [PHARMACY_READ] });
    const person = await this.sales.person(staffId);
    return {
      staffId,
      employeeNo: person.employeeNo,
      fullName: person.fullName,
      balance: await this.sales.ledger.balance(staffId),
      sales: await this.read.staffSales(staffId, 50),
    };
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
  CollectCorporateDueHandler,
  CollectStaffDueHandler,
  ListSalesHandler,
  GetSaleHandler,
  GetMemberDuesHandler,
  GetCorporateDuesHandler,
  GetStaffDuesHandler,
];
