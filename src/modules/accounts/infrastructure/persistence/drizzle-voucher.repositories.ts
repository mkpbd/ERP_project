import { Injectable } from '@nestjs/common';
import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { escapeLike, foreignKeyViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  VoucherReadRepository,
  type VoucherFilter,
  type VoucherSummary,
  type VoucherView,
} from '../../application/voucher.messages.js';
import {
  LedgerFacts,
  VoucherRepository,
  type FiscalYearInfo,
  type JournalInfo,
  type StoredAttachment,
  type VoucherAttachmentInfo,
} from '../../domain/repositories.js';
import { Voucher, voucherTotal, type PostableAccount, type VoucherProps } from '../../domain/voucher.js';
import {
  accountCategories,
  accountLevel4Heads,
  accountLevel5Heads,
  accountNatures,
  accountSubCategories,
  fiscalYears,
  glAccounts,
  glRoles,
  journalTypes,
  voucherAttachments,
  voucherLines,
  vouchers,
  voucherSequences,
} from './accounts.schema.js';

const REFERENCES: Record<string, string> = {
  vouchers_journal_type_id_journal_types_id_fk: 'journal_type',
  vouchers_service_unit_id_service_units_id_fk: 'service_unit',
  voucher_lines_gl_account_id_gl_accounts_id_fk: 'gl_account',
  voucher_lines_cost_center_id_cost_centers_id_fk: 'cost_center',
  voucher_lines_sub_ledger_id_sub_ledgers_id_fk: 'sub_ledger',
};

function rethrow(error: unknown): never {
  const reference = foreignKeyViolationConstraint(error);
  if (reference !== null) throw new NotFoundError(REFERENCES[reference] ?? 'referenced_record');
  throw error;
}

function rowOf(voucher: Voucher) {
  const { lines: _lines, source, ...props } = voucher.toSnapshot();
  return {
    ...props,
    sourceModule: source?.module ?? null,
    sourceReference: source?.reference ?? null,
    total: voucherTotal(voucher.lines),
  };
}

@Injectable()
export class DrizzleVoucherRepository extends VoucherRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<Voucher | null> {
    const [row] = await this.context.db.select().from(vouchers).where(eq(vouchers.id, id)).for('update');
    if (!row) return null;
    const lines = await this.context.db
      .select()
      .from(voucherLines)
      .where(eq(voucherLines.voucherId, id))
      .orderBy(asc(voucherLines.position));
    const { sourceModule, sourceReference, total: _total, ...props } = row;
    return Voucher.restore({
      ...props,
      source: sourceModule && sourceReference ? { module: sourceModule, reference: sourceReference } : null,
      lines: lines.map(({ voucherId: _voucher, position: _position, ...line }) => line),
    } satisfies VoucherProps);
  }

  private async insertLines(voucher: Voucher): Promise<void> {
    await this.context.db
      .insert(voucherLines)
      .values(voucher.lines.map((line, position) => ({ ...line, voucherId: voucher.id, position })))
      .catch(rethrow);
  }

  async insert(voucher: Voucher): Promise<void> {
    await this.context.db.insert(vouchers).values(rowOf(voucher)).catch(rethrow);
    await this.insertLines(voucher);
  }

  async update(voucher: Voucher): Promise<void> {
    const { id: _id, createdAt: _created, ...row } = rowOf(voucher);
    await this.context.db.update(vouchers).set(row).where(eq(vouchers.id, voucher.id)).catch(rethrow);
    await this.context.db.delete(voucherLines).where(eq(voucherLines.voucherId, voucher.id));
    await this.insertLines(voucher);
  }

  async delete(id: string): Promise<void> {
    await this.context.db.delete(vouchers).where(eq(vouchers.id, id));
  }

  async nextSerial(journalTypeId: string, fiscalYearId: string): Promise<number> {
    const [row] = await this.context.db
      .insert(voucherSequences)
      .values({ journalTypeId, fiscalYearId, last: 1 })
      .onConflictDoUpdate({
        target: [voucherSequences.journalTypeId, voucherSequences.fiscalYearId],
        set: { last: sql`${voucherSequences.last} + 1` },
      })
      .returning({ last: voucherSequences.last });
    return row!.last;
  }

  async addAttachment(attachment: {
    id: string;
    voucherId: string;
    fileName: string;
    contentType: string;
    data: Uint8Array;
    uploadedBy: string;
    now: Date;
  }): Promise<void> {
    await this.context.db.insert(voucherAttachments).values({
      id: attachment.id,
      voucherId: attachment.voucherId,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      sizeBytes: attachment.data.length,
      data: Buffer.from(attachment.data),
      uploadedBy: attachment.uploadedBy,
      uploadedAt: attachment.now,
    });
  }

  listAttachments(voucherId: string): Promise<VoucherAttachmentInfo[]> {
    return this.context.db
      .select({
        id: voucherAttachments.id,
        fileName: voucherAttachments.fileName,
        contentType: voucherAttachments.contentType,
        sizeBytes: voucherAttachments.sizeBytes,
        uploadedAt: voucherAttachments.uploadedAt,
      })
      .from(voucherAttachments)
      .where(eq(voucherAttachments.voucherId, voucherId))
      .orderBy(asc(voucherAttachments.uploadedAt));
  }

  async findAttachment(voucherId: string, attachmentId: string): Promise<StoredAttachment | null> {
    const [row] = await this.context.db
      .select({
        fileName: voucherAttachments.fileName,
        contentType: voucherAttachments.contentType,
        data: voucherAttachments.data,
      })
      .from(voucherAttachments)
      .where(and(eq(voucherAttachments.voucherId, voucherId), eq(voucherAttachments.id, attachmentId)));
    return row ?? null;
  }

  async removeAttachment(voucherId: string, attachmentId: string): Promise<boolean> {
    const rows = await this.context.db
      .delete(voucherAttachments)
      .where(and(eq(voucherAttachments.voucherId, voucherId), eq(voucherAttachments.id, attachmentId)))
      .returning({ id: voucherAttachments.id });
    return rows.length > 0;
  }
}

@Injectable()
export class DrizzleLedgerFacts extends LedgerFacts {
  constructor(private readonly context: DbContext) {
    super();
  }

  async accounts(ids: readonly string[]): Promise<Map<string, PostableAccount>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        id: glAccounts.id,
        code: glAccounts.code,
        isActive: glAccounts.isActive,
        isControlAccount: glAccounts.isControlAccount,
        requiresCostCenter: glAccounts.requiresCostCenter,
        book: accountNatures.book,
      })
      .from(glAccounts)
      .innerJoin(accountLevel5Heads, eq(accountLevel5Heads.id, glAccounts.level5HeadId))
      .innerJoin(accountLevel4Heads, eq(accountLevel4Heads.id, accountLevel5Heads.level4HeadId))
      .innerJoin(accountSubCategories, eq(accountSubCategories.id, accountLevel4Heads.subCategoryId))
      .innerJoin(accountCategories, eq(accountCategories.id, accountSubCategories.categoryId))
      .innerJoin(accountNatures, eq(accountNatures.id, accountCategories.natureId))
      .where(inArray(glAccounts.id, [...ids]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async accountIdsByCode(codes: readonly string[]): Promise<Map<string, string>> {
    if (codes.length === 0) return new Map();
    const rows = await this.context.db
      .select({ id: glAccounts.id, code: glAccounts.code })
      .from(glAccounts)
      .where(
        inArray(
          sql`upper(${glAccounts.code})`,
          codes.map((code) => code.toUpperCase()),
        ),
      );
    const byUpper = new Map(rows.map((row) => [row.code.toUpperCase(), row.id]));
    return new Map(
      codes.flatMap((code) => (byUpper.has(code.toUpperCase()) ? [[code, byUpper.get(code.toUpperCase())!]] : [])),
    );
  }

  async accountIdsByRole(roles: readonly string[]): Promise<Map<string, string>> {
    if (roles.length === 0) return new Map();
    const rows = await this.context.db
      .select({ role: glRoles.role, glAccountId: glRoles.glAccountId })
      .from(glRoles)
      .where(inArray(glRoles.role, [...roles]));
    return new Map(rows.map((row) => [row.role, row.glAccountId]));
  }

  async fiscalYearOn(date: string): Promise<FiscalYearInfo | null> {
    const [row] = await this.context.db
      .select({ id: fiscalYears.id, label: fiscalYears.label, isClosed: fiscalYears.isClosed })
      .from(fiscalYears)
      .where(and(lte(fiscalYears.startsOn, date), gte(fiscalYears.endsOn, date)));
    return row ?? null;
  }

  async journalType(id: string): Promise<JournalInfo | null> {
    const [row] = await this.context.db
      .select({ id: journalTypes.id, shortName: journalTypes.shortName, book: journalTypes.book })
      .from(journalTypes)
      .where(eq(journalTypes.id, id));
    return row ?? null;
  }

  async journalTypeByShortName(shortName: string): Promise<JournalInfo | null> {
    const [row] = await this.context.db
      .select({ id: journalTypes.id, shortName: journalTypes.shortName, book: journalTypes.book })
      .from(journalTypes)
      .where(eq(sql`upper(${journalTypes.shortName})`, shortName.toUpperCase()));
    return row ?? null;
  }
}

const reversals = aliasedTable(vouchers, 'reversals');

interface SummaryRow {
  voucher: typeof vouchers.$inferSelect;
  journalShortName: string;
  fiscalYearLabel: string | null;
  reversedById: string | null;
}

@Injectable()
export class DrizzleVoucherReadRepository extends VoucherReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private summaries() {
    return this.context.db
      .select({
        voucher: vouchers,
        journalShortName: journalTypes.shortName,
        fiscalYearLabel: fiscalYears.label,
        reversedById: reversals.id,
      })
      .from(vouchers)
      .innerJoin(journalTypes, eq(journalTypes.id, vouchers.journalTypeId))
      .leftJoin(fiscalYears, eq(fiscalYears.id, vouchers.fiscalYearId))
      .leftJoin(reversals, eq(reversals.reversalOfId, vouchers.id))
      .$dynamic();
  }

  private static summary(row: SummaryRow): VoucherSummary {
    const { createdAt: _created, updatedAt: _updated, ...voucher } = row.voucher;
    return {
      ...voucher,
      journalShortName: row.journalShortName,
      fiscalYearLabel: row.fiscalYearLabel,
      reversedById: row.reversedById,
    };
  }

  async list(filter: VoucherFilter): Promise<Page<VoucherSummary>> {
    const conditions: (SQL | undefined)[] = [
      filter.from ? gte(vouchers.voucherDate, filter.from) : undefined,
      filter.to ? lte(vouchers.voucherDate, filter.to) : undefined,
      filter.journalTypeId ? eq(vouchers.journalTypeId, filter.journalTypeId) : undefined,
      filter.status ? eq(vouchers.status, filter.status) : undefined,
      filter.sourceModule ? eq(vouchers.sourceModule, filter.sourceModule) : undefined,
      filter.sourceReference ? eq(vouchers.sourceReference, filter.sourceReference) : undefined,
      filter.glAccountId
        ? exists(
            this.context.db
              .select({ one: sql`1` })
              .from(voucherLines)
              .where(and(eq(voucherLines.voucherId, vouchers.id), eq(voucherLines.glAccountId, filter.glAccountId))),
          )
        : undefined,
    ];
    if (filter.q) {
      const pattern = `%${escapeLike(filter.q)}%`;
      conditions.push(
        or(ilike(vouchers.number, pattern), ilike(vouchers.narration, pattern), ilike(vouchers.paidTo, pattern)),
      );
    }
    const where = and(...conditions);
    const [rows, [total]] = await Promise.all([
      this.summaries()
        .where(where)
        .orderBy(desc(vouchers.voucherDate), desc(vouchers.createdAt))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(vouchers).where(where),
    ]);
    return toPage(
      rows.map((row) => DrizzleVoucherReadRepository.summary(row)),
      total?.n ?? 0,
      filter,
    );
  }

  async get(id: string): Promise<VoucherView | null> {
    const [row] = await this.summaries().where(eq(vouchers.id, id));
    if (!row) return null;
    const [lines, attachments] = await Promise.all([
      this.context.db
        .select({ line: voucherLines, glCode: glAccounts.code, glName: glAccounts.name })
        .from(voucherLines)
        .innerJoin(glAccounts, eq(glAccounts.id, voucherLines.glAccountId))
        .where(eq(voucherLines.voucherId, id))
        .orderBy(asc(voucherLines.position)),
      new DrizzleVoucherRepository(this.context).listAttachments(id),
    ]);
    return {
      ...DrizzleVoucherReadRepository.summary(row),
      lines: lines.map(({ line: { voucherId: _voucher, position: _position, ...line }, glCode, glName }) => ({
        ...line,
        glCode,
        glName,
      })),
      attachments,
    };
  }
}
