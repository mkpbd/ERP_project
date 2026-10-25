import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import type { MoveLine } from '../domain/store-documents.js';
import type { SettleLine } from '../domain/supplier-return.js';
import type { ItemRef } from './purchase.messages.js';
import type { MovedPart, StoreFilter } from './store.messages.js';

export type DepartmentDocumentKind = 'consumption' | 'return' | 'adjustment' | 'supplier_return' | 'gate_pass';

/** One row of a department document, supplier return or gate pass list. */
export interface DocumentSummary {
  readonly id: string;
  readonly number: string;
  readonly date: string;
  readonly status: string;
  /** Department, or supplier for a supplier return, or party for a gate pass. */
  readonly partyName: string;
  /** Sub-store for a return, main store for a supplier return. */
  readonly storeName: string | null;
  readonly version: number;
}

export interface DocumentLineView extends ItemRef {
  readonly qty: number;
  readonly lotId: string | null;
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  /** Counts: what the records showed, what was counted, and the adjustment once approved. */
  readonly systemQty?: number;
  readonly physicalQty?: number;
  readonly adjustQty?: number | null;
  /** Supplier returns: cost sent at, what came back and instead of what. */
  readonly unitCost?: number | null;
  readonly receivedQty?: number | null;
  readonly replacementName?: string | null;
}

export interface DocumentView extends DocumentSummary {
  readonly kind: DepartmentDocumentKind;
  readonly note: string | null;
  readonly fields: Readonly<Record<string, string | number | null>>;
  readonly lines: DocumentLineView[];
  /** The lots moved out by the document, at their cost. */
  readonly parts: MovedPart[];
  readonly value: number;
}

export abstract class DepartmentReadRepository {
  abstract list(
    kind: DepartmentDocumentKind,
    filter: StoreFilter & { supplierId?: string | undefined },
  ): Promise<Page<DocumentSummary>>;
  abstract get(kind: DepartmentDocumentKind, id: string): Promise<DocumentView | null>;
}

export class PostConsumptionCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly departmentId: string,
    readonly consumedOn: string,
    readonly note: string | null,
    readonly lines: readonly MoveLine[],
  ) {
    super();
  }
}

export class CancelConsumptionCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
    readonly on: string,
  ) {
    super();
  }
}

export class OpenDepartmentReturnCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly departmentId: string,
    readonly subStoreId: string,
    readonly returnDate: string,
    readonly reason: string | null,
    readonly lines: readonly MoveLine[],
  ) {
    super();
  }
}

export class DecideDepartmentReturnCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly decision: 'receive' | 'cancel',
    readonly on: string | null,
  ) {
    super();
  }
}

export class RequestAdjustmentCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly departmentId: string,
    readonly countedOn: string,
    readonly reason: string,
    readonly lines: readonly { variantId: string; lotId: string; physicalQty: number }[],
  ) {
    super();
  }
}

export class DecideAdjustmentCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly decision: 'approve' | 'reject' | 'cancel',
    readonly remarks: string | null,
  ) {
    super();
  }
}

export class DraftSupplierReturnCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly mainStoreId: string,
    readonly supplierId: string,
    readonly returnDate: string,
    readonly reason: string,
    readonly lines: readonly MoveLine[],
  ) {
    super();
  }
}

export class EditSupplierReturnCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly changes: { returnDate?: string; reason?: string; lines?: readonly MoveLine[] },
  ) {
    super();
  }
}

export class SendSupplierReturnCommand extends Command<{ gatePassNumber: string; voucherNumber: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class SettleSupplierReturnCommand extends Command<{ voucherNumber: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly on: string,
    readonly lines: readonly SettleLine[],
  ) {
    super();
  }
}

export class DeleteSupplierReturnCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class IssueGatePassCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly pass: {
      readonly passDate: string;
      readonly kind: 'maintenance' | 'other';
      readonly reference: string | null;
      readonly partyName: string;
      readonly note: string | null;
    },
  ) {
    super();
  }
}

export class ListDepartmentDocumentsQuery extends Query<Page<DocumentSummary>> {
  constructor(
    readonly actor: Actor,
    readonly kind: DepartmentDocumentKind,
    readonly filter: StoreFilter & { supplierId?: string | undefined },
  ) {
    super();
  }
}

export class GetDepartmentDocumentQuery extends Query<DocumentView> {
  constructor(
    readonly actor: Actor,
    readonly kind: DepartmentDocumentKind,
    readonly id: string,
  ) {
    super();
  }
}
