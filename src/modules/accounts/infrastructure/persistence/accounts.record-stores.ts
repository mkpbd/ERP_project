import { and, gte, lte, ne } from 'drizzle-orm';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { ConflictError } from '../../../../shared/domain/errors.js';
import {
  DrizzleRecordStore,
  type RecordStoreOptions,
  type RecordTable,
} from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { ACCOUNT_RECORDS as R, ACCOUNTS_MANAGE, ACCOUNTS_READ } from '../../application/accounts.constants.js';
import {
  accountCategories,
  accountGroupMembers,
  accountGroups,
  accountLevel4Heads,
  accountLevel5Heads,
  accountNatures,
  accountSubCategories,
  bankAccounts,
  coaDescriptions,
  costCenters,
  fiscalYears,
  fsLineItems,
  glAccounts,
  glItemDescriptions,
  glStatementMappings,
  journalTypes,
  posTerminals,
  statementBroadHeads,
  statementSubHeads,
  subLedgers,
  subLedgerTypes,
  voucherTypes,
} from './accounts.schema.js';

/** Drizzle's foreign key name: `<table>_<column>_<referenced table>_id_fk`. */
const fk = (table: string, column: string, referenced: string) => `${table}_${column}_${referenced}_id_fk`;
const taken = (code: string, message: string) => ({ code, message });

export function accountRecordTypes(context: DbContext): RecordType[] {
  const record = (name: string, table: RecordTable, options: Omit<RecordStoreOptions, 'name'>): RecordType => ({
    name,
    readPermission: ACCOUNTS_READ,
    managePermission: ACCOUNTS_MANAGE,
    store: new DrizzleRecordStore(context, table, { name, ...options }),
  });

  return [
    record(R.nature, accountNatures, {
      orderBy: [accountNatures.code],
      unique: {
        account_natures_code_uq: taken('account_nature_code_taken', 'Another nature of account has this code'),
        account_natures_name_uq: taken('account_nature_name_taken', 'Another nature of account has this name'),
      },
    }),
    record(R.category, accountCategories, {
      orderBy: [accountCategories.code],
      filters: { natureId: accountCategories.natureId },
      unique: {
        account_categories_code_uq: taken('account_category_code_taken', 'Another category has this code'),
        account_categories_name_uq: taken(
          'account_category_name_taken',
          'The nature already has a category of this name',
        ),
      },
      references: { [fk('account_categories', 'nature_id', 'account_natures')]: R.nature },
    }),
    record(R.subCategory, accountSubCategories, {
      orderBy: [accountSubCategories.name],
      filters: { categoryId: accountSubCategories.categoryId },
      unique: {
        account_sub_categories_name_uq: taken(
          'account_sub_category_name_taken',
          'The category already has this sub-category',
        ),
      },
      references: { [fk('account_sub_categories', 'category_id', 'account_categories')]: R.category },
    }),
    record(R.level4Head, accountLevel4Heads, {
      orderBy: [accountLevel4Heads.name],
      filters: { subCategoryId: accountLevel4Heads.subCategoryId },
      unique: {
        account_level4_heads_name_uq: taken('account_level4_head_name_taken', 'The sub-category already has this head'),
      },
      references: { [fk('account_level4_heads', 'sub_category_id', 'account_sub_categories')]: R.subCategory },
    }),
    record(R.level5Head, accountLevel5Heads, {
      orderBy: [accountLevel5Heads.name],
      filters: { level4HeadId: accountLevel5Heads.level4HeadId },
      unique: {
        account_level5_heads_name_uq: taken('account_level5_head_name_taken', 'The level-4 head already has this head'),
      },
      references: { [fk('account_level5_heads', 'level4_head_id', 'account_level4_heads')]: R.level4Head },
    }),
    record(R.glAccount, glAccounts, {
      orderBy: [glAccounts.code],
      filters: { level5HeadId: glAccounts.level5HeadId, kind: glAccounts.kind, isActive: glAccounts.isActive },
      unique: { gl_accounts_code_uq: taken('gl_account_code_taken', 'Another account has this code') },
      references: {
        [fk('gl_accounts', 'level5_head_id', 'account_level5_heads')]: R.level5Head,
        [fk('gl_accounts', 'coa_description_id', 'coa_descriptions')]: R.coaDescription,
      },
    }),
    record(R.coaDescription, coaDescriptions, {
      orderBy: [coaDescriptions.name],
      unique: { coa_descriptions_name_uq: taken('coa_description_name_taken', 'This description exists') },
    }),
    record(R.fsLineItem, fsLineItems, {
      orderBy: [fsLineItems.name],
      unique: { fs_line_items_name_uq: taken('fs_line_item_name_taken', 'This line item exists') },
    }),
    record(R.glItemDescription, glItemDescriptions, {
      orderBy: [glItemDescriptions.name],
      filters: { subCategoryId: glItemDescriptions.subCategoryId },
      references: {
        [fk('gl_item_descriptions', 'sub_category_id', 'account_sub_categories')]: R.subCategory,
        [fk('gl_item_descriptions', 'fs_line_item_id', 'fs_line_items')]: R.fsLineItem,
        [fk('gl_item_descriptions', 'coa_description_id', 'coa_descriptions')]: R.coaDescription,
      },
    }),
    record(R.accountGroup, accountGroups, {
      orderBy: [accountGroups.name],
      unique: { account_groups_name_uq: taken('account_group_name_taken', 'This group exists') },
    }),
    record(R.accountGroupMember, accountGroupMembers, {
      orderBy: [accountGroupMembers.groupId],
      filters: { groupId: accountGroupMembers.groupId, glAccountId: accountGroupMembers.glAccountId },
      unique: { account_group_members_uq: taken('account_group_member_exists', 'The account is already in the group') },
      references: {
        [fk('account_group_members', 'group_id', 'account_groups')]: R.accountGroup,
        [fk('account_group_members', 'gl_account_id', 'gl_accounts')]: R.glAccount,
      },
    }),
    record(R.statementBroadHead, statementBroadHeads, {
      orderBy: [statementBroadHeads.name],
      unique: { statement_broad_heads_name_uq: taken('statement_broad_head_name_taken', 'This head exists') },
    }),
    record(R.statementSubHead, statementSubHeads, {
      orderBy: [statementSubHeads.name],
      filters: { broadHeadId: statementSubHeads.broadHeadId },
      unique: {
        statement_sub_heads_name_uq: taken('statement_sub_head_name_taken', 'The broad head already has this'),
      },
      references: { [fk('statement_sub_heads', 'broad_head_id', 'statement_broad_heads')]: R.statementBroadHead },
    }),
    record(R.glStatementMapping, glStatementMappings, {
      orderBy: [glStatementMappings.subHeadId],
      filters: { glAccountId: glStatementMappings.glAccountId, subHeadId: glStatementMappings.subHeadId },
      unique: {
        gl_statement_mappings_account_uq: taken(
          'gl_statement_mapping_exists',
          'The account already has a statement head',
        ),
      },
      references: {
        [fk('gl_statement_mappings', 'gl_account_id', 'gl_accounts')]: R.glAccount,
        [fk('gl_statement_mappings', 'sub_head_id', 'statement_sub_heads')]: R.statementSubHead,
      },
    }),
    record(R.fiscalYear, fiscalYears, {
      orderBy: [fiscalYears.startsOn],
      unique: {
        fiscal_years_label_uq: taken('fiscal_year_exists', 'A fiscal year with this label exists'),
        fiscal_years_start_uq: taken('fiscal_year_exists', 'A fiscal year starting then exists'),
      },
      // Fiscal years must not overlap: a voucher date has to fall in exactly one.
      guard: async (row) => {
        const startsOn = row['startsOn'];
        const endsOn = row['endsOn'];
        if (typeof startsOn !== 'string' || typeof endsOn !== 'string') return;
        const overlapping = await context.db
          .select({ id: fiscalYears.id })
          .from(fiscalYears)
          .where(
            and(
              lte(fiscalYears.startsOn, endsOn),
              gte(fiscalYears.endsOn, startsOn),
              typeof row['id'] === 'string' ? ne(fiscalYears.id, row['id']) : undefined,
            ),
          )
          .limit(1);
        if (overlapping.length > 0)
          throw new ConflictError('fiscal_year_overlaps', 'The dates overlap another fiscal year');
      },
    }),
    record(R.journalType, journalTypes, {
      orderBy: [journalTypes.shortName],
      unique: {
        journal_types_short_name_uq: taken('journal_type_short_name_taken', 'Another journal type has this short name'),
      },
    }),
    record(R.voucherType, voucherTypes, {
      orderBy: [voucherTypes.code],
      unique: { voucher_types_code_uq: taken('voucher_type_code_taken', 'Another voucher type has this code') },
    }),
    record(R.costCenter, costCenters, {
      orderBy: [costCenters.name],
      unique: { cost_centers_name_uq: taken('cost_center_name_taken', 'This cost center exists') },
    }),
    record(R.bankAccount, bankAccounts, {
      orderBy: [bankAccounts.bankName, bankAccounts.accountNo],
      unique: { bank_accounts_number_uq: taken('bank_account_exists', 'This bank account exists') },
      references: { [fk('bank_accounts', 'gl_account_id', 'gl_accounts')]: R.glAccount },
    }),
    record(R.posTerminal, posTerminals, {
      orderBy: [posTerminals.name],
      filters: { bankAccountId: posTerminals.bankAccountId },
      unique: { pos_terminals_name_uq: taken('pos_terminal_name_taken', 'This terminal exists') },
      references: { [fk('pos_terminals', 'bank_account_id', 'bank_accounts')]: R.bankAccount },
    }),
    record(R.subLedgerType, subLedgerTypes, {
      orderBy: [subLedgerTypes.name],
      unique: { sub_ledger_types_name_uq: taken('sub_ledger_type_name_taken', 'This sub-ledger type exists') },
    }),
    record(R.subLedger, subLedgers, {
      orderBy: [subLedgers.name],
      filters: { typeId: subLedgers.typeId },
      references: { [fk('sub_ledgers', 'type_id', 'sub_ledger_types')]: R.subLedgerType },
    }),
  ];
}
