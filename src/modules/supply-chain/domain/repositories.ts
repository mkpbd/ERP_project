import type { LotBalance } from './allocation.js';
import type { AssetFlow, DiscardRequest, ScrapSale, ServiceRequest } from './asset-requests.js';
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
  | 'opening'
  | 'receive'
  | 'issue'
  | 'transfer'
  | 'consumption'
  | 'department_return'
  | 'adjustment'
  | 'supplier_return'
  | 'discard'
  | 'service_out'
  | 'service_return';

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
  /** Every piece is registered as a fixed asset. */
  readonly isAsset?: boolean;
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

/** Asset numbers are one series for all years (old FA-{SerialNo:D6}). */
export const assetNumber = (serial: number) => `FA-${String(serial).padStart(6, '0')}`;

export interface NewAsset {
  readonly id: string;
  readonly assetNo: string;
  readonly variantId: string;
  readonly lotId: string;
  readonly sourceDocumentId: string;
  readonly sourceNumber: string;
  readonly supplierId: string | null;
  readonly cost: number;
  readonly acquiredOn: string;
  readonly place: StockPlace;
}

/** Old FixedAssetItems and RelocateFixedAssetPiecesCommand: pieces follow the stock that moves. */
export abstract class AssetRegister {
  abstract add(assets: readonly NewAsset[]): Promise<void>;
  /** Moves up to `count` pieces of the variant and lot in stock at `from` to `to`, oldest number first. */
  abstract relocate(variantId: string, lotId: string, count: number, from: StockPlace, to: StockPlace): Promise<number>;
  /** Up to `count` pieces at `from` leave the register's stock with the status (e.g. returned to the supplier). */
  abstract release(
    variantId: string,
    lotId: string,
    count: number,
    from: StockPlace,
    status: 'returned',
  ): Promise<number>;
}

export type DepreciationFrequency = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

export interface DepreciationRecord {
  readonly assetId: string;
  readonly frequency: DepreciationFrequency;
  readonly lifeMonths: number;
  readonly cost: number;
  readonly residual: number;
  readonly startDate: string;
  readonly openingAccumulated: number;
  readonly periodsDone: number;
  readonly accumulated: number;
  readonly lastPeriodEnd: string | null;
  readonly status: 'active' | 'fully_depreciated' | 'suspended' | 'disposed';
}

export interface DepreciableAsset {
  readonly id: string;
  readonly assetNo: string;
  readonly cost: number;
  readonly acquiredOn: string;
  readonly status: string;
  readonly departmentId: string | null;
  /** Whether depreciation was already posted for it (then it is revised, not configured again). */
  readonly charged: boolean;
}

export interface RunEntry {
  readonly assetId: string;
  readonly periodIndex: number;
  readonly periodEnd: string;
  readonly amount: number;
  readonly departmentId: string | null;
}

export interface RunRecord {
  readonly id: string;
  readonly number: string;
  readonly asOf: string;
  readonly kind?: 'periodic' | 'disposal';
  readonly status: 'posted' | 'reversed';
  readonly assetCount: number;
  readonly total: number;
  readonly voucherId: string | null;
  readonly voucherNumber: string | null;
}

export abstract class DepreciationRepository {
  /** Throws NotFoundError when an asset does not exist. */
  abstract assets(ids: readonly string[]): Promise<DepreciableAsset[]>;
  abstract save(records: readonly DepreciationRecord[], by: string): Promise<void>;
  /** Active profiles (locked) whose next period ends on or before `asOf`, with where the piece is. */
  abstract due(asOf: string): Promise<(DepreciationRecord & { departmentId: string | null })[]>;
  abstract insertRun(run: RunRecord & { postedBy: string }, entries: readonly RunEntry[]): Promise<void>;
  /** The most recent periodic run that is still posted, locked. */
  abstract latestPosted(): Promise<RunRecord | null>;
  abstract entries(runId: string): Promise<RunEntry[]>;
  abstract profiles(assetIds: readonly string[]): Promise<DepreciationRecord[]>;
  /** Removes the run's entries and marks it reversed. */
  abstract markReversed(
    runId: string,
    reversal: { by: string; at: Date; reason: string; voucher: { id: string; number: string } | null },
  ): Promise<void>;
}

export interface RequestPiece {
  readonly id: string;
  readonly assetNo: string;
  readonly status: string;
  readonly variantId: string;
  readonly lotId: string;
  readonly cost: number;
  readonly place: StockPlace | null;
  /** The item type's inventory account (else the store_inventory role). */
  readonly inventoryGlAccountId: string | null;
}

/** Old AssetRequestLocks and the asset request documents. */
export abstract class AssetRequestRepository {
  abstract levels(flow: AssetFlow): Promise<PurchaseApprovalLevel[]>;
  /** The pieces, locked; NotFoundError when one does not exist. */
  abstract pieces(ids: readonly string[]): Promise<RequestPiece[]>;
  /** ConflictError asset_busy when a piece is already on an open request. */
  abstract lock(ids: readonly string[], kind: 'service' | 'discard', requestId: string): Promise<void>;
  abstract unlock(ids: readonly string[]): Promise<void>;
  abstract setStatus(ids: readonly string[], status: 'in_stock' | 'out_for_service'): Promise<void>;
  /** Written off: out of the register's stock. */
  abstract discard(ids: readonly string[]): Promise<void>;
  abstract markSold(ids: readonly string[]): Promise<void>;

  abstract findService(id: string): Promise<ServiceRequest | null>;
  abstract saveService(request: ServiceRequest, isNew: boolean): Promise<void>;
  abstract findDiscard(id: string): Promise<DiscardRequest | null>;
  abstract saveDiscard(request: DiscardRequest, isNew: boolean): Promise<void>;
  abstract recordDisposal(
    requestId: string,
    values: { runId: string | null; voucherNumber: string | null; bookValues: ReadonlyMap<string, number> },
  ): Promise<void>;
  abstract recordSale(requestId: string, voucherNumber: string | null): Promise<void>;
  abstract findScrap(id: string): Promise<ScrapSale | null>;
  abstract saveScrap(sale: ScrapSale, isNew: boolean, voucherNumber?: string | null): Promise<void>;
}
