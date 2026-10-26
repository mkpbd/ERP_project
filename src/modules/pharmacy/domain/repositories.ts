import type { PharmacyOrder } from './purchase-order.js';
import type { PharmacyReceive } from './receive.js';

export abstract class PharmacySequences {
  abstract next(kind: string, year: number): Promise<number>;
}

export type MovementKind = 'opening' | 'receive';

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
  /** The latest purchase rate per unit becomes the product's purchase price (old receive did the same). */
  abstract updatePurchasePrices(rates: ReadonlyMap<string, number>): Promise<void>;
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
