import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { WardIndentStatus } from '../domain/ward.js';

/** Raising and cancelling ward indents for admitted patients, and seeing the ward's medicine. */
export const PHARMACY_WARD = 'pharmacy:ward';

/** Charged to admitted patients' stays until the final bill takes it (Dr here, Cr there). */
export const IPD_MEDICINE_ROLE = 'ipd_medicine_unbilled';

/** The admission a ward document is for, as the hospital tells it. */
export interface AdmissionRef {
  readonly admissionNumber: string | null;
  readonly patientName: string | null;
  readonly uhid: number | null;
}

export interface WardIndentFilter extends PageRequest {
  readonly outletId?: string | undefined;
  readonly admissionId?: string | undefined;
  readonly status?: WardIndentStatus | undefined;
}

export interface WardIndentSummary {
  readonly id: string;
  readonly number: string;
  readonly outletId: string;
  readonly outletName: string;
  readonly admissionId: string;
  readonly requestedOn: string;
  readonly status: WardIndentStatus;
  readonly lineCount: number;
  readonly version: number;
}

export interface WardIndentView extends WardIndentSummary {
  readonly note: string | null;
  readonly cancelReason: string | null;
  readonly issueId: string | null;
  readonly lines: { readonly productId: string; readonly productName: string; readonly qty: number }[];
}

export interface WardIssueFilter extends PageRequest {
  readonly outletId?: string | undefined;
  readonly admissionId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface WardIssueSummary {
  readonly id: string;
  readonly number: string;
  readonly outletId: string;
  readonly outletName: string;
  readonly admissionId: string;
  readonly indentId: string | null;
  readonly issuedOn: string;
  readonly amount: number;
  readonly discount: number;
  readonly total: number;
  readonly returned: number;
  readonly charged: number;
  readonly version: number;
}

export interface WardIssueView extends WardIssueSummary {
  readonly voucherNumber: string | null;
  readonly lines: {
    readonly line: number;
    readonly productId: string;
    readonly productName: string;
    readonly lotId: string;
    readonly batchNo: string | null;
    readonly expiryDate: string;
    readonly qty: number;
    readonly saleRate: number;
    readonly discountPercent: number;
    readonly total: number;
    readonly returnedQty: number;
  }[];
  readonly returns: {
    readonly id: string;
    readonly number: string;
    readonly returnedOn: string;
    readonly reason: string | null;
    readonly total: number;
  }[];
}

/** Every unit sent to and back from the wards for one admission, line by line (the ward medicine statement). */
export interface WardMedicineLine {
  readonly on: string;
  readonly number: string;
  readonly kind: 'issue' | 'return';
  readonly outletName: string;
  readonly productName: string;
  readonly qty: number;
  readonly saleRate: number;
  readonly total: number;
}

export abstract class WardReadRepository {
  abstract indents(filter: WardIndentFilter): Promise<Page<WardIndentSummary>>;
  abstract indent(id: string): Promise<WardIndentView | null>;
  abstract issues(filter: WardIssueFilter): Promise<Page<WardIssueSummary>>;
  abstract issue(id: string): Promise<WardIssueView | null>;
  abstract medicineOf(admissionId: string): Promise<WardMedicineLine[]>;
}

export interface WardIndentInput {
  readonly outletId: string;
  readonly admissionId: string;
  readonly requestedOn: string;
  readonly note: string | null;
  readonly lines: readonly { readonly productId: string; readonly qty: number }[];
}

export class RaiseWardIndentCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly input: WardIndentInput,
  ) {
    super();
  }
}

export class CancelWardIndentCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly reason: string,
  ) {
    super();
  }
}

export interface WardIssueInput {
  readonly outletId: string;
  readonly admissionId: string;
  readonly indentId: string | null;
  readonly issuedOn: string;
  readonly lines: readonly { readonly productId: string; readonly qty: number; readonly lotId: string | null }[];
}

export class IssueToWardCommand extends Command<{ id: string; number: string; total: number }> {
  constructor(
    readonly actor: Actor,
    readonly input: WardIssueInput,
  ) {
    super();
  }
}

export class ReturnFromWardCommand extends Command<{ id: string; number: string; total: number; charged: number }> {
  constructor(
    readonly actor: Actor,
    readonly issueId: string,
    readonly version: number,
    readonly returnedOn: string,
    readonly lines: readonly { readonly line: number; readonly qty: number }[],
    readonly reason: string | null,
  ) {
    super();
  }
}

export class ListWardIndentsQuery extends Query<Page<WardIndentSummary & AdmissionRef>> {
  constructor(
    readonly actor: Actor,
    readonly filter: WardIndentFilter,
  ) {
    super();
  }
}

export class GetWardIndentQuery extends Query<WardIndentView & AdmissionRef> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListWardIssuesQuery extends Query<Page<WardIssueSummary & AdmissionRef>> {
  constructor(
    readonly actor: Actor,
    readonly filter: WardIssueFilter,
  ) {
    super();
  }
}

export class GetWardIssueQuery extends Query<WardIssueView & AdmissionRef> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
