import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { serviceUnits } from '../../../administration/infrastructure/persistence/administration.schema.js';
import { staffRecords } from '../../../hr/infrastructure/persistence/hr.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
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
/** The organization's books, and the provident fund trust's own books (old PFBook schema). */
export const BOOKS = ['main', 'pf'] as const;

// Old Account.NatureOfAccounts (+ MasterStatements): assets, liabilities, equity, income, expenses.
export const accountNatures = pgTable(
  'account_natures',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    book: text('book', { enum: BOOKS }).notNull().default('main'),
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
    check('account_natures_book_ck', sql`${t.book} in ('main', 'pf')`),
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
    book: text('book', { enum: BOOKS }).notNull().default('main'),
    shortName: text('short_name').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('journal_types_short_name_uq').on(sql`upper(${t.shortName})`),
    check('journal_types_short_name_len_ck', sql`char_length(${t.shortName}) between 1 and 10`),
    check('journal_types_book_ck', sql`${t.book} in ('main', 'pf')`),
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
    // A provident fund member's account in the PF book (old PfGeneralLedgers.StaffRecordId).
    staffId: uuid('staff_id').references(() => staffRecords.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [index('sub_ledgers_type_idx').on(t.typeId, t.name), nameLength('sub_ledgers', t.name, 200)],
);

const amount = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });

// Old Account.VoucherMasters. Drafts have no number or fiscal year yet; posting assigns both.
export const vouchers = pgTable(
  'vouchers',
  {
    id: uuid('id').primaryKey(),
    number: text('number'),
    journalTypeId: uuid('journal_type_id')
      .notNull()
      .references(() => journalTypes.id, { onDelete: 'restrict' }),
    fiscalYearId: uuid('fiscal_year_id').references(() => fiscalYears.id, { onDelete: 'restrict' }),
    voucherDate: day('voucher_date').notNull(),
    documentDate: day('document_date'),
    narration: text('narration'),
    paidTo: text('paid_to'),
    mode: text('mode'),
    serviceUnitId: uuid('service_unit_id').references(() => serviceUnits.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['draft', 'posted', 'reversed'] }).notNull(),
    sourceModule: text('source_module'),
    sourceReference: text('source_reference'),
    reversalOfId: uuid('reversal_of_id').references((): AnyPgColumn => vouchers.id, { onDelete: 'restrict' }),
    total: amount('total').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    postedBy: uuid('posted_by').references(() => users.id, { onDelete: 'set null' }),
    postedAt: tz('posted_at'),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('vouchers_number_uq').on(t.number),
    index('vouchers_date_idx').on(t.voucherDate, t.status),
    index('vouchers_source_idx').on(t.sourceModule, t.sourceReference),
    // One reversal per voucher.
    uniqueIndex('vouchers_reversal_uq').on(t.reversalOfId),
    check('vouchers_status_ck', sql`${t.status} in ('draft', 'posted', 'reversed')`),
    check(
      'vouchers_posted_ck',
      sql`(${t.status} = 'draft') = (${t.number} is null) and (${t.status} = 'draft') = (${t.fiscalYearId} is null)`,
    ),
    check('vouchers_source_ck', sql`(${t.sourceModule} is null) = (${t.sourceReference} is null)`),
  ],
);

// Old Account.VoucherMasterDetails.
export const voucherLines = pgTable(
  'voucher_lines',
  {
    voucherId: uuid('voucher_id')
      .notNull()
      .references(() => vouchers.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    glAccountId: uuid('gl_account_id')
      .notNull()
      .references(() => glAccounts.id, { onDelete: 'restrict' }),
    debit: amount('debit').notNull(),
    credit: amount('credit').notNull(),
    narration: text('narration'),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id, { onDelete: 'restrict' }),
    subLedgerId: uuid('sub_ledger_id').references(() => subLedgers.id, { onDelete: 'restrict' }),
    chequeNo: text('cheque_no'),
    chequeDate: day('cheque_date'),
  },
  (t) => [
    primaryKey({ columns: [t.voucherId, t.position] }),
    index('voucher_lines_account_idx').on(t.glAccountId),
    index('voucher_lines_sub_ledger_idx').on(t.subLedgerId),
    check(
      'voucher_lines_amount_ck',
      sql`${t.debit} >= 0 and ${t.credit} >= 0 and (${t.debit} > 0) <> (${t.credit} > 0)`,
    ),
  ],
);

// Next voucher serial per journal type and fiscal year.
export const voucherSequences = pgTable(
  'voucher_sequences',
  {
    journalTypeId: uuid('journal_type_id')
      .notNull()
      .references(() => journalTypes.id, { onDelete: 'restrict' }),
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'restrict' }),
    last: integer('last').notNull(),
  },
  (t) => [primaryKey({ columns: [t.journalTypeId, t.fiscalYearId] })],
);

// Old Account.AttachedFileWithVouchers.
export const voucherAttachments = pgTable(
  'voucher_attachments',
  {
    id: uuid('id').primaryKey(),
    voucherId: uuid('voucher_id')
      .notNull()
      .references(() => vouchers.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: bytea('data').notNull(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    uploadedAt: tz('uploaded_at').notNull().defaultNow(),
  },
  (t) => [
    index('voucher_attachments_voucher_idx').on(t.voucherId),
    check(
      'voucher_attachments_type_ck',
      sql`${t.contentType} in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')`,
    ),
    check('voucher_attachments_size_ck', sql`octet_length(${t.data}) between 1 and 5242880`),
  ],
);

// Old Account.Configuration (account type → account) and the GL ids hard-coded in AppConstant
// (IPDReceivableGLId, IPDSaleGLId, …): the account each posting role uses.
export const glRoles = pgTable(
  'gl_roles',
  {
    id: uuid('id').primaryKey(),
    role: text('role').notNull(),
    glAccountId: uuid('gl_account_id')
      .notNull()
      .references(() => glAccounts.id, { onDelete: 'restrict' }),
    description: text('description'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('gl_roles_role_uq').on(t.role),
    check('gl_roles_role_ck', sql`${t.role} ~ '^[a-z][a-z0-9_.]{1,59}$'`),
  ],
);

// Old SuperAdmin.AccountConfigurations: when a section (pharmacy sales, OPD billing, …) posts to the ledger.
export const postingSchedules = pgTable(
  'posting_schedules',
  {
    id: uuid('id').primaryKey(),
    section: text('section').notNull(),
    timing: text('timing', { enum: ['on_sale', 'end_of_day', 'weekly', 'monthly'] }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('posting_schedules_section_uq').on(t.section),
    check('posting_schedules_timing_ck', sql`${t.timing} in ('on_sale', 'end_of_day', 'weekly', 'monthly')`),
    check('posting_schedules_section_len_ck', sql`char_length(${t.section}) between 1 and 60`),
  ],
);

// Old PFBook.PFDeposits: the monthly PF remittances deposited to the fund's bank account.
export const pfDeposits = pgTable(
  'pf_deposits',
  {
    id: uuid('id').primaryKey(),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    amount: amount('amount').notNull(),
    chequeNo: text('cheque_no'),
    chequeDate: day('cheque_date'),
    depositedOn: day('deposited_on'),
    voucherId: uuid('voucher_id').references(() => vouchers.id, { onDelete: 'set null' }),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pf_deposits_period_uq').on(t.year, t.month),
    check('pf_deposits_period_ck', sql`${t.year} between 2000 and 2100 and ${t.month} between 1 and 12`),
    check('pf_deposits_amount_ck', sql`${t.amount} > 0`),
  ],
);

// Old PFVoucherMasters.FDRNo / MatureDate / FDRWithdrawDate: the fund's fixed deposits.
export const pfFixedDeposits = pgTable(
  'pf_fixed_deposits',
  {
    id: uuid('id').primaryKey(),
    fdrNo: text('fdr_no').notNull(),
    bankName: text('bank_name').notNull(),
    amount: amount('amount').notNull(),
    interestRatePercent: numeric('interest_rate_percent', { precision: 5, scale: 2, mode: 'number' }),
    openedOn: day('opened_on').notNull(),
    maturesOn: day('matures_on').notNull(),
    withdrawnOn: day('withdrawn_on'),
    withdrawnAmount: amount('withdrawn_amount'),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pf_fixed_deposits_no_uq').on(sql`upper(${t.fdrNo})`),
    check('pf_fixed_deposits_amount_ck', sql`${t.amount} > 0`),
    check('pf_fixed_deposits_dates_ck', sql`${t.maturesOn} > ${t.openedOn}`),
    check(
      'pf_fixed_deposits_withdrawal_ck',
      sql`(${t.withdrawnOn} is null) = (${t.withdrawnAmount} is null) and (${t.withdrawnOn} is null or ${t.withdrawnOn} >= ${t.openedOn})`,
    ),
  ],
);

// Old IncomeTaxActAndTDSRules (ITAXTDSController): tax to deduct at source from payments, by category.
export const tdsRules = pgTable(
  'tds_rules',
  {
    id: uuid('id').primaryKey(),
    section: text('section'),
    description: text('description').notNull(),
    category: text('category').notNull(),
    ratePercent: numeric('rate_percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    effectiveFrom: day('effective_from'),
    ...timestamps,
  },
  (t) => [
    index('tds_rules_category_idx').on(t.category),
    check('tds_rules_rate_ck', sql`${t.ratePercent} between 0 and 100`),
    check('tds_rules_description_len_ck', sql`char_length(${t.description}) between 1 and 500`),
  ],
);

// Old Account.Budgets (one company-wide income and expense total a year, read by nothing): what each income and
// expense account is expected to come to in a fiscal year, compared with what was posted.
export const accountBudgets = pgTable(
  'account_budgets',
  {
    fiscalYearId: uuid('fiscal_year_id')
      .notNull()
      .references(() => fiscalYears.id, { onDelete: 'restrict' }),
    glAccountId: uuid('gl_account_id')
      .notNull()
      .references(() => glAccounts.id, { onDelete: 'restrict' }),
    amount: amount('amount').notNull(),
    note: text('note'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.fiscalYearId, t.glAccountId] }),
    index('account_budgets_account_idx').on(t.glAccountId),
    check('account_budgets_amount_ck', sql`${t.amount} >= 0`),
  ],
);
