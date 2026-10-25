# Step 6c — Accounts: books and statements

Status: **done** (2026-10-25). Previous: [step 6b](06b-accounts-vouchers.md) · Next: step 6d (party ledgers, due
collection, PF book, TDS rules).

The old books and statements came from `[Account]` stored procedures whose source is not available (see
[6a](06a-accounts-chart.md#where-the-old-logic-lives)): `SpGetSubLedgerReport`, `SpGetProfitLossDetailsReport`,
`SpGetBalanceSheetDetailsReport`, `SpGetCashFlowReportDetailsReport`, the bank and petty cash books and the
Govt project's `SpGetReceiptsAndPayment`. They are rebuilt here from the posted vouchers with standard
accounting rules.

## What counts

Every **posted** voucher line. A reversed voucher keeps its entries and its reversal (also posted) undoes them,
so both show in a ledger and net to zero. Drafts never count.

## Books

| Book | Content |
|---|---|
| General ledger (`accounts.ledger`) | One account: balance before the start date, each entry (date, voucher, narration, the other accounts of the voucher), running balance, totals and closing balance. Balances are shown Dr / Cr. |
| Sub-ledger statement (`accounts.sub-ledger`) | One party (sub-ledger), optionally under one account. |
| Cash and bank book (`accounts.cash-book`) | All cash accounts (or all bank accounts, by the account's kind) together. Old bank book / petty cash book. |
| Day book (`accounts.day-book`) | Every posted voucher of a period with its lines. |

## Statements

| Statement | Rules |
|---|---|
| Trial balance (`accounts.trial-balance`) | Every account with a balance or movement: opening (debit positive), period debits and credits, closing debit or credit, totals; flags when it does not balance. |
| Profit and loss (`accounts.profit-and-loss`) | Accounts of profit-and-loss natures for the period, in each nature's normal direction (income credit − debit, expenses debit − credit). Net profit = credit-normal natures − debit-normal natures. |
| Balance sheet (`accounts.balance-sheet`) | Balances of balance-sheet natures at a date; the credit side adds **profit and loss to date** (all income less expenses up to the date), since no year-end closing entries are made yet; flags when it does not balance. |
| Receipts and payments (`accounts.receipts-payments`) | Cash and bank (accounts of kind cash or bank): opening, money in by the other account of each voucher (net credit), money out (net debit), closing. Moves between cash and bank accounts cancel out; a reversed voucher nets with its reversal. This stands in for the old cash flow report. |

Inside each statement, accounts are grouped by nature, then by their **statement head** (broad › sub, from
6a's mappings) when they have one, otherwise by their category. Accounts with nothing are left out. All sums
are done in paisa, so totals are exact.

## Endpoints (under `/api/v1/accounts`, all `accounts:read`)

| Method and path | Returns |
|---|---|
| `GET books/ledger?glAccountId=&subLedgerId=&from=&to=` (an account, a party, or a party under an account) | `{ title, opening, rows[{date, voucherNumber, narration, contra, debit, credit, balance}], totalDebit, totalCredit, closing }` |
| `GET books/cash?kind=cash\|bank&from=&to=` | the same, for all cash or bank accounts |
| `GET books/day-book?from=&to=` | posted vouchers with lines |
| `GET statements/trial-balance?from=&to=` | rows, totals, balanced |
| `GET statements/profit-and-loss?from=&to=` | sections → groups → accounts, net profit |
| `GET statements/balance-sheet?asOf=` | debit and credit sections, profit to date, totals, balanced |
| `GET statements/receipts-and-payments?from=&to=` | opening, receipts, payments, closing |

Periods are at most ten years and the start must not be after the end (422 `invalid_period`).

## Old → new routes

| Old | New |
|---|---|
| Financial statement page → `SpGetSubLedgerReport` | `GET /accounts/books/ledger?subLedgerId=`, report `accounts.sub-ledger` |
| `SpGetProfitLossDetailsReport` | `GET /accounts/statements/profit-and-loss`, report `accounts.profit-and-loss` |
| `SpGetBalanceSheetDetailsReport` | `GET /accounts/statements/balance-sheet`, report `accounts.balance-sheet` |
| `SpGetCashFlowReportDetailsReport`, `SpGetReceiptsAndPayment` | `GET /accounts/statements/receipts-and-payments`, report `accounts.receipts-payments` |
| Bank book, petty cash book pages | `GET /accounts/books/cash`, report `accounts.cash-book` |
| Ledger by account (`GetVoucherDetailByVMIDorGLIDQuery`) | `GET /accounts/books/ledger?glAccountId=`, report `accounts.ledger` |

## Open questions

1. Should the year-end close move the year's profit into retained earnings with a closing voucher (then the
   balance sheet's "profit to date" becomes the current year's profit only)?
2. Should the cash flow statement follow the indirect method (operating / investing / financing) once accounts
   are tagged with those activities?
3. Budget settings (`BudgetSettingsComponent` in the Blazor app) are not in the API repository; port them
   with a budget-versus-actual statement?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean; no schema change
* `npm test`: 216 passed — new `test/unit/accounts/statements.spec.ts` (running balance to the paisa, trial
  balance for a period, profit and loss by category, balance sheet with profit to date and statement heads,
  receipts and payments with a cash-to-bank transfer)
* `npm run test:int`: 16 passed
* `npm run test:e2e`: 76 passed — new `test/e2e/books.e2e-spec.ts` (a quarter of vouchers incl. a draft and a
  reversed voucher; account ledger with other accounts, sub-ledger, cash book, day book, trial balance, profit
  and loss, balance sheet, receipts and payments, permission, invalid period, all eight reports)
* Visual check of the balance sheet (lakh grouping, Bangla account name) and ledger; dev server restarted, all 7
  book and statement routes mapped
