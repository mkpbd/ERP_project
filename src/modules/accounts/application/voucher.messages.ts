import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { StoredAttachment, VoucherAttachmentInfo } from '../domain/repositories.js';
import type { VoucherHeader, VoucherLine, VoucherStatus } from '../domain/voucher.js';

export interface VoucherLineView extends VoucherLine {
  readonly glCode: string;
  readonly glName: string;
}

export interface VoucherView extends VoucherHeader {
  readonly id: string;
  readonly number: string | null;
  readonly journalShortName: string;
  readonly fiscalYearLabel: string | null;
  readonly status: VoucherStatus;
  readonly sourceModule: string | null;
  readonly sourceReference: string | null;
  readonly reversalOfId: string | null;
  readonly reversedById: string | null;
  readonly total: number;
  readonly createdBy: string | null;
  readonly postedBy: string | null;
  readonly postedAt: Date | null;
  readonly version: number;
  readonly lines: VoucherLineView[];
  readonly attachments: VoucherAttachmentInfo[];
}

export type VoucherSummary = Omit<VoucherView, 'lines' | 'attachments'>;

export interface VoucherFilter extends PageRequest {
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly journalTypeId?: string | undefined;
  readonly status?: VoucherStatus | undefined;
  readonly glAccountId?: string | undefined;
  /** Voucher number, narration or paid-to, partial. */
  readonly q?: string | undefined;
  readonly sourceModule?: string | undefined;
  readonly sourceReference?: string | undefined;
}

export abstract class VoucherReadRepository {
  abstract list(filter: VoucherFilter): Promise<Page<VoucherSummary>>;
  abstract get(id: string): Promise<VoucherView | null>;
}

export class CreateVoucherCommand extends Command<{ id: string; number: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly header: VoucherHeader,
    readonly lines: readonly VoucherLine[],
    readonly post: boolean,
  ) {
    super();
  }
}

export class EditVoucherCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly header: Partial<VoucherHeader>,
    readonly lines: readonly VoucherLine[] | undefined,
  ) {
    super();
  }
}

export class PostVoucherCommand extends Command<{ number: string }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

export class DeleteVoucherCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
  ) {
    super();
  }
}

/** Posts a voucher with debits and credits swapped and marks the original reversed. */
export class ReverseVoucherCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly voucherDate: string,
    readonly narration: string | null,
  ) {
    super();
  }
}

export class AddVoucherAttachmentCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly voucherId: string,
    readonly fileName: string,
    readonly contentType: string,
    readonly data: Uint8Array,
  ) {
    super();
  }
}

export class RemoveVoucherAttachmentCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly voucherId: string,
    readonly attachmentId: string,
  ) {
    super();
  }
}

export class ListVouchersQuery extends Query<Page<VoucherSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: VoucherFilter,
  ) {
    super();
  }
}

export class GetVoucherQuery extends Query<VoucherView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class GetVoucherAttachmentQuery extends Query<StoredAttachment> {
  constructor(
    readonly actor: Actor,
    readonly voucherId: string,
    readonly attachmentId: string,
  ) {
    super();
  }
}
