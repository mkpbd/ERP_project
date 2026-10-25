import type { LotBalance } from './allocation.js';
import type { ComparativeStudy } from './comparative-study.js';
import type { DepartmentAdjustment, DepartmentConsumption, DepartmentReturn } from './department.js';
import type { ApprovalLevel } from './documents.js';
import type { PurchaseOrder } from './purchase-order.js';
import type { PurchaseRequisition } from './requisition.js';
import type { StockReceive } from './stock-receive.js';
import type { SupplierReturn } from './supplier-return.js';
import type { MoveLine, StoreIndent, StoreRequest, TransferKind, TransferStatus } from './store-documents.js';

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

/** Where stock is held: a store, or a department that was issued goods (old fnDeptStockLedger). */
export type StockPlace = StoreRef | { readonly departmentId: string };

export type MovementKind =
  'opening' | 'receive' | 'issue' | 'transfer' | 'consumption' | 'department_return' | 'adjustment' | 'supplier_return';

export interface NewMovement {
  readonly store: StockPlace;
  readonly variantId: string;
  readonly lotId: string;
  /** Positive in, negative out. */
  readonly qty: number;
  readonly unitCost: number;
  readonly movedOn: string;
  readonly kind: MovementKind;
  readonly documentId: string;
  readonly documentNumber: string;
}

export abstract class StockLedger {
  /** The lot of a variant with this batch and expiry, created on first use. */
  abstract lot(variantId: string, batchNo: string | null, expiryDate: string | null): Promise<string>;
  abstract add(movements: readonly NewMovement[]): Promise<void>;
  /** What the store holds of each variant, by lot (lots with nothing left are left out). */
  abstract balances(place: StockPlace, variantIds: readonly string[]): Promise<Map<string, LotBalance[]>>;
  /** A lot's average cost over everything received into it (for counted stock found without a balance). */
  abstract lotCost(lotId: string): Promise<number>;
  /** Puts back what a document moved: the same lots and costs with the signs turned, dated on the given day. */
  abstract reverse(documentId: string, on: string): Promise<void>;
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

export abstract class IndentRepository {
  abstract findForUpdate(id: string): Promise<StoreIndent | null>;
  /** Throws NotFoundError for a missing sub-store, department or item. */
  abstract insert(indent: StoreIndent): Promise<void>;
  abstract update(indent: StoreIndent): Promise<void>;
  abstract delete(id: string): Promise<void>;
  /** A sub-store's indent approval levels, in order. */
  abstract levels(subStoreId: string): Promise<PurchaseApprovalLevel[]>;
}

export abstract class RequestRepository {
  abstract findForUpdate(id: string): Promise<StoreRequest | null>;
  abstract insert(request: StoreRequest): Promise<void>;
  abstract update(request: StoreRequest): Promise<void>;
}

export interface IssueRecord {
  readonly id: string;
  readonly number: string;
  readonly subStoreId: string;
  readonly departmentId: string;
  readonly indentId: string | null;
  readonly issueDate: string;
  readonly receivedByStaffId: string | null;
  readonly note: string | null;
  readonly issuedBy: string;
  readonly lines: readonly MoveLine[];
}

export interface TransferRecord {
  readonly id: string;
  readonly number: string;
  readonly kind: TransferKind;
  readonly from: StoreRef;
  readonly to: StoreRef;
  readonly requestId: string | null;
  readonly transferDate: string;
  status: TransferStatus;
  readonly note: string | null;
  rejectReason: string | null;
  readonly sentBy: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  version: number;
  lines: (MoveLine & { acceptedQty: number | null })[];
}

export abstract class StoreMoveRepository {
  abstract insertIssue(issue: IssueRecord): Promise<void>;
  abstract insertTransfer(transfer: TransferRecord): Promise<void>;
  abstract findTransferForUpdate(id: string): Promise<TransferRecord | null>;
  abstract updateTransfer(transfer: TransferRecord): Promise<void>;
}

/** Who may do what in which store (old DeptStoreAcess, StoreDeptUserAccess, IssueStoreAcess). */
export abstract class StoreAccess {
  /** The sub-store's main store, or null when there is no such sub-store. */
  abstract mainStoreOf(subStoreId: string): Promise<string | null>;
  abstract mayIndentFor(userId: string, departmentId: string): Promise<boolean>;
  abstract mayIssueFrom(userId: string, subStoreId: string): Promise<boolean>;
}

export abstract class ConsumptionRepository {
  abstract findForUpdate(id: string): Promise<DepartmentConsumption | null>;
  abstract insert(consumption: DepartmentConsumption): Promise<void>;
  abstract update(consumption: DepartmentConsumption): Promise<void>;
}

export abstract class DepartmentReturnRepository {
  abstract findForUpdate(id: string): Promise<DepartmentReturn | null>;
  abstract insert(departmentReturn: DepartmentReturn): Promise<void>;
  abstract update(departmentReturn: DepartmentReturn): Promise<void>;
}

export abstract class AdjustmentRepository {
  abstract findForUpdate(id: string): Promise<DepartmentAdjustment | null>;
  abstract insert(adjustment: DepartmentAdjustment): Promise<void>;
  abstract update(adjustment: DepartmentAdjustment): Promise<void>;
}

export abstract class SupplierReturnRepository {
  abstract findForUpdate(id: string): Promise<SupplierReturn | null>;
  abstract insert(supplierReturn: SupplierReturn): Promise<void>;
  abstract update(supplierReturn: SupplierReturn): Promise<void>;
  abstract delete(id: string): Promise<void>;
}

export interface NewGatePass {
  readonly id: string;
  readonly number: string;
  readonly passDate: string;
  readonly kind: 'supplier_return' | 'maintenance' | 'other';
  readonly reference: string | null;
  readonly partyName: string;
  readonly note: string | null;
}

export abstract class GatePassRepository {
  abstract insert(pass: NewGatePass): Promise<void>;
}
