import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { DepartmentStock } from '../../../shared/application/contracts/department-stock.js';
import { LedgerPosting, type LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import { StaffDirectory } from '../../../shared/application/contracts/staff-directory.js';
import { UserDirectory } from '../../../shared/application/contracts/user-directory.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { CanteenRepository, type Outlet } from '../domain/repositories.js';
import { priceSale, stockToUse } from '../domain/sale.js';
import {
  CANTEEN_MANAGE,
  CANTEEN_READ,
  CANTEEN_RECEIVABLE_ROLE,
  CANTEEN_SALES_ROLE,
  CANTEEN_SELL,
  CANTEEN_SETTINGS,
  CANTEEN_VAT_ROLE,
  CancelSaleCommand,
  CanteenReadRepository,
  CASH_ROLE,
  CollectDueCommand,
  GetSaleQuery,
  ListSalesQuery,
  MemberStatementQuery,
  OutletUsersQuery,
  SellCommand,
  SetOutletUsersCommand,
  type CanteenSettings,
} from './canteen.messages.js';

const cents = (value: number) => Math.round(value * 100) / 100;

@Injectable()
export class CanteenDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly posting: LedgerPosting,
    readonly stock: DepartmentStock,
    readonly staff: StaffDirectory,
    readonly users: UserDirectory,
    readonly canteen: CanteenRepository,
    readonly read: CanteenReadRepository,
    @Inject(CANTEEN_SETTINGS) readonly settings: CanteenSettings,
  ) {}

  today(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.settings.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.clock.now());
  }

  async number(kind: 'CS' | 'CC', on: string): Promise<string> {
    const year = Number(on.slice(0, 4));
    return `${kind}-${year}-${String(await this.canteen.nextSerial(kind, year)).padStart(5, '0')}`;
  }

  /** An active outlet the actor sells at (canteen:manage sells anywhere). */
  async sellingAt(actor: Actor, outletId: string): Promise<Outlet> {
    await this.access.authorize(actor.userId, { permissions: [CANTEEN_SELL] });
    const outlet = await this.canteen.outlet(outletId);
    if (!outlet) throw new NotFoundError('canteen_outlet');
    if (!outlet.isActive) throw new DomainError('outlet_inactive', `${outlet.name} is closed`);
    if (
      !(await this.canteen.isOutletUser(outletId, actor.userId)) &&
      !(await this.access.isAllowed(actor.userId, { permissions: [CANTEEN_MANAGE] }))
    ) {
      throw new ForbiddenError('not_your_outlet', `You do not sell at ${outlet.name}`);
    }
    return outlet;
  }

  /** Posts a balanced voucher, leaving out empty lines. */
  post(reference: string, voucherDate: string, narration: string, lines: LedgerPostingLine[], by: string) {
    return this.posting.post({
      journal: 'JV',
      voucherDate,
      narration,
      source: { module: 'canteen', reference },
      lines: lines.filter((line) => line.debit > 0 || line.credit > 0),
      postedBy: by,
    });
  }
}

/**
 * Old SaleInvoice: a sale at the outlet. Staff pay staff rates; only a member leaves a due. Packaged goods are used up
 * from the outlet's store department; when it holds too little the sale stands and is marked short. Books: Dr cash
 * (paid), Dr member receivable (due) / Cr canteen sales (net of discount), Cr VAT payable.
 */
@CommandHandler(SellCommand)
export class SellHandler implements ICommandHandler<SellCommand> {
  constructor(private readonly desk: CanteenDesk) {}

  async execute({ actor, input }: SellCommand) {
    const { desk } = this;
    const outlet = await desk.sellingAt(actor, input.outletId);
    if ((input.customerKind === 'staff') !== (input.staffId !== null)) {
      throw new DomainError('invalid_customer', 'A staff sale names the staff member, and only it');
    }
    if ((input.customerKind === 'member') !== (input.memberId !== null)) {
      throw new DomainError('invalid_customer', 'A member sale names the member, and only it');
    }
    let customerName = input.customerName?.trim() || null;
    if (input.staffId) {
      const [person] = await desk.staff.findSummaries([input.staffId]);
      if (!person || person.status !== 'active') throw new NotFoundError('staff');
      customerName = person.fullName;
    }
    const items = await desk.canteen.items(input.lines.map((line) => line.itemId));
    const totals = priceSale({ ...input, items });
    const today = desk.today();
    const now = desk.clock.now();
    const result = await desk.tx.run(async () => {
      if (input.memberId) {
        const member = await desk.canteen.memberForUpdate(input.memberId);
        if (!member) throw new NotFoundError('canteen_member');
        if (!member.isActive) throw new DomainError('member_inactive', `${member.name} is not a member any more`);
        customerName = member.name;
      }
      const id = randomUUID();
      const number = await desk.number('CS', today);
      const narration = `Canteen sale ${number} at ${outlet.name}`;
      const voucher = await desk.post(
        id,
        today,
        narration,
        [
          { account: { role: CASH_ROLE }, debit: totals.paid, credit: 0, narration },
          { account: { role: CANTEEN_RECEIVABLE_ROLE }, debit: totals.due, credit: 0, narration },
          { account: { role: CANTEEN_SALES_ROLE }, debit: 0, credit: cents(totals.gross - totals.discount), narration },
          { account: { role: CANTEEN_VAT_ROLE }, debit: 0, credit: totals.vat, narration },
        ],
        actor.userId,
      );
      const toUse = stockToUse(totals.lines, items);
      let consumptionNumber: string | null = null;
      let stockShort = false;
      if (toUse.length && outlet.storeDepartmentId) {
        const consumed = await desk.stock.consume({
          departmentId: outlet.storeDepartmentId,
          on: today,
          note: `Canteen sale ${number}`,
          lines: toUse,
          by: actor.userId,
        });
        consumptionNumber = consumed?.number ?? null;
        stockShort = consumed === null;
      }
      await desk.canteen.insertSale(
        {
          id,
          number,
          outletId: outlet.id,
          soldOn: today,
          soldAt: now,
          customerKind: input.customerKind,
          staffId: input.staffId,
          memberId: input.memberId,
          customerName,
          gross: totals.gross,
          discount: totals.discount,
          vat: totals.vat,
          net: totals.net,
          paid: totals.paid,
          due: totals.due,
          status: 'billed',
          cancelReason: null,
          consumptionNumber,
          stockShort,
          voucherNumber: voucher.number,
          soldBy: actor.userId,
          cancelledBy: null,
          cancelledAt: null,
          version: 1,
        },
        totals.lines,
      );
      const stock = !toUse.length || !outlet.storeDepartmentId ? 'none' : stockShort ? 'short' : 'used';
      return { id, number, net: totals.net, due: totals.due, stock };
    });
    return { ...result, change: cents(Math.max(0, input.paid - totals.net)) };
  }
}

/**
 * Old SaleCancelReason: a sale taken back with the reason — by the seller on its day, by canteen:manage later. The
 * money is reversed (and a member's due); packaged goods already used up stay used up (enter a return in the store).
 */
@CommandHandler(CancelSaleCommand)
export class CancelSaleHandler implements ICommandHandler<CancelSaleCommand> {
  constructor(private readonly desk: CanteenDesk) {}

  async execute({ actor, id, version, reason }: CancelSaleCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [CANTEEN_SELL] });
    const why = reason.trim();
    if (!why || why.length > 300) throw new DomainError('invalid_text', 'Give the reason (up to 300 characters)');
    const today = desk.today();
    await desk.tx.run(async () => {
      const sale = await desk.canteen.saleForUpdate(id);
      if (!sale) throw new NotFoundError('canteen_sale');
      await desk.sellingAt(actor, sale.outletId);
      if (sale.version !== version) throw new ConflictError('stale_sale', 'The sale was changed meanwhile; reload it');
      if (sale.status === 'cancelled') throw new DomainError('sale_state', 'The sale is cancelled');
      if (sale.soldOn !== today && !(await desk.access.isAllowed(actor.userId, { permissions: [CANTEEN_MANAGE] }))) {
        throw new ForbiddenError('sale_day_over', 'A sale of another day is cancelled by the canteen manager');
      }
      if (sale.memberId) {
        await desk.canteen.memberForUpdate(sale.memberId);
        if ((await desk.canteen.memberBalance(sale.memberId)) < sale.due) {
          throw new DomainError('due_collected', 'The member has paid towards this due; it is not cancelled');
        }
      }
      const narration = `Canteen sale ${sale.number} cancelled: ${why}`;
      await desk.post(
        `${sale.id}:cancel`,
        today,
        narration,
        [
          { account: { role: CASH_ROLE }, debit: 0, credit: sale.paid, narration },
          { account: { role: CANTEEN_RECEIVABLE_ROLE }, debit: 0, credit: sale.due, narration },
          { account: { role: CANTEEN_SALES_ROLE }, debit: cents(sale.gross - sale.discount), credit: 0, narration },
          { account: { role: CANTEEN_VAT_ROLE }, debit: sale.vat, credit: 0, narration },
        ],
        actor.userId,
      );
      await desk.canteen.cancelSale(id, why, actor.userId, desk.clock.now(), version + 1);
      await desk.audit.record({
        action: 'canteen.sale_cancelled',
        actorUserId: actor.userId,
        resourceType: 'canteen_sale',
        resourceId: id,
        metadata: { number: sale.number, reason: why },
      });
    });
  }
}

/** Old MemberDueCollectionInvoice: a member pays against what they owe (never more). Dr cash / Cr member receivable. */
@CommandHandler(CollectDueCommand)
export class CollectDueHandler implements ICommandHandler<CollectDueCommand> {
  constructor(private readonly desk: CanteenDesk) {}

  async execute({ actor, memberId, amount, note }: CollectDueCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [CANTEEN_SELL] });
    if (!(amount > 0) || cents(amount) !== amount) throw new DomainError('invalid_amount', 'The amount is above 0');
    const today = desk.today();
    return desk.tx.run(async () => {
      const member = await desk.canteen.memberForUpdate(memberId);
      if (!member) throw new NotFoundError('canteen_member');
      const owed = await desk.canteen.memberBalance(memberId);
      if (amount > owed) throw new DomainError('over_collection', `${member.name} owes ${owed.toFixed(2)}`);
      const id = randomUUID();
      const number = await desk.number('CC', today);
      const narration = `Canteen dues of ${member.name} (${number})`;
      const voucher = await desk.post(
        id,
        today,
        narration,
        [
          { account: { role: CASH_ROLE }, debit: amount, credit: 0, narration },
          { account: { role: CANTEEN_RECEIVABLE_ROLE }, debit: 0, credit: amount, narration },
        ],
        actor.userId,
      );
      await desk.canteen.insertCollection({
        id,
        number,
        memberId,
        receivedOn: today,
        amount,
        note: note?.trim() || null,
        voucherNumber: voucher.number,
        receivedBy: actor.userId,
      });
      return { id, number, balance: cents(owed - amount) };
    });
  }
}

/** Old SalesmanDutyOutlet: who sells at an outlet (the whole list). */
@CommandHandler(SetOutletUsersCommand)
export class SetOutletUsersHandler implements ICommandHandler<SetOutletUsersCommand> {
  constructor(private readonly desk: CanteenDesk) {}

  async execute({ actor, outletId, userIds }: SetOutletUsersCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [CANTEEN_MANAGE] });
    if (!(await desk.canteen.outlet(outletId))) throw new NotFoundError('canteen_outlet');
    const unique = [...new Set(userIds)];
    const found = unique.length ? await desk.users.findSummaries(unique) : [];
    if (found.length !== unique.length) throw new NotFoundError('user');
    await desk.tx.run(() => desk.canteen.setOutletUsers(outletId, unique));
  }
}

@QueryHandler(OutletUsersQuery)
export class OutletUsersHandler implements IQueryHandler<OutletUsersQuery> {
  constructor(private readonly desk: CanteenDesk) {}

  async execute({ actor, outletId }: OutletUsersQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [CANTEEN_READ] });
    return this.desk.read.outletUsers(outletId);
  }
}

@QueryHandler(ListSalesQuery)
export class ListSalesHandler implements IQueryHandler<ListSalesQuery> {
  constructor(private readonly desk: CanteenDesk) {}

  async execute({ actor, filter }: ListSalesQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [CANTEEN_READ] });
    return this.desk.read.sales(filter);
  }
}

@QueryHandler(GetSaleQuery)
export class GetSaleHandler implements IQueryHandler<GetSaleQuery> {
  constructor(private readonly desk: CanteenDesk) {}

  async execute({ actor, id }: GetSaleQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [CANTEEN_READ] });
    const sale = await this.desk.read.sale(id);
    if (!sale) throw new NotFoundError('canteen_sale');
    return sale;
  }
}

@QueryHandler(MemberStatementQuery)
export class MemberStatementHandler implements IQueryHandler<MemberStatementQuery> {
  constructor(private readonly desk: CanteenDesk) {}

  async execute({ actor, memberId }: MemberStatementQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [CANTEEN_READ] });
    const statement = await this.desk.read.memberStatement(memberId);
    if (!statement) throw new NotFoundError('canteen_member');
    return statement;
  }
}

export const CANTEEN_HANDLERS = [
  CanteenDesk,
  SellHandler,
  CancelSaleHandler,
  CollectDueHandler,
  SetOutletUsersHandler,
  OutletUsersHandler,
  ListSalesHandler,
  GetSaleHandler,
  MemberStatementHandler,
];
