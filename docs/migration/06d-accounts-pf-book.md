# Step 6d — Accounts: PF book, fund registers, TDS rules

Status: **done** (2026-10-25). Previous: [step 6c](06c-accounts-books.md) · Next: step 7 (SupplyChain).

The old API kept the provident fund trust's accounts in a separate `PFBook` schema with its own chart
(`PFNoAcategory`, `PFSubCategory`, `PFLevel4Head`, `PFNoA`), voucher master (`PFVoucherMaster`), general ledger
(`PfGeneralLedgers`) and deposit table (`PFDeposits`), and its own stored procedures for yearly interest
(`SpGetYearlyInterestList`, `InsertBankInterest`) and settlement (`GetPFSettlementEmpWiseByEmpNo`). Here the
same chart, voucher and statement code serves both books.

## Scope change

The step was planned with the party ledgers (supplier, consultant, IPD patient) and due collection. Those
ledgers are built from bills and purchases that do not exist yet, so they move to the steps that bring their
source: supplier ledger to step 7 (SupplyChain), consultant and IPD patient ledgers and due collection to step
9 (Hospital). Staff dues were already done in [5c](05c-payroll-bonus-ledgers.md).

## Book dimension

* A **nature of account** and a **journal type** each have a `book`: `main` (default) or `pf`. Every account
  belongs to the book of its nature.
* A voucher in a PF journal may only use PF accounts, and a main journal only main accounts (422
  `invalid_voucher`, "account 3001 belongs to the main book").
* Once vouchers use a nature or a journal type, it cannot move to the other book (409 `book_in_use`).
* Books and statements take `book=main|pf` (default `main`): ledgers by account follow the account; the trial
  balance, profit and loss, balance sheet, receipts and payments and cash book include only the book's accounts;
  the day book lists the book's journals. Reports take the same `book` parameter.
* `GET /accounts/natures?book=` and `GET /accounts/journal-types?book=` filter by book.

A PF member's account is a **sub-ledger linked to their staff record** (`staffId`, old
`PfGeneralLedgers.StaffRecordId`); `GET /accounts/sub-ledgers?staffId=` finds it. An unknown staff id is 404
`staff_not_found`.

## Fund registers (`accounts:read` / `accounts:manage`)

| Register | Rules |
|---|---|
| PF deposits (`/accounts/pf-deposits`, old `PFDeposits`) | One per month (409 `pf_deposit_exists`): amount, cheque number and date, deposit date, optional voucher (cleared if the voucher is deleted), remarks. Filter `year`. |
| PF fixed deposits (`/accounts/pf-fixed-deposits`, old `PFVoucherMaster.FDRNo/MatureDate/FDRWithdrawDate`) | FDR number unique ignoring case (409 `pf_fixed_deposit_exists`), bank, amount, interest rate, opened and maturity dates (maturity after opening), withdrawal date and amount given together and not before opening (422 otherwise). |
| TDS rules (`/accounts/tds-rules`, old `IncomeTaxActAndTDSRules`) | Section, description, category (e.g. Supplier, Consultant), rate 0–100 %, effective from. Filter `category`. Applying them to payments comes with the party bills in steps 7 and 9. |

## PF interest and settlement (payroll)

A member's PF **position** on a date, from the PF ledger of [5c](05c-payroll-bonus-ledgers.md):

* opening balance (opening entries),
* own contribution: PF deducted on committed salary sheets plus contribution entries,
* employer's contribution: `matchPercent` (default 100) of own contribution, per year (not of the opening
  balance, which already holds both shares),
* interest, adjustments, less withdrawals, less settlement payouts → **balance**,
* by calendar year: own, employer's, interest, withdrawn (old `PFSettlementReportEmployeeWise`).

**Interest distribution** (old `SpGetYearlyInterestList` / `InsertBankInterest`): the fund's interest for a
period is shared among members in proportion to their balance on a date. Shares are exact to the paisa: each
member gets the floor of their share, the paisa left over go to the largest remainders. Members with nothing get
nothing (422 `no_pf_balance` when nobody has a balance). Applying it adds an `interest` entry per member dated
on that date; it can be done once per date (409 `pf_interest_exists`).

| Method and path | Permission | Returns |
|---|---|---|
| `GET /payroll/pf/interest/preview?asOf=&amount=&matchPercent=` | `payroll:read` | `{ asOf, amount, matchPercent, totalBalance, lines[{staffId, employeeNo, fullName, department, balance, interest}] }` |
| `POST /payroll/pf/interest` `{ asOf, amount, matchPercent?, remarks? }` | `payroll:manage` | `{ members, amount }` |
| `GET /payroll/pf/settlement?asOf=&staffId=&matchPercent=` | own, or `payroll:read` | `{ staff, asOf, matchPercent, opening, own, employer, interest, adjustments, withdrawn, settled, balance, years[] }` |

Reports: `payroll.pf-settlement` (PDF; own or `payroll:read`), `payroll.pf-interest` (PDF, Excel).

## Old → new routes

| Old | New |
|---|---|
| `PFNoAcategory`, `PFSubCategory`, `PFLevel4Head`, `PFNoA` controllers | the chart endpoints of [6a](06a-accounts-chart.md), with natures in `book: 'pf'` |
| `PFVoucherMaster` (`POST`, `GetByDate`, `GetPFVoucherDetail`, `Print`, `PrintDetail`) | `/accounts/vouchers` with a PF journal type; voucher reports of [6b](06b-accounts-vouchers.md) |
| `PfGeneralLedger` | `GET /accounts/books/ledger?subLedgerId=` (member) or `?glAccountId=` |
| `PFDeposit`, `GetPFDepositVoucherByYear`, `PrintPFDepositVoucher` | `/accounts/pf-deposits?year=` |
| `GetPFPDRVoucherByDates`, `PrintPDRVoucherStatement` (FDR) | `/accounts/pf-fixed-deposits` |
| `PFBook/GetSpGetYearlyInterestList`, `InsertBankInterest` | `GET /payroll/pf/interest/preview`, `POST /payroll/pf/interest` |
| `GetPFSettlementEmpWiseByEmpNo`, `PrintPFSettlementEmpWise`, `GetPFStattlementVoucherByDates` | `GET /payroll/pf/settlement`, report `payroll.pf-settlement`; the payout voucher is a PF journal voucher plus a `settlement` PF ledger entry |
| `ITAXTDS` controller | `/accounts/tds-rules` |
| Supplier / consultant / IPD ledgers, due collection | steps 7 and 9 |

## Open questions

1. Is the employer's match always 100 % of own PF, or does it depend on service length (vesting)? The
   settlement takes `matchPercent` for now.
2. Should the interest distribution also post the PF journal voucher (debit interest receivable / bank,
   credit members) through `LedgerPosting`, once the PF GL roles are agreed?
3. Should a final settlement close the member's PF sub-ledger and stop PF deduction automatically?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* Migration `0015_accounts_pf_book`: `book` on natures and journal types (checked), `sub_ledgers.staff_id`,
  `pf_deposits`, `pf_fixed_deposits`, `tds_rules`
* `npm test`: 222 passed — new `test/unit/payroll/pf.spec.ts` (position with opening, match, interest,
  adjustment and withdrawal; half match; zero after settlement; interest shares to the paisa with largest
  remainders; members without balance skipped; nobody with a balance); voucher spec gets a book mismatch test
* `npm run test:int`: 16 passed (migration count 16, new tables)
* `npm run test:e2e`: 79 passed — `books.e2e-spec.ts` adds the PF book (PF journal and accounts, both kinds of
  mix refused, member sub-ledger by staff, PF trial balance / balance sheet / day book apart from the main
  book, `book_in_use`, PF trial balance report) and the fund registers and TDS rules; `payroll-bonus.e2e-spec.ts`
  adds interest preview / apply / repeat 409, own and others' settlement, and the two reports
* Visual check of the settlement (Bangla name, lakh grouping, amount in words) and interest reports; dev server
  restarted with the new routes mapped
