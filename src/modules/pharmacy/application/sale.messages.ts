import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { DiscountPolicy } from '../domain/discount.js';
import type { PaymentMethod, SaleStatus } from '../domain/sale.js';
import type { ProductRef } from './purchase.messages.js';

export interface SaleLineInput {
  readonly productId: string;
  readonly qty: number;
  /** Sell from this lot only; otherwise first expiring first. */
  readonly lotId: string | null;
}

export interface SaleFilter extends PageRequest {
  readonly outletId?: string | undefined;
  readonly loyalMemberId?: string | undefined;
  readonly status?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  /** Number, customer name or mobile number. */
  readonly q?: string | undefined;
}

export interface SaleSummary {
  readonly id: string;
  readonly number: string;
  readonly soldOn: string;
  readonly outletId: string;
  readonly outletName: string;
  readonly customerName: string | null;
  readonly mobileNo: string | null;
  readonly loyalMemberId: string | null;
  readonly loyalMemberName: string | null;
  readonly total: number;
  readonly paid: number;
  readonly due: number;
  readonly collected: number;
  readonly status: SaleStatus;
  readonly version: number;
}

export interface SaleLineView extends ProductRef {
  readonly lotId: string;
  readonly batchNo: string | null;
  readonly expiryDate: string;
  readonly qty: number;
  readonly saleRate: number;
  readonly amount: number;
  readonly discountPercent: number;
  readonly discount: number;
  readonly total: number;
}

export interface SaleView extends SaleSummary {
  readonly amount: number;
  readonly discount: number;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly tendered: number;
  readonly change: number;
  readonly cancelReason: string | null;
  readonly cancelledOn: string | null;
  readonly voucherNumber: string | null;
  readonly soldBy: string | null;
  readonly lines: SaleLineView[];
}

/** The figures a sale would have, without making it. */
export interface SaleQuote {
  readonly lines: (ProductRef & {
    readonly lotId: string;
    readonly batchNo: string | null;
    readonly expiryDate: string;
    readonly qty: number;
    readonly saleRate: number;
    readonly amount: number;
    readonly discountPercent: number;
    readonly discount: number;
    readonly total: number;
  })[];
  readonly amount: number;
  readonly discount: number;
  readonly total: number;
}

export interface MemberDues {
  readonly loyalMemberId: string;
  readonly name: string;
  readonly contactNo: string;
  readonly due: number;
  readonly sales: { saleId: string; number: string; soldOn: string; total: number; due: number; collected: number }[];
}

export abstract class SaleReadRepository {
  abstract listSales(filter: SaleFilter): Promise<Page<SaleSummary>>;
  abstract getSale(id: string): Promise<SaleView | null>;
  abstract memberDues(loyalMemberId: string): Promise<MemberDues | null>;
  abstract lotLabels(lotIds: readonly string[]): Promise<Map<string, { batchNo: string | null; expiryDate: string }>>;
  abstract productRefs(productIds: readonly string[]): Promise<Map<string, ProductRef>>;
}

export class SetDiscountPolicyCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly policy: DiscountPolicy,
  ) {
    super();
  }
}

export class GetDiscountPolicyQuery extends Query<DiscountPolicy> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class QuoteSaleQuery extends Query<SaleQuote> {
  constructor(
    readonly actor: Actor,
    readonly outletId: string,
    readonly on: string,
    readonly lines: readonly SaleLineInput[],
  ) {
    super();
  }
}

export class MakeSaleCommand extends Command<{
  id: string;
  number: string;
  total: number;
  change: number;
  due: number;
  voucherNumber: string | null;
}> {
  constructor(
    readonly actor: Actor,
    readonly outletId: string,
    readonly soldOn: string,
    readonly customerName: string | null,
    readonly mobileNo: string | null,
    readonly loyalMemberId: string | null,
    readonly lines: readonly SaleLineInput[],
    readonly method: PaymentMethod,
    readonly reference: string | null,
    readonly tendered: number,
  ) {
    super();
  }
}

export class CancelSaleCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly on: string,
    readonly reason: string,
  ) {
    super();
  }
}

export class CollectDueCommand extends Command<{ id: string; number: string; voucherNumber: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly loyalMemberId: string,
    readonly collectedOn: string,
    readonly amount: number,
    readonly method: PaymentMethod,
    readonly reference: string | null,
  ) {
    super();
  }
}

export class ListSalesQuery extends Query<Page<SaleSummary>> {
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

export class GetMemberDuesQuery extends Query<MemberDues> {
  constructor(
    readonly actor: Actor,
    readonly loyalMemberId: string,
  ) {
    super();
  }
}
