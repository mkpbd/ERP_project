import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { CollectionRow, SaleRow } from '../domain/repositories.js';
import type { CustomerKind } from '../domain/sale.js';

/** Seeing the menu, outlets, members, sales and dues. */
export const CANTEEN_READ = 'canteen:read';
/** The menu (groups, items, rates, VAT, store items), outlets and who sells there, members; any day's cancellation. */
export const CANTEEN_MANAGE = 'canteen:manage';
/** Selling at one's outlets, cancelling the day's sales, taking members' dues. */
export const CANTEEN_SELL = 'canteen:sell';

export const CANTEEN_RECORDS = {
  group: 'canteen_group',
  item: 'canteen_item',
  outlet: 'canteen_outlet',
  member: 'canteen_member',
} as const;

/** Ledger roles of the canteen. */
export const CANTEEN_SALES_ROLE = 'canteen_sales';
export const CANTEEN_VAT_ROLE = 'canteen_vat_payable';
export const CANTEEN_RECEIVABLE_ROLE = 'canteen_member_receivable';
export const CASH_ROLE = 'cash_in_hand';

export const CANTEEN_SETTINGS = Symbol('CANTEEN_SETTINGS');
export interface CanteenSettings {
  readonly timeZone: string;
}

export interface SaleLineView {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string;
  readonly qty: number;
  readonly rate: number;
  readonly amount: number;
  readonly vat: number;
}

export interface SaleView extends SaleRow {
  readonly outletName: string;
  readonly memberName: string | null;
  readonly lines: SaleLineView[];
}

export interface SaleFilter extends PageRequest {
  readonly outletId?: string | undefined;
  readonly memberId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly status?: 'billed' | 'cancelled' | undefined;
}

export interface MemberStatement {
  readonly member: { readonly id: string; readonly name: string; readonly mobileNo: string };
  readonly entries: {
    readonly on: string;
    readonly number: string;
    readonly kind: 'sale' | 'collection';
    readonly debit: number;
    readonly credit: number;
    readonly balance: number;
  }[];
  readonly balance: number;
}

export abstract class CanteenReadRepository {
  abstract sales(filter: SaleFilter): Promise<Page<SaleRow & { outletName: string }>>;
  abstract sale(id: string): Promise<SaleView | null>;
  abstract outletUsers(outletId: string): Promise<string[]>;
  abstract memberStatement(memberId: string): Promise<MemberStatement | null>;
  /** Members owing something, most owed first. */
  abstract dues(): Promise<{ id: string; name: string; mobileNo: string; balance: number }[]>;
  /** Items sold over the days (sales not cancelled), by outlet when given. */
  abstract itemSales(
    from: string,
    to: string,
    outletId: string | null,
  ): Promise<{ itemName: string; groupName: string; qty: number; amount: number; vat: number }[]>;
  abstract collection(id: string): Promise<CollectionRow | null>;
}

export interface SaleInput {
  readonly outletId: string;
  readonly customerKind: CustomerKind;
  readonly staffId: string | null;
  readonly memberId: string | null;
  readonly customerName: string | null;
  readonly lines: { itemId: string; qty: number }[];
  readonly discount: number;
  /** Cash received; more than the bill is change. */
  readonly paid: number;
}

export class SellCommand extends Command<{
  id: string;
  number: string;
  net: number;
  due: number;
  change: number;
  stock: string;
}> {
  constructor(
    readonly actor: Actor,
    readonly input: SaleInput,
  ) {
    super();
  }
}

export class CancelSaleCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export class CollectDueCommand extends Command<{ id: string; number: string; balance: number }> {
  constructor(
    readonly actor: Actor,
    readonly memberId: string,
    readonly amount: number,
    readonly note: string | null,
  ) {
    super();
  }
}

export class SetOutletUsersCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly outletId: string,
    readonly userIds: readonly string[],
  ) {
    super();
  }
}

export class OutletUsersQuery extends Query<string[]> {
  constructor(
    readonly actor: Actor,
    readonly outletId: string,
  ) {
    super();
  }
}

export class ListSalesQuery extends Query<Page<SaleRow & { outletName: string }>> {
  constructor(
    readonly actor: Actor,
    readonly filter: SaleFilter,
  ) {
    super();
  }
}

export class GetSaleQuery extends Query<SaleView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class MemberStatementQuery extends Query<MemberStatement> {
  constructor(
    readonly actor: Actor,
    readonly memberId: string,
  ) {
    super();
  }
}
