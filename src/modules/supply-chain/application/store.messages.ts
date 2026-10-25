import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import type { Decision } from '../domain/documents.js';
import type { StoreRef } from '../domain/repositories.js';
import type {
  IndentHeader,
  IndentLineInput,
  IndentPriority,
  IndentStatus,
  MoveLine,
  RequestStatus,
  TransferKind,
  TransferStatus,
} from '../domain/store-documents.js';
import type { DocumentFilter, ItemRef } from './purchase.messages.js';

export interface IndentSummary {
  readonly id: string;
  readonly number: string;
  readonly indentDate: string;
  readonly subStoreId: string;
  readonly subStoreName: string;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly priority: IndentPriority;
  readonly status: IndentStatus;
  readonly currentLevel: number | null;
  readonly currentLevelName: string | null;
  readonly lineCount: number;
  readonly version: number;
}

export interface IndentView extends IndentSummary {
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly acknowledgedBy: string | null;
  readonly acknowledgedAt: Date | null;
  readonly lines: (ItemRef & {
    readonly qty: number;
    readonly approvedQty: number | null;
    readonly servedQty: number;
    readonly remarks: string | null;
  })[];
  readonly decisions: Decision[];
}

export interface StoreFilter extends DocumentFilter {
  readonly subStoreId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly requestId?: string | undefined;
}

export interface RequestSummary {
  readonly id: string;
  readonly number: string;
  readonly requestDate: string;
  readonly subStoreId: string;
  readonly subStoreName: string;
  readonly mainStoreId: string;
  readonly mainStoreName: string;
  readonly status: RequestStatus;
  readonly purchaseRequisitionId: string | null;
  readonly purchaseRequisitionNumber: string | null;
  readonly version: number;
}

export interface RequestView extends RequestSummary {
  readonly note: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly lines: (ItemRef & { readonly qty: number; readonly servedQty: number })[];
}

/** A part of a line taken from (or put into) one lot. */
export interface MovedPart extends ItemRef {
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly qty: number;
  readonly unitCost: number;
}

export interface IssueSummary {
  readonly id: string;
  readonly number: string;
  readonly issueDate: string;
  readonly subStoreId: string;
  readonly subStoreName: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly indentId: string | null;
  readonly indentNumber: string | null;
}

export interface IssueView extends IssueSummary {
  readonly receivedByStaffId: string | null;
  readonly note: string | null;
  readonly issuedBy: string | null;
  readonly createdAt: Date;
  /** The lots taken, at their cost. */
  readonly parts: MovedPart[];
  readonly value: number;
}

export interface TransferSummary {
  readonly id: string;
  readonly number: string;
  readonly kind: TransferKind;
  readonly transferDate: string;
  readonly fromName: string;
  readonly toName: string;
  readonly fromMainStoreId: string | null;
  readonly fromSubStoreId: string | null;
  readonly toMainStoreId: string | null;
  readonly toSubStoreId: string | null;
  readonly requestId: string | null;
  readonly requestNumber: string | null;
  readonly status: TransferStatus;
  readonly version: number;
}

export interface TransferView extends TransferSummary {
  readonly note: string | null;
  readonly rejectReason: string | null;
  readonly sentBy: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly lines: (ItemRef & {
    readonly qty: number;
    readonly acceptedQty: number | null;
    readonly lotId: string | null;
  })[];
  /** The lots moved, once completed. */
  readonly parts: MovedPart[];
  readonly value: number;
}

export interface ShortfallLine extends ItemRef {
  /** Approved and not yet issued. */
  readonly open: number;
  /** In the sub-store now (expired lots left out). */
  readonly inStock: number;
  /** What the sub-store has to ask its main store for. */
  readonly shortfall: number;
}

export abstract class StoreReadRepository {
  abstract listIndents(filter: StoreFilter): Promise<Page<IndentSummary>>;
  abstract getIndent(id: string): Promise<IndentView | null>;
  abstract indentInbox(roleIds: readonly string[]): Promise<IndentSummary[]>;
  abstract listRequests(filter: StoreFilter): Promise<Page<RequestSummary>>;
  abstract getRequest(id: string): Promise<RequestView | null>;
  abstract listIssues(filter: StoreFilter): Promise<Page<IssueSummary>>;
  abstract getIssue(id: string): Promise<IssueView | null>;
  abstract listTransfers(filter: StoreFilter & { kind?: TransferKind | undefined }): Promise<Page<TransferSummary>>;
  abstract getTransfer(id: string): Promise<TransferView | null>;
  abstract items(variantIds: readonly string[]): Promise<Map<string, ItemRef>>;
}

// Indents

export class CreateIndentCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly header: IndentHeader,
    readonly lines: readonly IndentLineInput[],
  ) {
    super();
  }
}

export class EditIndentCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly header: Partial<IndentHeader>,
    readonly lines: readonly IndentLineInput[] | undefined,
  ) {
    super();
  }
}

export type IndentAction = 'submit' | 'cancel' | 'delete' | 'acknowledge';

export class ActOnIndentCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly action: IndentAction,
  ) {
    super();
  }
}

export class DecideIndentCommand extends Command<{ status: IndentStatus }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly decision: 'approve' | 'reject',
    readonly remarks: string | null,
    readonly quantities: ReadonlyMap<string, number>,
  ) {
    super();
  }
}

export class ListIndentsQuery extends Query<Page<IndentSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: StoreFilter,
  ) {
    super();
  }
}

export class GetIndentQuery extends Query<IndentView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class IndentInboxQuery extends Query<IndentSummary[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class IndentShortfallQuery extends Query<ShortfallLine[]> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly on: string,
  ) {
    super();
  }
}

// Store requests

export class CreateRequestCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly subStoreId: string,
    readonly requestDate: string,
    readonly note: string | null,
    readonly lines: readonly { variantId: string; qty: number }[],
  ) {
    super();
  }
}

export class CloseRequestCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class RaisePurchaseCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly requisitionDate: string,
  ) {
    super();
  }
}

export class ListRequestsQuery extends Query<Page<RequestSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: StoreFilter,
  ) {
    super();
  }
}

export class GetRequestQuery extends Query<RequestView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

// Issues

export class CreateIssueCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly issue: {
      readonly subStoreId: string;
      readonly departmentId: string;
      readonly indentId: string | null;
      readonly issueDate: string;
      readonly receivedByStaffId: string | null;
      readonly note: string | null;
      readonly lines: readonly MoveLine[];
    },
  ) {
    super();
  }
}

export class ListIssuesQuery extends Query<Page<IssueSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: StoreFilter,
  ) {
    super();
  }
}

export class GetIssueQuery extends Query<IssueView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

// Transfers

export class CreateTransferCommand extends Command<{ id: string; number: string; status: TransferStatus }> {
  constructor(
    readonly actor: Actor,
    readonly transfer: {
      readonly from: StoreRef;
      readonly to: StoreRef;
      readonly requestId: string | null;
      readonly transferDate: string;
      readonly note: string | null;
      readonly lines: readonly MoveLine[];
    },
  ) {
    super();
  }
}

export class DecideTransferCommand extends Command<{ status: TransferStatus }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly decision: 'accept' | 'reject',
    readonly reason: string | null,
    /** Line position → accepted quantity (accept only; lines left out are accepted in full). */
    readonly accepted: ReadonlyMap<number, number>,
    readonly on: string | null,
  ) {
    super();
  }
}

export class ListTransfersQuery extends Query<Page<TransferSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: StoreFilter & { kind?: TransferKind | undefined },
  ) {
    super();
  }
}

export class GetTransferQuery extends Query<TransferView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
