import type { LotBalance } from './allocation.js';
import type { OutletIndent } from './outlet-indent.js';
import type { DiscountPolicy, ProductDiscount } from './discount.js';
import type { PharmacyOrder } from './purchase-order.js';
import type { ReturnChannel, ReturnPolicy } from './return-window.js';
import type { PharmacySale, ReturnedPart, SaleDue } from './sale.js';
import type { StockCount } from './stock-count.js';
import type { OutletTransfer } from './transfer.js';
import type { PharmacyReceive } from './receive.js';
import type { PaymentAllocation, ReceiveDue } from './supplier-payment.js';
import type { SupplierReturn } from './supplier-return.js';
import type { WardIndent, WardIssue, WardReturnPart } from './ward.js';

export abstract class PharmacySequences {
  abstract next(kind: string, year: number): Promise<number>;
}

export type MovementKind =
  | 'opening'
  | 'receive'
  | 'supplier_return'
  | 'replacement'
  | 'transfer_out'
  | 'transfer_in'
  | 'sale'
  | 'sale_cancel'
  | 'sale_return'
  | 'count_adjustment'
  | 'ward_issue'
  | 'ward_return';

export interface NewMovement {
  readonly outletId: string;
  readonly productId: string;
  readonly lotId: string;
  /** Units: positive in, negative out. */
  readonly qty: number;
  readonly unitCost: number;
  readonly movedOn: string;
  readonly kind: MovementKind;
  readonly documentId: string;
  readonly documentNumber: string;
}

/** The outlet movement ledger and its lots. */
export abstract class PharmacyLedger {
  /** The lot of this product, batch, expiry and sale rate, made when new. */
  abstract lot(productId: string, batchNo: string | null, expiryDate: string, saleRate: number): Promise<string>;
  abstract add(movements: readonly NewMovement[]): Promise<void>;
  /** The product and expiry of each lot; NotFoundError when one does not exist. */
  abstract lotFacts(lotIds: readonly string[]): Promise<Map<string, { productId: string; expiryDate: string }>>;
  /** Units of each lot at an outlet. */
  abstract balances(outletId: string, lotIds: readonly string[]): Promise<Map<string, number>>;
  /** Every lot of these products at the outlet with units in it (product → lots). */
  abstract stockLots(outletId: string, productIds: readonly string[]): Promise<Map<string, LotBalance[]>>;
  /** What a unit of the lot cost at the outlet: the weighted average of what came in (4 decimals). */
  abstract lotCosts(outletId: string, lotIds: readonly string[]): Promise<Map<string, number>>;
}

export interface CatalogueProduct {
  readonly isActive: boolean;
}

export interface PayableSupplier {
  readonly name: string;
  readonly isActive: boolean;
  readonly glAccountId: string | null;
  readonly subLedgerId: string | null;
}

export abstract class PharmacyFacts {
  /** NotFoundError when a product does not exist. */
  abstract products(ids: readonly string[]): Promise<Map<string, CatalogueProduct>>;
  /** The supplier (shared with the supply chain), or null. */
  abstract supplier(id: string): Promise<PayableSupplier | null>;
  abstract outletExists(id: string): Promise<boolean>;
  /** Whether the user works at the outlet (old PharmacistDutyOutlets). */
  abstract worksAt(userId: string, outletId: string): Promise<boolean>;
  /** The latest purchase and sale rate per unit become the product's prices (the old receive kept the purchase rate). */
  abstract updatePrices(rates: ReadonlyMap<string, { purchaseRate: number; saleRate: number }>): Promise<void>;
}

export abstract class OrderRepository {
  abstract findForUpdate(id: string): Promise<PharmacyOrder | null>;
  abstract insert(order: PharmacyOrder): Promise<void>;
  abstract update(order: PharmacyOrder): Promise<void>;
}

export abstract class ReceiveRepository {
  abstract findForUpdate(id: string): Promise<PharmacyReceive | null>;
  abstract insert(receive: PharmacyReceive): Promise<void>;
  abstract update(receive: PharmacyReceive): Promise<void>;
  abstract delete(id: string): Promise<void>;
  /** The lot each line went into, in line order. */
  abstract setLots(receiveId: string, lotIds: readonly string[]): Promise<void>;
}

export interface OpeningRecord {
  readonly id: string;
  readonly number: string;
  readonly outletId: string;
  readonly openedOn: string;
  readonly note: string | null;
  readonly createdBy: string;
}

export abstract class OpeningRepository {
  abstract insert(opening: OpeningRecord): Promise<void>;
}

export interface PaymentRecord {
  readonly id: string;
  readonly number: string;
  readonly supplierId: string;
  readonly paidOn: string;
  readonly method: 'cash' | 'bank';
  readonly bankAccountId: string | null;
  readonly reference: string | null;
  readonly remarks: string | null;
  readonly total: number;
  readonly voucherId: string | null;
  readonly voucherNumber: string | null;
  readonly createdBy: string;
  readonly allocations: readonly PaymentAllocation[];
}

export abstract class PaymentRepository {
  /** Posted receives among `ids`, with what has been paid on each. */
  abstract dues(receiveIds: readonly string[]): Promise<Map<string, ReceiveDue>>;
  abstract insert(payment: PaymentRecord): Promise<void>;
}

export interface SettlementRecord {
  readonly id: string;
  readonly returnId: string;
  readonly settledOn: string;
  readonly productId: string;
  readonly lotId: string;
  readonly qty: number;
  readonly purchaseRate: number;
  readonly value: number;
  readonly voucherNumber: string | null;
  readonly createdBy: string;
}

export abstract class SupplierReturnRepository {
  abstract findForUpdate(id: string): Promise<SupplierReturn | null>;
  abstract insert(supplierReturn: SupplierReturn): Promise<void>;
  abstract update(supplierReturn: SupplierReturn): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract addSettlements(settlements: readonly SettlementRecord[]): Promise<void>;
}

export abstract class IndentRepository {
  abstract findForUpdate(id: string): Promise<OutletIndent | null>;
  abstract insert(indent: OutletIndent): Promise<void>;
  abstract update(indent: OutletIndent): Promise<void>;
}

export abstract class TransferRepository {
  abstract findForUpdate(id: string): Promise<OutletTransfer | null>;
  abstract insert(transfer: OutletTransfer): Promise<void>;
  abstract update(transfer: OutletTransfer): Promise<void>;
}

export abstract class DiscountRules {
  /** The policy, or null when none is set up. */
  abstract policy(): Promise<DiscountPolicy | null>;
  abstract savePolicy(policy: DiscountPolicy, by: string): Promise<void>;
  /** The products' own rules (those that have one). */
  abstract productRules(productIds: readonly string[]): Promise<Map<string, ProductDiscount>>;
}

export interface CollectionRecord {
  readonly id: string;
  readonly number: string;
  readonly loyalMemberId: string;
  readonly collectedOn: string;
  readonly method: 'cash' | 'card' | 'mobile';
  readonly reference: string | null;
  readonly amount: number;
  readonly voucherNumber: string | null;
  readonly createdBy: string;
  readonly lines: readonly { saleId: string; amount: number }[];
}

export abstract class SaleRepository {
  abstract findForUpdate(id: string): Promise<PharmacySale | null>;
  abstract insert(sale: PharmacySale): Promise<void>;
  abstract update(sale: PharmacySale): Promise<void>;
  /** Whether the loyal member exists and is active. */
  abstract memberIsActive(loyalMemberId: string): Promise<boolean | null>;
  /** The member's completed sales with a due, locked. */
  abstract memberDues(loyalMemberId: string): Promise<SaleDue[]>;
  abstract insertCollection(collection: CollectionRecord): Promise<void>;
}

export abstract class ReturnPolicies {
  /** The channel's period, or null when none is set up (no limit). */
  abstract policy(channel: ReturnChannel): Promise<ReturnPolicy | null>;
  abstract save(channel: ReturnChannel, policy: ReturnPolicy, by: string): Promise<void>;
}

export interface SaleReturnRecord {
  readonly id: string;
  readonly number: string;
  readonly saleId: string;
  readonly outletId: string;
  readonly returnedOn: string;
  readonly reason: string | null;
  readonly amount: number;
  readonly discount: number;
  readonly refund: number;
  readonly dueReduced: number;
  readonly paidBack: number;
  readonly cost: number;
  readonly damagedCost: number;
  readonly voucherNumber: string | null;
  readonly createdBy: string;
  readonly parts: readonly ReturnedPart[];
}

export abstract class SaleReturnRepository {
  abstract insert(saleReturn: SaleReturnRecord): Promise<void>;
}

/** A lot an outlet holds as of a date. */
export interface HeldLot {
  readonly productId: string;
  readonly lotId: string;
  readonly qty: number;
  /** Value of the units at the costs they came in at. */
  readonly value: number;
}

export abstract class StockCountRepository {
  abstract findForUpdate(id: string): Promise<StockCount | null>;
  abstract insert(count: StockCount): Promise<void>;
  abstract update(count: StockCount): Promise<void>;
  /** Every lot the outlet holds (or owes) as of the date, optionally of some products only. */
  abstract lotsAsOf(outletId: string, asOf: string, productIds?: readonly string[]): Promise<HeldLot[]>;
  /** Units of the lots at the outlet as of the date. */
  abstract balancesAsOf(outletId: string, lotIds: readonly string[], asOf: string): Promise<Map<string, number>>;
}

export interface WardReturnRecord {
  readonly id: string;
  readonly number: string;
  readonly issueId: string;
  readonly returnedOn: string;
  readonly reason: string | null;
  readonly amount: number;
  readonly discount: number;
  readonly total: number;
  readonly cost: number;
  readonly voucherNumber: string | null;
  readonly returnedBy: string;
  readonly parts: readonly WardReturnPart[];
}

export abstract class WardRepository {
  abstract indentForUpdate(id: string): Promise<WardIndent | null>;
  abstract insertIndent(indent: WardIndent): Promise<void>;
  abstract updateIndent(indent: WardIndent): Promise<void>;
  abstract issueForUpdate(id: string): Promise<WardIssue | null>;
  abstract insertIssue(issue: WardIssue): Promise<void>;
  /** Saves the header and each line's returned units. */
  abstract updateIssue(issue: WardIssue): Promise<void>;
  abstract insertReturn(record: WardReturnRecord): Promise<void>;
}
