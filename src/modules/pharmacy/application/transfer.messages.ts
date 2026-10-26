import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { IndentStatus } from '../domain/outlet-indent.js';
import type { TransferStatus } from '../domain/transfer.js';
import type { ProductRef } from './purchase.messages.js';

export interface IndentFilter extends PageRequest {
  readonly requestingOutletId?: string | undefined;
  readonly supplyingOutletId?: string | undefined;
  readonly status?: string | undefined;
}

export interface IndentSummary {
  readonly id: string;
  readonly number: string;
  readonly indentDate: string;
  readonly requestingOutletId: string;
  readonly requestingOutletName: string;
  readonly supplyingOutletId: string;
  readonly supplyingOutletName: string;
  readonly urgent: boolean;
  readonly status: IndentStatus;
  readonly version: number;
}

export interface IndentView extends IndentSummary {
  readonly note: string | null;
  readonly closeReason: string | null;
  readonly lines: (ProductRef & {
    readonly qty: number;
    readonly transferredQty: number;
    /** What the supplying outlet holds now (unexpired). */
    readonly available: number;
  })[];
}

export interface TransferFilter extends PageRequest {
  readonly fromOutletId?: string | undefined;
  readonly toOutletId?: string | undefined;
  readonly status?: string | undefined;
}

export interface TransferSummary {
  readonly id: string;
  readonly number: string;
  readonly transferDate: string;
  readonly indentId: string | null;
  readonly indentNumber: string | null;
  readonly fromOutletId: string;
  readonly fromOutletName: string;
  readonly toOutletId: string;
  readonly toOutletName: string;
  readonly status: TransferStatus;
  readonly value: number;
  readonly version: number;
}

export interface TransferView extends TransferSummary {
  readonly note: string | null;
  readonly decidedOn: string | null;
  readonly rejectReason: string | null;
  readonly lines: (ProductRef & {
    readonly lotId: string;
    readonly batchNo: string | null;
    readonly expiryDate: string;
    readonly qty: number;
    readonly unitCost: number;
    readonly value: number;
  })[];
}

export abstract class TransferReadRepository {
  abstract listIndents(filter: IndentFilter): Promise<Page<IndentSummary>>;
  abstract getIndent(id: string, today: string): Promise<IndentView | null>;
  abstract listTransfers(filter: TransferFilter): Promise<Page<TransferSummary>>;
  abstract getTransfer(id: string): Promise<TransferView | null>;
}

type IndentLineInput = { productId: string; qty: number };

export class RaiseIndentCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly requestingOutletId: string,
    readonly supplyingOutletId: string,
    readonly indentDate: string,
    readonly urgent: boolean,
    readonly note: string | null,
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
    readonly changes: { urgent?: boolean; note?: string | null; lines?: readonly IndentLineInput[] },
  ) {
    super();
  }
}

export class EndIndentCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly action: 'cancel' | 'close',
    readonly reason: string,
  ) {
    super();
  }
}

export class SendTransferCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly fromOutletId: string,
    readonly toOutletId: string,
    readonly indentId: string | null,
    readonly transferDate: string,
    readonly note: string | null,
    readonly lines: readonly { productId: string; qty: number; lotId: string | null }[],
  ) {
    super();
  }
}

export class DecideTransferCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly decision: 'accept' | 'reject',
    readonly on: string,
    readonly reason: string | null,
  ) {
    super();
  }
}

export class ListIndentsQuery extends Query<Page<IndentSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: IndentFilter,
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

export class ListTransfersQuery extends Query<Page<TransferSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: TransferFilter,
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
