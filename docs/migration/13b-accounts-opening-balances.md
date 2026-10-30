# Step 13b — Data migration: the chart of accounts and opening balances

Status: **done** (2026-10-30). Previous: [step 13a](13a-data-migration-framework.md) · Next: step 13c (HR).

The old books are brought over as a chart of accounts and **one posted opening voucher**. Old vouchers stay in the
old database, which is kept read-only.

```
ETL_SOURCE_URL=… npm run etl -- --cut-over=2027-01-01 [--dry-run] [--only=opening-balances]
```

* `--cut-over` is **the first day this system keeps the books**. The opening voucher is dated the day before.
* Without it, the chart and the other masters come over and the opening balances are left out (noted in the report).
* Asking for `opening-balances` brings everything it needs first: the chart, sub-ledgers, cost centres, fiscal years
  and journals.

## What comes over

| Old (`Account.*`) | New | How |
|---|---|---|
| `NatureOfAccounts` + `MasterStatements` | `account_natures` | By code or name. See the natures rule below |
| `Categories` | `account_categories` | Under their nature. By code; a category without a code is rejected |
| `SubCategories`, `Level4Heads`, `Level5Heads` | the same levels | Under their parent, matched by name |
| `COADescription` | `coa_descriptions` | By name |
| `GeneralLedgers` | `gl_accounts` | See the accounts rule below |
| `CostCenters` | `cost_centers` | By name |
| `Banks` | `bank_accounts` | By bank and account number. **The old banks had no GL account: link each one** |
| `SubLedgerTypes`, `SubLedgers` | `sub_ledger_types`, `sub_ledgers` | The old invoice number becomes the reference |
| `JournalTypes` | `journal_types` (main book) | By short name |
| `FiscalYears` | `fiscal_years` | See the fiscal years rule below |
| `VoucherMasters` + `VoucherMasterDetails` up to the cut-over | **one opening voucher** | See below |

**Natures.** The old table had no normal balance, so it is read from the name:

* assets and expenses are debit;
* liabilities, equity, funds, income and revenue are credit.

The statement comes from the old master statement, or else from the name. A nature that cannot be read
(say "Miscellaneous") is rejected, and the levels under it with it.

**Accounts.**

* Codes are kept (upper-cased). An existing account with the same code is used.
* Bank, cash or other is taken from `BankCashOth`. Control account, cost-centre requirement and the other flags are
  kept.
* Deleted or inactive accounts come over inactive.
* The accounts the old system **hard-coded** for postings get the same posting role here:

  | Old constant | Posting role |
  |---|---|
  | `IPDReceivableGLId` | `ipd_receivable` |
  | `IPDAdvanceGLId` | `ipd_advance` |
  | `CashInHandGLId` | `cash_in_hand` |
  | `PayableToSupplierGeneralLedgerId` | `supplier_payable` |
  | `StoreInventoryGeneralLedgerId` | `store_inventory` |
  | `MedicineInventoryGeneralLedgerId` | `pharmacy_inventory` |

  A role already set here is left as it is. **The other roles are set by hand before anything posts.**

**Fiscal years.** Old fiscal years were calendar years (`FYear` = the posting date's year). They come over as
1 January – 31 December, open. A year that overlaps one set up here differently (July–June, say) is rejected.

**Masters from the old structure.** The chart, cost centres and sub-ledgers come over even when marked deleted. Old
vouchers may still point at them, and the opening balances need every account they touch.

## The opening voucher

**What it holds.** Every account's balance in the old books at the end of the day before the cut-over:

* the sum of all non-deleted voucher lines dated before the cut-over;
* **all time**, profit and loss accounts too. This system's statements, like the old ones, count profit from the
  beginning, with no year-end closing entries.

**How the lines are split.**

* **Control accounts** get a line per sub-ledger, so each patient's or supplier's balance comes over with its party.
* Accounts that need a cost centre get a line per cost centre.
* Zero balances are left out.

**The voucher.**

* Journal **`OB` (Opening balances)**, made if the old journals had none. Numbered like any voucher,
  e.g. `OB-2026-00001`.
* Posted, with source `data-migration` / `opening:<cut-over>`.

**It is refused, writing nothing, when:**

* the old books' debits and credits differ by a taka or more (`books_do_not_balance`, with the difference);
* an account with a balance was not brought over (`account_not_brought`, with the old ids);
* this system already has posted vouchers dated on or before that day, or an opening already (`books_not_empty`);
* no open fiscal year covers that day.

A difference **under one taka** is float rounding in the old sums (they were stored as `float`). It goes on the
largest line of the short side and is reported.

**Checked before it commits.** The books here are summed account by account up to that day and compared with the old
balances; any difference fails the loader and rolls it back. The report says:

* the voucher number and its date;
* the number of lines and accounts;
* the total of each side;
* any rounding taken up;
* any balances on sub-ledgers that were not brought over, kept on their account.

## Decisions (step 13a's open questions; "next" without answers, so the recommendations)

1. **The cut-over day** is given to the tool (`--cut-over`). The first day of a month is recommended, so the opening
   matches a month-end close in the old system. Not fixed in code.
2. **The old chart comes over as it is**, codes kept, levels linked.
3. **Opening balances are the trial balance at the cut-over, in one voucher.**
   * Control accounts are split by sub-ledger, which already carries each party's open balance.
   * Open documents themselves (admitted patients' bills, member dues) are step 13e.
4. **Cost centres come over**, and balances on accounts that need one are split by them.
5. **Reconciliation.**
   * The loader checks every account against the old books before committing.
   * The trial balance here at the cut-over then equals the old one. The e2e test checks the trial balance, the
     balance sheet and a party's ledger.
   * The side-by-side reconciliation report for sign-off is step 13g.

## Not done here

* **Old vouchers.** They stay in the old database (read-only).
* **Statement mapping.** Old `FSLI`, `GLItemDescription`, `StatementBroadHeads`/`StatementSubHeads`/
  `GLMappingWithStatements`: map accounts to statement lines here if those statements are used.
* **Other old tables.** Account groups, POS terminals, budgets, the PF book (provident fund trust), old
  `Account.Configuration`.
* **Posting roles the old code named ambiguously.** `AccountsPayableGeneralLedgerId`, `SupplierDebitGeneralLedgerId`
  (the same account as store inventory) and `IPDSaleGLId` are set by hand.
* **Links made later.** A sub-ledger's link to its supplier is step 13d. The link from each bank account to its GL
  account is made by hand.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. No new migration.
* `npm test`: 417 passed. New: `test/unit/data-migration/account-records.spec.ts` covers:
  * natures read for statement and normal balance, or rejected;
  * GL accounts with their kind and flags;
  * calendar fiscal years and the day before a cut-over;
  * opening lines per side and sub-ledger, zero balances dropped;
  * rounding under a taka taken up, bigger differences refused.
* `npm run test:int`: 16 passed.
* `npm run test:e2e`: 158 passed. `test/e2e/data-migration.e2e-spec.ts` covers:
  * **Dry run:** the whole chart, banks, sub-ledgers, journals, fiscal years and the opening, with rejections
    (an unreadable nature, an account without a code, a bank without an account number); nothing kept.
  * **Real run:** the same counts.
  * **The opening voucher:** `OB-2026-00001` dated 2026-12-31, 6 lines, 73,000.01 each side, 0.01 rounding taken up.
  * **Natures:** read correctly.
  * **Posting roles:** `cash_in_hand` set on the old cash account.
  * **Re-runs:** a re-run writes nothing; a later cut-over is refused (`books_not_empty`).
  * **The books here:**
    * the trial balance from the cut-over is balanced at 73,000.01;
    * the balance sheet at the day before balances at 40,000 with the loss to date;
    * the patient's sub-ledger opens at 10,000.
  * **No cut-over day:** the opening is left out.
* Dev server restarted; readiness 200.
