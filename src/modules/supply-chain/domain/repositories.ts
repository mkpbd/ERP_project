import type { ComparativeStudy } from './comparative-study.js';
import type { ApprovalLevel } from './documents.js';
import type { PurchaseOrder } from './purchase-order.js';
import type { PurchaseRequisition } from './requisition.js';

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
