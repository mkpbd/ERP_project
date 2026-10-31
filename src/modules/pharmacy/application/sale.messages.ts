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
  readonly corporateClientId?: string | undefined;
  readonly staffId?: string | undefined;
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
  readonly corporateClientId: string | null;
  readonly corporateClientName: string | null;
  readonly staffId: string | null;
  readonly staffName: string | null;
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
  readonly returnedQty: number;
}

export interface SaleView extends SaleSummary {
  readonly amount: number;
  readonly discount: number;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly tendered: number;
  readonly change: number;
  /** Refunded by returns. */
  readonly returned: number;
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

export interface DueSale {
  readonly saleId: string;
  readonly number: string;
  readonly soldOn: string;
  readonly total: number;
  readonly due: number;
  /** Collected, and taken down by returns. */
  readonly collected: number;
}

export interface MemberDues {
  readonly loyalMemberId: string;
  readonly name: string;
  readonly contactNo: string;
  readonly due: number;
  readonly sales: DueSale[];
}

/** A company's credit at the pharmacy, against its limit across the hospital and the pharmacy. */
export interface CorporateDues {
  readonly corporateClientId: string;
  readonly name: string;
  readonly payment: 'cash' | 'credit';
  readonly creditLimit: number | null;
  /** All it owes: hospital bills and pharmacy sales. */
  readonly owed: number;
  /** What it owes the pharmacy: the sales below. */
  readonly due: number;
  readonly sales: DueSale[];
}

/** What a staff member owes on their staff ledger, and what they bought on credit at the pharmacy. */
export interface StaffDues {
  readonly staffId: string;
  readonly employeeNo: string;
  readonly fullName: string;
  /** The staff ledger: every unit's credit and old dues, less what was paid or recovered. */
  readonly balance: number;
  /** The latest pharmacy credit sales, newest first. */
  readonly sales: DueSale[];
}

/** A payment against dues, as its receipt shows it. */
export interface CollectionView {
  readonly id: string;
  readonly number: string;
  readonly collectedOn: string;
  readonly method: PaymentMethod;
  readonly reference: string | null;
  readonly amount: number;
  readonly voucherNumber: string | null;
  readonly loyalMemberId: string | null;
  readonly loyalMemberName: string | null;
  readonly corporateClientId: string | null;
  readonly corporateClientName: string | null;
  readonly staffId: string | null;
  readonly staffName: string | null;
  /** The sales it settled; none for a staff member's payment. */
  readonly lines: { saleId: string; number: string; soldOn: string; amount: number }[];
}

export abstract class SaleReadRepository {
  abstract listSales(filter: SaleFilter): Promise<Page<SaleSummary>>;
  abstract getSale(id: string): Promise<SaleView | null>;
  abstract memberDues(loyalMemberId: string): Promise<MemberDues | null>;
  /** A company's completed sales still owing, oldest first. */
  abstract corporateSales(corporateClientId: string): Promise<DueSale[]>;
  /** A staff member's latest completed credit sales, newest first. */
  abstract staffSales(staffId: string, limit: number): Promise<DueSale[]>;
  abstract collection(id: string): Promise<CollectionView | null>;
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
    readonly corporateClientId: string | null,
    readonly staffId: string | null,
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

/** A company pays against its pharmacy credit sales, oldest first. */
export class CollectCorporateDueCommand extends Command<{ id: string; number: string; voucherNumber: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly corporateClientId: string,
    readonly collectedOn: string,
    readonly amount: number,
    readonly method: PaymentMethod,
    readonly reference: string | null,
  ) {
    super();
  }
}

/** A staff member pays at the pharmacy against their staff ledger. */
export class CollectStaffDueCommand extends Command<{ id: string; number: string; voucherNumber: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
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

export class GetCorporateDuesQuery extends Query<CorporateDues> {
  constructor(
    readonly actor: Actor,
    readonly corporateClientId: string,
  ) {
    super();
  }
}

export class GetStaffDuesQuery extends Query<StaffDues> {
  constructor(
    readonly actor: Actor,
    readonly staffId: string,
  ) {
    super();
  }
}
