import { sql, type SQLWrapper } from 'drizzle-orm';
import { boolean, check, date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};
const nameLength = (table: string, column: SQLWrapper, max = 150) =>
  check(`${table}_name_len_ck`, sql`char_length(${column}) between 1 and ${sql.raw(String(max))}`);
const codeLength = (table: string, column: SQLWrapper) =>
  check(`${table}_code_len_ck`, sql`char_length(${column}) between 1 and 30`);

export const ACCOUNT_STATEMENTS = ['balance_sheet', 'profit_and_loss'] as const;
export const NORMAL_BALANCES = ['debit', 'credit'] as const;
export const GL_KINDS = ['bank', 'cash', 'other'] as const;

// Old Account.NatureOfAccounts (+ MasterStatements): assets, liabilities, equity, income, expenses.
export const accountNatures = pgTable(
  'account_natures',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    statement: text('statement', { enum: ACCOUNT_STATEMENTS }).notNull(),
    normalBalance: text('normal_balance', { enum: NORMAL_BALANCES }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('account_natures_code_uq').on(sql`upper(${t.code})`),
    uniqueIndex('account_natures_name_uq').on(sql`lower(${t.name})`),
    codeLength('account_natures', t.code),
    nameLength('account_natures', t.name),
    check('account_natures_statement_ck', sql`${t.statement} in ('balance_sheet', 'profit_and_loss')`),
    check('account_natures_balance_ck', sql`${t.normalBalance} in ('debit', 'credit')`),
  ],
);

// Old Account.Categories.
export const accountCategories = pgTable(
  'account_categories',
  {
    id: uuid('id').primaryKey(),
    natureId: uuid('nature_id')
      .notNull()
      .references(() => accountNatures.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('account_categories_code_uq').on(sql`upper(${t.code})`),
    uniqueIndex('account_categories_name_uq').on(t.natureId, sql`lower(${t.name})`),
    codeLength('account_categories', t.code),
    nameLength('account_categories', t.name),
  ],
);

// Old Account.SubCategories (no code in the old table).
export const accountSubCategories = pgTable(
  'account_sub_categories',
  {
    id: uuid('id').primaryKey(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => accountCategories.id, { onDelete: 'restrict' }),
    code: text('code'),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('account_sub_categories_name_uq').on(t.categoryId, sql`lower(${t.name})`),
    nameLength('account_sub_categories', t.name),
  ],
);

// Old Account.Level4Heads.
export const accountLevel4Heads = pgTable(
  'account_level4_heads',
  {
    id: uuid('id').primaryKey(),
    subCategoryId: uuid('sub_category_id')
      .notNull()
      .references(() => accountSubCategories.id, { onDelete: 'restrict' }),
    code: text('code'),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('account_level4_heads_name_uq').on(t.subCategoryId, sql`lower(${t.name})`),
    nameLength('account_level4_heads', t.name),
  ],
);

// Old Account.Level5Heads.
export const accountLevel5Heads = pgTable(
  'account_level5_heads',
  {
    id: uuid('id').primaryKey(),
    level4HeadId: uuid('level4_head_id')
      .notNull()
      .references(() => accountLevel4Heads.id, { onDelete: 'restrict' }),
    code: text('code'),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('account_level5_heads_name_uq').on(t.level4HeadId, sql`lower(${t.name})`),
    nameLength('account_level5_heads', t.name),
  ],
);

// Old Account.COADescription.
export const coaDescriptions = pgTable(
  'coa_descriptions',
  { id: uuid('id').primaryKey(), code: text('code'), name: text('name').notNull(), ...timestamps },
  (t) => [
    uniqueIndex('coa_descriptions_name_uq').on(sql`lower(${t.name})`),
    nameLength('coa_descriptions', t.name, 100),
  ],
);

// Old Account.FSLI: financial statement line items.
export const fsLineItems = pgTable(
  'fs_line_items',
  { id: uuid('id').primaryKey(), code: text('code'), name: text('name').notNull(), ...timestamps },
  (t) => [uniqueIndex('fs_line_items_name_uq').on(sql`lower(${t.name})`), nameLength('fs_line_items', t.name, 100)],
);

// Old Account.GLItemDescription.
export const glItemDescriptions = pgTable(
  'gl_item_descriptions',
  {
    id: uuid('id').primaryKey(),
    subCategoryId: uuid('sub_category_id')
      .notNull()
      .references(() => accountSubCategories.id, { onDelete: 'restrict' }),
    fsLineItemId: uuid('fs_line_item_id').references(() => fsLineItems.id, { onDelete: 'restrict' }),
    coaDescriptionId: uuid('coa_description_id').references(() => coaDescriptions.id, { onDelete: 'restrict' }),
    code: text('code'),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    index('gl_item_descriptions_sub_category_idx').on(t.subCategoryId),
    nameLength('gl_item_descriptions', t.name, 250),
  ],
);

// Old Account.GeneralLedgers: the postable accounts under a level-5 head.
export const glAccounts = pgTable(
  'gl_accounts',
  {
    id: uuid('id').primaryKey(),
    level5HeadId: uuid('level5_head_id')
      .notNull()
      .references(() => accountLevel5Heads.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: GL_KINDS }).notNull().default('other'),
    coaDescriptionId: uuid('coa_description_id').references(() => coaDescriptions.id, { onDelete: 'restrict' }),
    isControlAccount: boolean('is_control_account').notNull().default(false),
    requiresCostCenter: boolean('requires_cost_center').notNull().default(false),
    isRecurringCost: boolean('is_recurring_cost').notNull().default(false),
    billingHasDetails: boolean('billing_has_details').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('gl_accounts_code_uq').on(sql`upper(${t.code})`),
    index('gl_accounts_level5_idx').on(t.level5HeadId),
    codeLength('gl_accounts', t.code),
    nameLength('gl_accounts', t.name, 200),
    check('gl_accounts_kind_ck', sql`${t.kind} in ('bank', 'cash', 'other')`),
  ],
);

// Old Account.AccountGroups + MainSubAccountsRelations (which accounts belong to a group).
export const accountGroups = pgTable(
  'account_groups',
  { id: uuid('id').primaryKey(), name: text('name').notNull(), ...timestamps },
  (t) => [uniqueIndex('account_groups_name_uq').on(sql`lower(${t.name})`), nameLength('account_groups', t.name)],
);

export const accountGroupMembers = pgTable(
  'account_group_members',
  {
    id: uuid('id').primaryKey(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => accountGroups.id, { onDelete: 'restrict' }),
    glAccountId: uuid('gl_account_id')
      .notNull()
      .references(() => glAccounts.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('account_group_members_uq').on(t.groupId, t.glAccountId)],
);

// Old Account.StatementBroadHeads / StatementSubHeads / GLMappingWithStatements: where an account shows in the
// financial statements.
export const statementBroadHeads = pgTable(
  'statement_broad_heads',
  { id: uuid('id').primaryKey(), name: text('name').notNull(), ...timestamps },
  (t) => [
    uniqueIndex('statement_broad_heads_name_uq').on(sql`lower(${t.name})`),
    nameLength('statement_broad_heads', t.name),
  ],
);

export const statementSubHeads = pgTable(
  'statement_sub_heads',
  {
    id: uuid('id').primaryKey(),
    broadHeadId: uuid('broad_head_id')
      .notNull()
      .references(() => statementBroadHeads.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('statement_sub_heads_name_uq').on(t.broadHeadId, sql`lower(${t.name})`),
    nameLength('statement_sub_heads', t.name),
  ],
);

export const glStatementMappings = pgTable(
  'gl_statement_mappings',
  {
    id: uuid('id').primaryKey(),
    glAccountId: uuid('gl_account_id')
      .notNull()
      .references(() => glAccounts.id, { onDelete: 'cascade' }),
    subHeadId: uuid('sub_head_id')
      .notNull()
      .references(() => statementSubHeads.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  // One place per account.
  (t) => [uniqueIndex('gl_statement_mappings_account_uq').on(t.glAccountId)],
);

// Old Account.FiscalYears (only the year number): now with dates and a closed flag.
export const fiscalYears = pgTable(
  'fiscal_years',
  {
    id: uuid('id').primaryKey(),
    label: text('label').notNull(),
    startsOn: day('starts_on').notNull(),
    endsOn: day('ends_on').notNull(),
    isClosed: boolean('is_closed').notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('fiscal_years_label_uq').on(t.label),
    uniqueIndex('fiscal_years_start_uq').on(t.startsOn),
    check('fiscal_years_dates_ck', sql`${t.endsOn} > ${t.startsOn}`),
    check('fiscal_years_label_len_ck', sql`char_length(${t.label}) between 1 and 20`),
  ],
);

// Old Account.JournalTypes.
export const journalTypes = pgTable(
  'journal_types',
  {
    id: uuid('id').primaryKey(),
    shortName: text('short_name').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('journal_types_short_name_uq').on(sql`upper(${t.shortName})`),
    check('journal_types_short_name_len_ck', sql`char_length(${t.shortName}) between 1 and 10`),
    nameLength('journal_types', t.name, 100),
  ],
);

// Old Account.VoucherTypes.
export const voucherTypes = pgTable(
  'voucher_types',
  { id: uuid('id').primaryKey(), code: text('code').notNull(), title: text('title').notNull(), ...timestamps },
  (t) => [
    uniqueIndex('voucher_types_code_uq').on(sql`upper(${t.code})`),
    codeLength('voucher_types', t.code),
    check('voucher_types_title_len_ck', sql`char_length(${t.title}) between 1 and 100`),
  ],
);

// Old Account.CostCenters.
export const costCenters = pgTable(
  'cost_centers',
  { id: uuid('id').primaryKey(), name: text('name').notNull(), description: text('description'), ...timestamps },
  (t) => [uniqueIndex('cost_centers_name_uq').on(sql`lower(${t.name})`), nameLength('cost_centers', t.name, 100)],
);

// Old Account.Banks: the organization's bank accounts, now linked to their GL account.
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: uuid('id').primaryKey(),
    bankName: text('bank_name').notNull(),
    branch: text('branch'),
    contactNo: text('contact_no'),
    accountNo: text('account_no').notNull(),
    signatories: text('signatories'),
    glAccountId: uuid('gl_account_id').references(() => glAccounts.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('bank_accounts_number_uq').on(sql`lower(${t.bankName})`, t.accountNo),
    check('bank_accounts_name_len_ck', sql`char_length(${t.bankName}) between 1 and 100`),
    check('bank_accounts_no_len_ck', sql`char_length(${t.accountNo}) between 1 and 50`),
  ],
);

// Old Account.POSTerminals: card terminals and the bank account they settle into.
export const posTerminals = pgTable(
  'pos_terminals',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    bankAccountId: uuid('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('pos_terminals_name_uq').on(sql`lower(${t.name})`), nameLength('pos_terminals', t.name, 100)],
);

// Old Account.SubLedgerTypes / SubLedgers: parties tracked under control accounts (suppliers, consultants…).
export const subLedgerTypes = pgTable(
  'sub_ledger_types',
  { id: uuid('id').primaryKey(), name: text('name').notNull(), ...timestamps },
  (t) => [
    uniqueIndex('sub_ledger_types_name_uq').on(sql`lower(${t.name})`),
    nameLength('sub_ledger_types', t.name, 100),
  ],
);

export const subLedgers = pgTable(
  'sub_ledgers',
  {
    id: uuid('id').primaryKey(),
    typeId: uuid('type_id')
      .notNull()
      .references(() => subLedgerTypes.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    address: text('address'),
    mobileNo: text('mobile_no'),
    email: text('email'),
    // Old InvoiceId / InvoiceNo, e.g. the patient bill a sub-ledger was opened for.
    reference: text('reference'),
    ...timestamps,
  },
  (t) => [index('sub_ledgers_type_idx').on(t.typeId, t.name), nameLength('sub_ledgers', t.name, 200)],
);
