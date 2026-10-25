import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { LedgerPosting, type LedgerPostingRequest } from '../../../shared/application/contracts/ledger-posting.js';
import type { Page } from '../../../shared/application/pagination.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { safeFileName, validDocument, type StoredFile } from '../../../shared/domain/uploads.js';
import { LedgerFacts, VoucherRepository, type StoredAttachment } from '../domain/repositories.js';
import { Voucher, voucherNumber, voucherTotal, type VoucherLine, type VoucherSource } from '../domain/voucher.js';
import { ACCOUNTS_READ, VOUCHERS_POST, VOUCHERS_WRITE } from './accounts.constants.js';
import {
  AddVoucherAttachmentCommand,
  CreateVoucherCommand,
  DeleteVoucherCommand,
  EditVoucherCommand,
  GetVoucherAttachmentQuery,
  GetVoucherQuery,
  ListVouchersQuery,
  PostVoucherCommand,
  RemoveVoucherAttachmentCommand,
  ReverseVoucherCommand,
  VoucherReadRepository,
  type VoucherSummary,
  type VoucherView,
} from './voucher.messages.js';

/** Shared steps: checking accounts, numbering, posting and auditing inside one transaction. */
@Injectable()
export class VoucherBook {
  constructor(
    readonly vouchers: VoucherRepository,
    readonly facts: LedgerFacts,
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    readonly clock: Clock,
  ) {}

  accountsOf(lines: readonly VoucherLine[]) {
    return this.facts.accounts([...new Set(lines.map((line) => line.glAccountId))]);
  }

  async load(id: string, version: number): Promise<Voucher> {
    const voucher = await this.vouchers.findForUpdate(id);
    if (!voucher) throw new NotFoundError('voucher');
    voucher.assertVersion(version);
    return voucher;
  }

  /** Numbers and posts a draft in the open fiscal year its date falls in. */
  async post(voucher: Voucher, by: string | null, now: Date): Promise<string> {
    const [fiscalYear, journal] = await Promise.all([
      this.facts.fiscalYearOn(voucher.voucherDate),
      this.facts.journalType(voucher.journalTypeId),
    ]);
    if (!fiscalYear) {
      throw new DomainError('no_fiscal_year', `No fiscal year covers ${voucher.voucherDate}; set one up first`);
    }
    if (fiscalYear.isClosed) throw new DomainError('fiscal_year_closed', `Fiscal year ${fiscalYear.label} is closed`);
    if (!journal) throw new NotFoundError('journal_type');
    const serial = await this.vouchers.nextSerial(journal.id, fiscalYear.id);
    const number = voucherNumber(journal.shortName, fiscalYear.label, serial);
    voucher.post({ number, fiscalYearId: fiscalYear.id, accounts: await this.accountsOf(voucher.lines), by, now });
    return number;
  }

  record(
    action: string,
    actorUserId: string | null,
    voucherId: string,
    metadata: Record<string, string | number | null>,
  ) {
    return this.audit.record({
      action: `voucher.${action}`,
      actorUserId,
      resourceType: 'voucher',
      resourceId: voucherId,
      metadata,
    });
  }
}

@CommandHandler(CreateVoucherCommand)
export class CreateVoucherHandler implements ICommandHandler<CreateVoucherCommand> {
  constructor(private readonly book: VoucherBook) {}

  async execute({ actor, header, lines, post }: CreateVoucherCommand): Promise<{ id: string; number: string | null }> {
    await this.book.access.authorize(actor.userId, { permissions: [post ? VOUCHERS_POST : VOUCHERS_WRITE] });
    return this.book.tx.run(async () => {
      const now = this.book.clock.now();
      const voucher = Voucher.draft({
        id: randomUUID(),
        header,
        lines,
        accounts: await this.book.accountsOf(lines),
        source: null,
        createdBy: actor.userId,
        now,
      });
      const number = post ? await this.book.post(voucher, actor.userId, now) : null;
      await this.book.vouchers.insert(voucher);
      await this.book.record(post ? 'posted' : 'drafted', actor.userId, voucher.id, {
        number,
        total: voucherTotal(voucher.lines),
      });
      return { id: voucher.id, number };
    });
  }
}

@CommandHandler(EditVoucherCommand)
export class EditVoucherHandler implements ICommandHandler<EditVoucherCommand> {
  constructor(private readonly book: VoucherBook) {}

  async execute({ actor, id, version, header, lines }: EditVoucherCommand): Promise<void> {
    await this.book.access.authorize(actor.userId, { permissions: [VOUCHERS_WRITE] });
    await this.book.tx.run(async () => {
      const voucher = await this.book.load(id, version);
      voucher.edit(
        { header, ...(lines ? { lines } : {}) },
        await this.book.accountsOf(lines ?? voucher.lines),
        this.book.clock.now(),
      );
      await this.book.vouchers.update(voucher);
      await this.book.record('edited', actor.userId, id, { total: voucherTotal(voucher.lines) });
    });
  }
}

@CommandHandler(PostVoucherCommand)
export class PostVoucherHandler implements ICommandHandler<PostVoucherCommand> {
  constructor(private readonly book: VoucherBook) {}

  async execute({ actor, id, version }: PostVoucherCommand): Promise<{ number: string }> {
    await this.book.access.authorize(actor.userId, { permissions: [VOUCHERS_POST] });
    return this.book.tx.run(async () => {
      const voucher = await this.book.load(id, version);
      const number = await this.book.post(voucher, actor.userId, this.book.clock.now());
      await this.book.vouchers.update(voucher);
      await this.book.record('posted', actor.userId, id, { number, total: voucherTotal(voucher.lines) });
      return { number };
    });
  }
}

@CommandHandler(DeleteVoucherCommand)
export class DeleteVoucherHandler implements ICommandHandler<DeleteVoucherCommand> {
  constructor(private readonly book: VoucherBook) {}

  async execute({ actor, id, version }: DeleteVoucherCommand): Promise<void> {
    await this.book.access.authorize(actor.userId, { permissions: [VOUCHERS_WRITE] });
    await this.book.tx.run(async () => {
      const voucher = await this.book.load(id, version);
      voucher.assertDeletable();
      await this.book.vouchers.delete(id);
      await this.book.record('deleted', actor.userId, id, { total: voucherTotal(voucher.lines) });
    });
  }
}

@CommandHandler(ReverseVoucherCommand)
export class ReverseVoucherHandler implements ICommandHandler<ReverseVoucherCommand> {
  constructor(private readonly book: VoucherBook) {}

  async execute({ actor, id, version, voucherDate, narration }: ReverseVoucherCommand) {
    await this.book.access.authorize(actor.userId, { permissions: [VOUCHERS_POST] });
    return this.book.tx.run(async () => {
      const original = await this.book.load(id, version);
      const now = this.book.clock.now();
      const reversal = original.reversal({
        id: randomUUID(),
        voucherDate,
        narration: narration ?? `Reversal of ${original.toSnapshot().number}`,
        by: actor.userId,
        now,
      });
      const number = await this.book.post(reversal, actor.userId, now);
      await this.book.vouchers.update(original);
      await this.book.vouchers.insert(reversal);
      await this.book.record('reversed', actor.userId, id, { reversalId: reversal.id, number });
      return { id: reversal.id, number };
    });
  }
}

@CommandHandler(AddVoucherAttachmentCommand)
export class AddVoucherAttachmentHandler implements ICommandHandler<AddVoucherAttachmentCommand> {
  constructor(private readonly book: VoucherBook) {}

  async execute({ actor, voucherId, fileName, contentType, data }: AddVoucherAttachmentCommand) {
    await this.book.access.authorize(actor.userId, { permissions: [VOUCHERS_WRITE] });
    const file: StoredFile = validDocument(contentType, data);
    const name = safeFileName(fileName);
    return this.book.tx.run(async () => {
      if (!(await this.book.vouchers.findForUpdate(voucherId))) throw new NotFoundError('voucher');
      const id = randomUUID();
      await this.book.vouchers.addAttachment({
        id,
        voucherId,
        fileName: name,
        contentType: file.contentType,
        data: file.data,
        uploadedBy: actor.userId,
        now: this.book.clock.now(),
      });
      await this.book.record('attachment_added', actor.userId, voucherId, { attachmentId: id });
      return { id };
    });
  }
}

@CommandHandler(RemoveVoucherAttachmentCommand)
export class RemoveVoucherAttachmentHandler implements ICommandHandler<RemoveVoucherAttachmentCommand> {
  constructor(private readonly book: VoucherBook) {}

  async execute({ actor, voucherId, attachmentId }: RemoveVoucherAttachmentCommand): Promise<void> {
    await this.book.access.authorize(actor.userId, { permissions: [VOUCHERS_WRITE] });
    await this.book.tx.run(async () => {
      if (!(await this.book.vouchers.removeAttachment(voucherId, attachmentId))) {
        throw new NotFoundError('voucher_attachment');
      }
      await this.book.record('attachment_removed', actor.userId, voucherId, { attachmentId });
    });
  }
}

@QueryHandler(ListVouchersQuery)
export class ListVouchersHandler implements IQueryHandler<ListVouchersQuery> {
  constructor(
    private readonly read: VoucherReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListVouchersQuery): Promise<Page<VoucherSummary>> {
    await this.access.authorize(actor.userId, { permissions: [ACCOUNTS_READ] });
    return this.read.list(filter);
  }
}

@QueryHandler(GetVoucherQuery)
export class GetVoucherHandler implements IQueryHandler<GetVoucherQuery> {
  constructor(
    private readonly read: VoucherReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, id }: GetVoucherQuery): Promise<VoucherView> {
    await this.access.authorize(actor.userId, { permissions: [ACCOUNTS_READ] });
    const voucher = await this.read.get(id);
    if (!voucher) throw new NotFoundError('voucher');
    return voucher;
  }
}

@QueryHandler(GetVoucherAttachmentQuery)
export class GetVoucherAttachmentHandler implements IQueryHandler<GetVoucherAttachmentQuery> {
  constructor(private readonly book: VoucherBook) {}

  async execute({ actor, voucherId, attachmentId }: GetVoucherAttachmentQuery): Promise<StoredAttachment> {
    await this.book.access.authorize(actor.userId, { permissions: [ACCOUNTS_READ] });
    const attachment = await this.book.vouchers.findAttachment(voucherId, attachmentId);
    if (!attachment) throw new NotFoundError('voucher_attachment');
    return attachment;
  }
}

/** The LedgerPosting contract: other modules post balanced vouchers by GL code or role. */
@Injectable()
export class VoucherLedgerPosting extends LedgerPosting {
  constructor(private readonly book: VoucherBook) {
    super();
  }

  post(request: LedgerPostingRequest): Promise<{ voucherId: string; number: string }> {
    return this.book.tx.run(async () => {
      const codes = request.lines.flatMap((line) => ('code' in line.account ? [line.account.code] : []));
      const roles = request.lines.flatMap((line) => ('role' in line.account ? [line.account.role] : []));
      const [byCode, byRole, journal] = await Promise.all([
        this.book.facts.accountIdsByCode(codes),
        this.book.facts.accountIdsByRole(roles),
        this.book.facts.journalTypeByShortName(request.journal),
      ]);
      if (!journal) throw new DomainError('invalid_voucher', `Unknown journal type ${request.journal}`);
      const lines: VoucherLine[] = request.lines.map((line, index) => {
        const glAccountId = 'code' in line.account ? byCode.get(line.account.code) : byRole.get(line.account.role);
        if (!glAccountId) {
          const what = 'code' in line.account ? `account ${line.account.code}` : `GL role ${line.account.role}`;
          throw new DomainError('invalid_voucher', `Line ${index + 1}: unknown ${what}`);
        }
        return {
          glAccountId,
          debit: line.debit,
          credit: line.credit,
          narration: line.narration ?? null,
          costCenterId: line.costCenterId ?? null,
          subLedgerId: line.subLedgerId ?? null,
          chequeNo: null,
          chequeDate: null,
        };
      });
      const now = this.book.clock.now();
      const source: VoucherSource = request.source;
      const voucher = Voucher.draft({
        id: randomUUID(),
        header: {
          journalTypeId: journal.id,
          voucherDate: request.voucherDate,
          documentDate: null,
          narration: request.narration,
          paidTo: null,
          mode: null,
          serviceUnitId: null,
        },
        lines,
        accounts: await this.book.accountsOf(lines),
        source,
        createdBy: request.postedBy,
        now,
      });
      const number = await this.book.post(voucher, request.postedBy, now);
      await this.book.vouchers.insert(voucher);
      await this.book.record('posted', request.postedBy, voucher.id, {
        number,
        source: `${source.module}:${source.reference}`,
        total: voucherTotal(lines),
      });
      return { voucherId: voucher.id, number };
    });
  }
}

export const VOUCHER_HANDLERS = [
  CreateVoucherHandler,
  EditVoucherHandler,
  PostVoucherHandler,
  DeleteVoucherHandler,
  ReverseVoucherHandler,
  AddVoucherAttachmentHandler,
  RemoveVoucherAttachmentHandler,
  ListVouchersHandler,
  GetVoucherHandler,
  GetVoucherAttachmentHandler,
];
