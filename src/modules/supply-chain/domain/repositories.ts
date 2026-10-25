import type { ComparativeStudy } from './comparative-study.js';
import type { ApprovalLevel } from './documents.js';
import type { PurchaseOrder } from './purchase-order.js';
import type { PurchaseRequisition } from './requisition.js';
import type { StockReceive } from './stock-receive.js';

/** Serial numbers per document kind and year. */
export abstract class ScmSequences {
  abstract next(kind: string, year: number): Promise<number>;
}

export interface PurchaseApprovalLevel extends ApprovalLevel {
  readonly roleId: string;
}

export interface StudyApprovalLevel extends ApprovalLevel {
  readonly approverStaffId: string;
}

export abstract class ApprovalLevels {
  /** A main store's requisition approval levels, in order. */
  abstract purchase(mainStoreId: string): Promise<PurchaseApprovalLevel[]>;
  /** The comparative study approval levels, in order. */
  abstract study(): Promise<StudyApprovalLevel[]>;
}

export abstract class RequisitionRepository {
  /** Locks the requisition until the transaction ends. */
  abstract findForUpdate(id: string): Promise<PurchaseRequisition | null>;
  /** Throws NotFoundError for a missing store, department, supplier or item. */
  abstract insert(requisition: PurchaseRequisition): Promise<void>;
  abstract update(requisition: PurchaseRequisition): Promise<void>;
  abstract delete(id: string): Promise<void>;
}

export abstract class StudyRepository {
  abstract findForUpdate(id: string): Promise<ComparativeStudy | null>;
  abstract insert(study: ComparativeStudy): Promise<void>;
  abstract update(study: ComparativeStudy): Promise<void>;
  abstract delete(id: string): Promise<void>;
  /** The status of the requisition a study names, or null when there is none. */
  abstract requisitionStatus(requisitionId: string): Promise<string | null>;
}

export abstract class OrderRepository {
  abstract findForUpdate(id: string): Promise<PurchaseOrder | null>;
  abstract insert(order: PurchaseOrder): Promise<void>;
  abstract update(order: PurchaseOrder): Promise<void>;
  /** Variant → quantity on the requisition's orders that are not cancelled, leaving out `exceptOrderId`. */
  abstract orderedFor(requisitionId: string, exceptOrderId?: string): Promise<Map<string, number>>;
  /** Whether any order that is not cancelled uses the requisition. */
  abstract hasOrders(requisitionId: string): Promise<boolean>;
  /** Suppliers whose quotes won the approved study, or null when the study is not approved. */
  abstract studyWinners(studyId: string): Promise<{ supplierIds: Set<string> } | null>;
}

export type StoreRef = { readonly mainStoreId: string } | { readonly subStoreId: string };

export interface NewMovement {
  readonly store: StoreRef;
  readonly variantId: string;
  readonly lotId: string;
  /** Positive in, negative out. */
  readonly qty: number;
  readonly unitCost: number;
  readonly movedOn: string;
  readonly kind: 'opening' | 'receive';
  readonly documentId: string;
  readonly documentNumber: string;
}

export abstract class StockLedger {
  /** The lot of a variant with this batch and expiry, created on first use. */
  abstract lot(variantId: string, batchNo: string | null, expiryDate: string | null): Promise<string>;
  abstract add(movements: readonly NewMovement[]): Promise<void>;
}

export interface CatalogueVariant {
  readonly isActive: boolean;
  readonly expiryRequired: boolean;
  /** The item type's inventory account (old BrandName.ItemTypeId), if set. */
  readonly inventoryGlAccountId: string | null;
}

export interface PayableSupplier {
  readonly name: string;
  readonly isActive: boolean;
  readonly glAccountId: string | null;
  readonly subLedgerId: string | null;
}

export abstract class CatalogueFacts {
  /** Throws NotFoundError when a variant does not exist. */
  abstract variants(ids: readonly string[]): Promise<Map<string, CatalogueVariant>>;
  abstract supplier(id: string): Promise<PayableSupplier | null>;
  /** The variants' purchase price becomes the latest received rate (old SyncBrandExtensionPurchasePrice). */
  abstract updatePurchasePrices(rates: ReadonlyMap<string, number>): Promise<void>;
}

export abstract class ReceiveRepository {
  abstract findForUpdate(id: string): Promise<StockReceive | null>;
  abstract insert(receive: StockReceive): Promise<void>;
  abstract update(receive: StockReceive): Promise<void>;
  abstract delete(id: string): Promise<void>;
  /** Records the lot each line went into, by line position. */
  abstract setLots(receiveId: string, lotIds: readonly string[]): Promise<void>;
}

export interface OpeningRecord {
  readonly id: string;
  readonly number: string;
  readonly store: StoreRef;
  readonly openedOn: string;
  readonly note: string | null;
  readonly createdBy: string;
}

export abstract class OpeningRepository {
  abstract insert(opening: OpeningRecord): Promise<void>;
}
