import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, lte, sql, sum, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { BooksReadRepository, type DayBookVoucher, type LedgerScope } from '../../application/statements.js';
import type { AccountMovement, LedgerEntry, PostingLine, StatementAccount } from '../../domain/statements.js';
import {
  accountCategories,
  accountLevel4Heads,
  accountLevel5Heads,
  accountNatures,
  accountSubCategories,
  glAccounts,
  glStatementMappings,
  journalTypes,
  statementBroadHeads,
  statementSubHeads,
  subLedgers,
  voucherLines,
  vouchers,
} from './accounts.schema.js';

/** Posted vouchers; a reversed voucher still counts, together with its posted reversal. */
const POSTED = inArray(vouchers.status, ['posted', 'reversed']);

@Injectable()
export class DrizzleBooksReadRepository extends BooksReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async accounts(): Promise<(StatementAccount & { kind: 'bank' | 'cash' | 'other' })[]> {
    const rows = await this.context.db
      .select({
        id: glAccounts.id,
        code: glAccounts.code,
        name: glAccounts.name,
        kind: glAccounts.kind,
        nature: {
          id: accountNatures.id,
          code: accountNatures.code,
          name: accountNatures.name,
          statement: accountNatures.statement,
          normalBalance: accountNatures.normalBalance,
        },
        category: accountCategories.name,
        broad: statementBroadHeads.name,
        sub: statementSubHeads.name,
      })
      .from(glAccounts)
      .innerJoin(accountLevel5Heads, eq(accountLevel5Heads.id, glAccounts.level5HeadId))
      .innerJoin(accountLevel4Heads, eq(accountLevel4Heads.id, accountLevel5Heads.level4HeadId))
      .innerJoin(accountSubCategories, eq(accountSubCategories.id, accountLevel4Heads.subCategoryId))
      .innerJoin(accountCategories, eq(accountCategories.id, accountSubCategories.categoryId))
      .innerJoin(accountNatures, eq(accountNatures.id, accountCategories.natureId))
      .leftJoin(glStatementMappings, eq(glStatementMappings.glAccountId, glAccounts.id))
      .leftJoin(statementSubHeads, eq(statementSubHeads.id, glStatementMappings.subHeadId))
      .leftJoin(statementBroadHeads, eq(statementBroadHeads.id, statementSubHeads.broadHeadId))
      .orderBy(asc(accountNatures.code), asc(accountCategories.code), asc(glAccounts.code));
    return rows.map(({ broad, sub, ...row }) => ({
      ...row,
      statementHead: broad && sub ? { broad, sub } : null,
    }));
  }

  async movements(from: string, to: string): Promise<Map<string, AccountMovement>> {
    const before = sql`${vouchers.voucherDate} < ${from}`;
    const within = sql`${vouchers.voucherDate} between ${from} and ${to}`;
    const rows = await this.context.db
      .select({
        accountId: voucherLines.glAccountId,
        openingDebit: sql<number>`coalesce(sum(${voucherLines.debit}) filter (where ${before}), 0)`.mapWith(Number),
        openingCredit: sql<number>`coalesce(sum(${voucherLines.credit}) filter (where ${before}), 0)`.mapWith(Number),
        debit: sql<number>`coalesce(sum(${voucherLines.debit}) filter (where ${within}), 0)`.mapWith(Number),
        credit: sql<number>`coalesce(sum(${voucherLines.credit}) filter (where ${within}), 0)`.mapWith(Number),
      })
      .from(voucherLines)
      .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
      .where(and(POSTED, lte(vouchers.voucherDate, to)))
      .groupBy(voucherLines.glAccountId);
    return new Map(rows.map((row) => [row.accountId, row]));
  }

  private scoped(scope: LedgerScope): SQL | undefined {
    return and(
      scope.accountIds.length > 0 ? inArray(voucherLines.glAccountId, [...scope.accountIds]) : undefined,
      scope.subLedgerId ? eq(voucherLines.subLedgerId, scope.subLedgerId) : undefined,
    );
  }

  private empty(scope: LedgerScope): boolean {
    return scope.accountIds.length === 0 && !scope.subLedgerId;
  }

  async opening(scope: LedgerScope, from: string): Promise<number> {
    if (this.empty(scope)) return 0;
    const [row] = await this.context.db
      .select({ debit: sum(voucherLines.debit).mapWith(Number), credit: sum(voucherLines.credit).mapWith(Number) })
      .from(voucherLines)
      .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
      .where(and(POSTED, lt(vouchers.voucherDate, from), this.scoped(scope)));
    return Math.round(((row?.debit ?? 0) - (row?.credit ?? 0)) * 100) / 100;
  }

  async entries(scope: LedgerScope, from: string, to: string): Promise<LedgerEntry[]> {
    if (this.empty(scope)) return [];
    // The other accounts of the same voucher, as "code name".
    const contra = sql<string>`coalesce((
      select string_agg(distinct ${glAccounts.code} || ' ' || ${glAccounts.name}, ', ')
      from ${voucherLines} as other
      join ${glAccounts} on ${glAccounts.id} = other.gl_account_id
      where other.voucher_id = ${vouchers.id} and other.gl_account_id <> ${voucherLines.glAccountId}
    ), '')`;
    return this.context.db
      .select({
        date: vouchers.voucherDate,
        voucherId: vouchers.id,
        voucherNumber: sql<string>`${vouchers.number}`,
        narration: sql<string | null>`coalesce(${voucherLines.narration}, ${vouchers.narration})`,
        contra,
        debit: voucherLines.debit,
        credit: voucherLines.credit,
      })
      .from(voucherLines)
      .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
      .where(and(POSTED, gte(vouchers.voucherDate, from), lte(vouchers.voucherDate, to), this.scoped(scope)))
      .orderBy(asc(vouchers.voucherDate), asc(vouchers.number), asc(voucherLines.position));
  }

  async postingLines(from: string, to: string, accountIds: readonly string[]): Promise<PostingLine[]> {
    if (accountIds.length === 0) return [];
    const touching = this.context.db
      .selectDistinct({ id: voucherLines.voucherId })
      .from(voucherLines)
      .where(inArray(voucherLines.glAccountId, [...accountIds]));
    return this.context.db
      .select({
        voucherId: voucherLines.voucherId,
        accountId: voucherLines.glAccountId,
        debit: voucherLines.debit,
        credit: voucherLines.credit,
      })
      .from(voucherLines)
      .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
      .where(
        and(POSTED, gte(vouchers.voucherDate, from), lte(vouchers.voucherDate, to), inArray(vouchers.id, touching)),
      );
  }

  async dayBook(from: string, to: string): Promise<DayBookVoucher[]> {
    const rows = await this.context.db
      .select({
        id: vouchers.id,
        number: sql<string>`${vouchers.number}`,
        voucherDate: vouchers.voucherDate,
        journal: journalTypes.shortName,
        narration: vouchers.narration,
        total: vouchers.total,
        code: glAccounts.code,
        name: glAccounts.name,
        debit: voucherLines.debit,
        credit: voucherLines.credit,
      })
      .from(vouchers)
      .innerJoin(journalTypes, eq(journalTypes.id, vouchers.journalTypeId))
      .innerJoin(voucherLines, eq(voucherLines.voucherId, vouchers.id))
      .innerJoin(glAccounts, eq(glAccounts.id, voucherLines.glAccountId))
      .where(and(POSTED, gte(vouchers.voucherDate, from), lte(vouchers.voucherDate, to)))
      .orderBy(asc(vouchers.voucherDate), asc(vouchers.number), asc(voucherLines.position))
      .limit(20_000);
    const byVoucher = new Map<string, DayBookVoucher>();
    for (const { code, name, debit, credit, ...voucher } of rows) {
      const entry = byVoucher.get(voucher.id) ?? { ...voucher, lines: [] };
      entry.lines.push({ code, name, debit, credit });
      byVoucher.set(voucher.id, entry);
    }
    return [...byVoucher.values()];
  }

  async subLedgerName(id: string): Promise<string | null> {
    const [row] = await this.context.db.select({ name: subLedgers.name }).from(subLedgers).where(eq(subLedgers.id, id));
    return row?.name ?? null;
  }
}
