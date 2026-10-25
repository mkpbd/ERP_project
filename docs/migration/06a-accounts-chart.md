# Step 6a — Accounts: chart of accounts and masters

Status: **done** (2026-10-25). Previous: [step 5d](05d-payroll-income-tax.md) · Next: step 6b (vouchers and
posting).

Accounts is split like payroll:

| Step | Content |
|---|---|
| **6a** | Chart of accounts, statement heads, accounting masters (this step) |
| 6b | Vouchers (balanced double entry, numbering, attachments, reversal), general ledger posting, account configuration |
| 6c | Books and statements: ledger, sub-ledger, cash/bank book, trial balance, profit and loss, balance sheet, cash flow |
| 6d | Party ledgers (supplier, consultant, IPD patient), due collection, PF book, TDS rules |

GL mappings to hospital service groups and pharmacy services (`GLAndHospitalServiceSubGroupMapping`,
`GLAndPharmacyServiceMapping`) come with those modules (steps 8 and 9), since their services are not ported yet.

## Where the old logic lives

The old accounting code is thin: every master is a plain add/edit, and the voucher save accepted any lines
(no debit = credit check; `VoucherValidationController` returns an empty string). The ledger, trial balance,
balance sheet, profit and loss and cash flow come from `[Account]` stored procedures (`SpGetSubLedgerReport`,
`SpGetProfitLossDetailsReport`, `SpGetBalanceSheetDetailsReport`, `SpGetCashFlowReportDetailsReport`, …) whose
source is in neither the API repository, the FAK Blazor repository nor any sibling project. Steps 6b–6c are
therefore designed as standard double entry rather than ported line by line.

## Scope

| Old | Outcome |
|---|---|
| `Account.NatureOfAccounts` (+ `MasterStatements`) | `account_natures`: code, name, statement (`balance_sheet` / `profit_and_loss`) and **normal balance** (`debit` / `credit`, new: needed for statements) |
| `Account.Categories`, `SubCategories`, `Level4Heads`, `Level5Heads` | `account_categories` (code), `account_sub_categories`, `account_level4_heads`, `account_level5_heads` (optional codes) |
| `Account.GeneralLedgers` (the postable accounts) | `gl_accounts`: code, name, kind (`bank` / `cash` / `other`, old `BankCashOth`), control account, needs cost centre, recurring cost, billing details, active |
| `Account.AccountGroups` + `MainSubAccountsRelations` | `account_groups` + `account_group_members` |
| `Account.COADescription`, `FSLI`, `GLItemDescription` | `coa_descriptions`, `fs_line_items`, `gl_item_descriptions` |
| `Account.StatementBroadHeads`, `StatementSubHeads`, `GLMappingWithStatements` | `statement_broad_heads`, `statement_sub_heads`, `gl_statement_mappings` (one head per account) |
| `Account.FiscalYears` (a year number) | `fiscal_years`: label, start and end dates (no overlaps), closed flag |
| `Account.JournalTypes`, `VoucherTypes` | `journal_types` (short name unique), `voucher_types` (code unique) |
| `Account.CostCenters` | `cost_centers` |
| `Account.Banks` | `bank_accounts`, now linked to their GL account |
| `Account.POSTerminals` | `pos_terminals` (with the bank account they settle into) |
| `Account.SubLedgerTypes`, `SubLedgers` | `sub_ledger_types`, `sub_ledgers` (old invoice id/no → `reference`) |
| `Account.Configuration` (account type → id pairs) | Step 6b (account configuration) |

## Rules

* Codes are unique ignoring case (natures, categories, GL accounts, voucher types, journal short names);
  names are unique within their parent.
* A head or account in use cannot be deleted (409 `<record>_in_use`); a missing parent is 404
  `<record>_not_found`.
* Fiscal years cannot overlap (409 `fiscal_year_overlaps`).
* The old tables' `TenantId` columns are dropped: one organization per installation.

## Permissions

| Key | Allows |
|---|---|
| `accounts:read` | The chart of accounts, masters, books and statements |
| `accounts:manage` | Setting up the chart of accounts and masters |

## Endpoints (under `/api/v1/accounts`)

Every master has `GET` (list, with filters), `POST`, `GET/PATCH/DELETE /:id`:
`natures`, `categories?natureId=`, `sub-categories?categoryId=`, `level4-heads?subCategoryId=`,
`level5-heads?level4HeadId=`, `gl-accounts?level5HeadId=&kind=&isActive=`, `coa-descriptions`,
`fs-line-items`, `gl-item-descriptions?subCategoryId=`, `account-groups`,
`account-group-members?groupId=&glAccountId=`, `statement-broad-heads`, `statement-sub-heads?broadHeadId=`,
`gl-statement-mappings?glAccountId=&subHeadId=`, `fiscal-years`, `journal-types`, `voucher-types`,
`cost-centers`, `bank-accounts`, `pos-terminals?bankAccountId=`, `sub-ledger-types`, `sub-ledgers?typeId=`.

`GET /accounts/chart` returns the whole tree. Report `accounts.chart-of-accounts` (PDF + Excel) lists every
head and account indented by level.

## Old → new routes

| Old | New |
|---|---|
| `api/v1/NatureOfAccount`, `Category`, `SubCategory`, `Level4Head`, `Level5Head` | `/accounts/natures`, `/categories`, `/sub-categories`, `/level4-heads`, `/level5-heads` |
| `GET api/v1/GeneralLedger/{id}/{flag}`, `POST`, `DELETE {id}` | `/accounts/gl-accounts` |
| `GET api/v1/GeneralLedger/FiscalYear` | `/accounts/fiscal-years` |
| `POST api/v1/GeneralLedger/SaveGLMappingWithStatement`, `…/GetGLMappingWithStatement` | `/accounts/gl-statement-mappings` |
| `api/v1/AccountGroup`, `MainSubAccoutRelation` | `/accounts/account-groups`, `/accounts/account-group-members` |
| `api/v1/COADescription`, `FSLI`, `GLItemDescription` | `/accounts/coa-descriptions`, `/fs-line-items`, `/gl-item-descriptions` |
| `api/v1/StatementBroadHead`, `StatementSubHead`, `MasterStatement` | `/accounts/statement-broad-heads`, `/statement-sub-heads`; master statement → nature's `statement` |
| `api/v1/JournalType`, `VoucherType`, `CostCenter`, `Bank`, `POSTerminal` | `/accounts/journal-types`, `/voucher-types`, `/cost-centers`, `/bank-accounts`, `/pos-terminals` |
| `api/v1/SubLedgerType`, `Subledger` | `/accounts/sub-ledger-types`, `/sub-ledgers` |

## Data migration notes (step 13)

* `NatureOfAccounts.MasterStatementId` → `statement` by the master statement's name; the normal balance is set
  by nature (assets and expenses debit, the rest credit) and should be reviewed.
* `FiscalYears.FYear` → a label and July–June dates (confirm FAK's fiscal year).
* Old integer ids (natures, account groups, voucher types) get new uuids; references are mapped.

## Open questions

1. Is FAK's fiscal year July–June?
2. Should account codes be generated from the parent's code (e.g. 1101 → 110101 → 11010101) instead of typed?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 205 passed (no new domain logic in this step)
* `npm run test:int`: 16 passed (migration set now 14)
* `npm run test:e2e`: 73 passed — new `test/e2e/accounts.e2e-spec.ts` (natures with duplicate code, missing
  parent, full hierarchy to accounts, duplicate account code, nature in use, bank account with GL, POS
  terminal, statement mapping and duplicate, account group, sub-ledger, masters, overlapping fiscal year, chart
  tree, filter, read-only and no-access users, report PDF + Excel)
* Visual check of the chart report (Bangla names); dev server migrated, restarted, all 111 accounts
  routes mapped
