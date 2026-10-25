/** Record names (snake_case): audit resource types and error codes (`<name>_not_found`, `<name>_in_use`). */
export const ACCOUNT_RECORDS = {
  nature: 'account_nature',
  category: 'account_category',
  subCategory: 'account_sub_category',
  level4Head: 'account_level4_head',
  level5Head: 'account_level5_head',
  glAccount: 'gl_account',
  coaDescription: 'coa_description',
  fsLineItem: 'fs_line_item',
  glItemDescription: 'gl_item_description',
  accountGroup: 'account_group',
  accountGroupMember: 'account_group_member',
  statementBroadHead: 'statement_broad_head',
  statementSubHead: 'statement_sub_head',
  glStatementMapping: 'gl_statement_mapping',
  fiscalYear: 'fiscal_year',
  journalType: 'journal_type',
  voucherType: 'voucher_type',
  costCenter: 'cost_center',
  bankAccount: 'bank_account',
  posTerminal: 'pos_terminal',
  subLedgerType: 'sub_ledger_type',
  subLedger: 'sub_ledger',
  pfDeposit: 'pf_deposit',
  pfFixedDeposit: 'pf_fixed_deposit',
  tdsRule: 'tds_rule',
} as const;

/** The chart of accounts, books and statements. */
export const ACCOUNTS_READ = 'accounts:read';
/** Setting up the chart of accounts and accounting masters. */
export const ACCOUNTS_MANAGE = 'accounts:manage';

/** Entering and editing draft vouchers and their attachments. */
export const VOUCHERS_WRITE = 'vouchers:write';
/** Posting and reversing vouchers. */
export const VOUCHERS_POST = 'vouchers:post';

export const GL_ROLE = 'gl_role';
export const POSTING_SCHEDULE = 'posting_schedule';
