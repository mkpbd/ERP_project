import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { QuoteInput, StudyHeader, StudyStatus } from '../domain/comparative-study.js';
import type { Decision } from '../domain/documents.js';
import type { OrderHeader, OrderLineInput, OrderStatus } from '../domain/purchase-order.js';
import type { PaymentTerm, RequisitionHeader, RequisitionStatus } from '../domain/requisition.js';

export interface ItemRef {
  readonly variantId: string;
  readonly variantName: string;
  readonly code: string | null;
  readonly itemName: string;
  readonly unit: string;
}

export type DecisionView = Decision;

export interface RequisitionSummary {
  readonly id: string;
  readonly number: string;
  readonly requisitionDate: string;
  readonly mainStoreId: string;
  readonly mainStoreName: string;
  readonly departmentName: string | null;
  readonly supplierName: string | null;
  readonly paymentTerm: PaymentTerm | null;
  readonly status: RequisitionStatus;
  readonly currentLevel: number | null;
  readonly currentLevelName: string | null;
  readonly lineCount: number;
  readonly version: number;
}

export interface RequisitionLineView extends ItemRef {
  readonly requestedQty: number;
  readonly approvedQty: number | null;
  /** On orders that are not cancelled. */
  readonly orderedQty: number;
  readonly description: string | null;
}

export interface RequisitionView extends RequisitionSummary {
  readonly subStoreId: string | null;
  readonly subStoreName: string | null;
  readonly departmentId: string | null;
  readonly supplierId: string | null;
  readonly note: string | null;
  readonly terms: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly lines: RequisitionLineView[];
  readonly decisions: DecisionView[];
}

export interface DocumentFilter extends PageRequest {
  readonly status?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  /** Number, partial. */
  readonly q?: string | undefined;
  readonly mainStoreId?: string | undefined;
  readonly supplierId?: string | undefined;
  readonly requisitionId?: string | undefined;
}

export interface StudySummary {
  readonly id: string;
  readonly number: string;
  readonly studyDate: string;
  readonly title: string;
  readonly requisitionId: string | null;
  readonly requisitionNumber: string | null;
  readonly status: StudyStatus;
  readonly currentLevel: number | null;
  readonly currentLevelName: string | null;
  readonly quoteCount: number;
  readonly version: number;
}

export interface QuoteView {
  readonly id: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly variantId: string | null;
  readonly itemName: string;
  readonly unit: string | null;
  readonly manualName: string | null;
  readonly qty: number;
  readonly unitPrice: number;
  readonly vatPercent: number;
  readonly aitPercent: number;
  readonly vat: number;
  readonly ait: number;
  readonly total: number;
  readonly selected: boolean;
}

export interface StudyView extends StudySummary {
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly quotes: QuoteView[];
  readonly decisions: DecisionView[];
}

export interface OrderSummary {
  readonly id: string;
  readonly number: string;
  readonly orderDate: string;
  readonly expectedOn: string | null;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly mainStoreId: string;
  readonly mainStoreName: string;
  readonly requisitionId: string | null;
  readonly requisitionNumber: string | null;
  readonly comparativeStudyId: string | null;
  readonly comparativeStudyNumber: string | null;
  readonly status: OrderStatus;
  readonly amount: number;
  readonly vat: number;
  readonly total: number;
  readonly version: number;
}

export interface OrderLineView extends ItemRef {
  readonly qty: number;
  readonly rate: number;
  readonly vatPercent: number;
  readonly amount: number;
  readonly vat: number;
  readonly total: number;
  readonly receivedQty: number;
}

export interface OrderView extends OrderSummary {
  readonly supplierAddress: string | null;
  readonly supplierContactNo: string | null;
  readonly terms: string | null;
  readonly note: string | null;
  readonly cancelReason: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly lines: OrderLineView[];
}

export abstract class PurchaseReadRepository {
  abstract listRequisitions(filter: DocumentFilter): Promise<Page<RequisitionSummary>>;
  abstract getRequisition(id: string): Promise<RequisitionView | null>;
  /** Pending requisitions whose current level belongs to one of the roles. */
  abstract requisitionInbox(roleIds: readonly string[]): Promise<RequisitionSummary[]>;
  abstract listStudies(filter: DocumentFilter): Promise<Page<StudySummary>>;
  abstract getStudy(id: string): Promise<StudyView | null>;
  /** Pending studies whose current level the staff member approves. */
  abstract studyInbox(staffId: string): Promise<StudySummary[]>;
  abstract listOrders(filter: DocumentFilter): Promise<Page<OrderSummary>>;
  abstract getOrder(id: string): Promise<OrderView | null>;
}

// Requisitions

export class CreateRequisitionCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly header: RequisitionHeader,
    readonly lines: readonly { variantId: string; requestedQty: number; description: string | null }[],
  ) {
    super();
  }
}

export class EditRequisitionCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly header: Partial<RequisitionHeader>,
    readonly lines: readonly { variantId: string; requestedQty: number; description: string | null }[] | undefined,
  ) {
    super();
  }
}

export type RequisitionAction = 'submit' | 'cancel' | 'delete';

export class ActOnRequisitionCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly action: RequisitionAction,
  ) {
    super();
  }
}

export class DecideRequisitionCommand extends Command<{ status: RequisitionStatus }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly decision: 'approve' | 'reject',
    readonly remarks: string | null,
    /** Variant → approved quantity (approve only). */
    readonly quantities: ReadonlyMap<string, number>,
  ) {
    super();
  }
}

export class ListRequisitionsQuery extends Query<Page<RequisitionSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: DocumentFilter,
  ) {
    super();
  }
}

export class GetRequisitionQuery extends Query<RequisitionView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class RequisitionInboxQuery extends Query<RequisitionSummary[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

// Comparative studies

export class CreateStudyCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly header: StudyHeader,
    readonly quotes: readonly QuoteInput[],
  ) {
    super();
  }
}

export class EditStudyCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly header: Partial<StudyHeader>,
    readonly quotes: readonly QuoteInput[] | undefined,
  ) {
    super();
  }
}

export class ActOnStudyCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly action: 'submit' | 'delete',
  ) {
    super();
  }
}

export class DecideStudyCommand extends Command<{ status: StudyStatus }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly decision: 'approve' | 'reject',
    readonly remarks: string | null,
    /** Ids of the quotes kept in the running (approve only). */
    readonly keep: readonly string[],
  ) {
    super();
  }
}

export class ListStudiesQuery extends Query<Page<StudySummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: DocumentFilter,
  ) {
    super();
  }
}

export class GetStudyQuery extends Query<StudyView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class StudyInboxQuery extends Query<StudySummary[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

// Purchase orders

export class CreateOrderCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly header: OrderHeader,
    readonly lines: readonly OrderLineInput[],
  ) {
    super();
  }
}

export class EditOrderCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly header: Partial<Pick<OrderHeader, 'orderDate' | 'expectedOn' | 'terms' | 'note'>>,
    readonly lines: readonly OrderLineInput[] | undefined,
  ) {
    super();
  }
}

export class CancelOrderCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export class ListOrdersQuery extends Query<Page<OrderSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: DocumentFilter,
  ) {
    super();
  }
}

export class GetOrderQuery extends Query<OrderView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
