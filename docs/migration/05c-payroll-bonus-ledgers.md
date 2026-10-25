# Step 5c — Payroll: festival bonus, leave encashment, PF ledger, staff dues

Status: **done** (2026-10-25). Previous: [step 5b](05b-payroll-salary-sheet.md) · Next: step 5d (income tax, PF
book).

## Scope

| Old | Outcome |
|---|---|
| `Payroll.FestivalBonuses` (festival, month, year, % of basic, dates) | Record `festival_bonuses`, plus the joining cut-off (old screen parameter `BeforeJoiningDate`) and **pay with salary** |
| Procedure `Payroll.FestivalBonus` (`GetFromSp`), `GetFromModel` | `GET /payroll/festival-bonuses/:id/sheet/preview` |
| `Payroll.AprovedFestivalBonuses` + `AddEditAprovedFestivalBonusCommand`, `ReveseAprovedFestivalBonusCommand` | `festival_bonus_lines`; approve / commit / reverse |
| Bonus inside `spGetHrSalarySheet` (basic ÷ 2 for staff mapped to a festival with a bonus that month) | The salary sheet's festival bonus column = approved bonuses marked "pay with salary" for that month |
| `FestivalBonusBank/CashStatementDynamic`, `SPGetEmployeeWiseBonusStatement` | Report `payroll.festival-bonus` (all, bank or cash) |
| `Payroll.LeaveEncashments` + procedure `LeaveIncashment` | `leave_encashments`; preview / save / remove per pay month; report `payroll.leave-encashment` |
| `Payroll.PFLedgers` (manual rows with a stored balance) | Record `pf_ledger_entries` (balance worked out) |
| `SpGetPFMonthlyStatement`, `SpGetPFYearlyStatementEmployeeWise`, `PFSettlementReportEmployeeWise` | Reports `payroll.pf-monthly`, `payroll.pf-statement` (a statement with running balance replaces the yearly grid and the settlement sheet) |
| `Payroll.StaffGlobalLedgers` (staff dues by service unit, stored balance) + `GetStaffDueAmountQuery` | Record `staff_dues`; `GET /payroll/statements/dues`; report `payroll.dues-statement` |

## Festival bonus

The old system had two bonus paths reading the same `FestivalBonuses` table: the salary sheet added half the
basic for staff mapped to the festival, and a separate bonus sheet paid a percentage of last month's basic
to **all** active staff. Both could pay the same bonus. Now there is one:

* **Who**: staff who observe the festival (staff festivals, step 4a), are active, joined on or before the
  cut-off, and were on the **previous month's saved salary sheet**.
* **Amount**: the bonus percentage of that sheet's basic, whole taka. The previous month is the real one; the
  old procedure read December of the *same* year for a January bonus.
* **Paid how**: with "pay with salary", the approved amount goes into that month's salary sheet (festival bonus
  column, part of net pay); otherwise it is paid on its own bonus sheet.
* **Sheet**: preview → approve (saves the lines with each person's details; again replaces them) → commit.
  Reverse deletes an uncommitted sheet. A bonus with a sheet cannot be edited (409
  `festival_bonus_has_sheet`), one festival has one bonus per month (409 `festival_bonus_exists`), and a bonus
  paid with salary cannot change once that month's salary sheet is committed.

## Leave encashment (old `LeaveIncashment`)

For everyone on the pay month's saved salary sheet:

* entitled = the yearly leave days (old fixed 24, now a parameter with that default), pro rata by months for
  someone who joined during the year (joined in April → 9 months → 18 days)
* taken = leave days taken in the calendar year: approved applications plus recorded leave (step 4b). The old
  procedure counted only `HR.LeaveRecords`.
* paid = (entitled − taken) × gross ÷ 30, whole taka; nothing when no leave is left.

Saving replaces the month's encashment; it can also be removed. It is paid on its own sheet, as before.

## PF and staff dues

* **PF statement**: PF deducted on **committed** salary sheets (the old statements read approved sheets) plus
  PF ledger entries (`opening`, `contribution`, `interest`, `withdrawal`, `settlement`, `adjustment`; credit or
  debit, never both), with an opening balance and a running balance. The stored "Balance" column of the old
  ledger is not kept: it went stale whenever an earlier row changed.
* **Staff dues** (old staff global ledger): what a person owes a service unit (debit) and paid back (credit),
  with a running balance. In the old code only its own screen wrote it.
* People can see their own PF and dues statements; others need `payroll:read`.

Two contract methods were added to the HR `StaffDirectory`: festival observers and leave days taken (plus a
festival's name), so payroll still never reads HR tables.

## Endpoints (under `/api/v1`)

| Method and path | Access |
|---|---|
| `… payroll/festival-bonuses` (`GET ?festivalId=&payYear=`, `POST`, `GET/PATCH/DELETE /:id`) | read / manage |
| `GET payroll/festival-bonuses/:id/sheet`, `GET …/sheet/preview` | `payroll:read` |
| `POST payroll/festival-bonuses/:id/sheet/{approve,commit,reverse}` → `{ lines, amount }` | `payroll:manage` |
| `GET payroll/leave-encashments/:year/:month`, `GET …/preview?yearlyLeaveDays=` | `payroll:read` |
| `POST payroll/leave-encashments/:year/:month` `{ yearlyLeaveDays }`, `DELETE …` | `payroll:manage` |
| `… payroll/pf-ledger?staffId=&from=&to=`, `… payroll/staff-dues?staffId=&serviceUnitId=&from=&to=` | read / manage |
| `GET payroll/statements/pf?from=&to=&staffId=`, `GET payroll/statements/dues?from=&to=&staffId=&serviceUnitId=` | own / `payroll:read` |

Reports: `payroll.festival-bonus` (`bonusId`, `mode`; draft before approval; PDF + Excel),
`payroll.leave-encashment`, `payroll.pf-monthly` (PDF + Excel), `payroll.pf-statement`, `payroll.dues-statement`.

## Old → new routes

| Old | New |
|---|---|
| `GET/POST/DELETE api/v1/FestivalBonus` | `/payroll/festival-bonuses` |
| `POST api/v1/AprovedFestivalBonus/GetFromSp`, `…/GetFromModel` | `GET /payroll/festival-bonuses/:id/sheet[/preview]` |
| `POST api/v1/AprovedFestivalBonus` | `POST /payroll/festival-bonuses/:id/sheet/approve` (and `/commit`) |
| `POST api/v1/AprovedFestivalBonus/Reverse` | `POST /payroll/festival-bonuses/:id/sheet/reverse` |
| `POST api/v1/LeaveEncashment/GetLeaveEncashmentByYearAndMonth`, `POST api/v1/LeaveEncashment` | `GET …/leave-encashments/:y/:m[/preview]`, `POST …/leave-encashments/:y/:m` |
| `GET/POST/DELETE api/v1/PFLedger` | `/payroll/pf-ledger` |
| `POST api/v1/Salary/PFMonthlyStatement`, `…/PFYearlyStatementEmployee` | reports `payroll.pf-monthly`, `payroll.pf-statement`; `GET /payroll/statements/pf` |
| `POST api/v1/StaffGlobalLedger`, `DELETE {id}`, `…/GetById` | `/payroll/staff-dues` |
| `POST api/v1/StaffGlobalLedger/GetStaffGlobalLedgersByDates`, `…/Print`, `…/GetStaffDueAmountByStaffId` | `GET /payroll/statements/dues` (closing = amount due), report `payroll.dues-statement` |

## Data migration notes (step 13)

* `AprovedFestivalBonuses` → bonus lines (status from `IsCommit`); the schedule's cut-off becomes the latest
  joining date among its lines, and "pay with salary" is off.
* `PFLedgers.TransactionType` (free text) is mapped onto the entry types; unknown values become `adjustment`.
* `StaffGlobalLedgers.ServiceId` / `ReferranceId` go into `reference`.

## Open questions

1. Should the bonus go to observers only (the old salary-sheet rule) or to everyone (the old bonus sheet)?
   Observers only is implemented.
2. Should festival bonuses default to "pay with salary"?
3. Should employer CPF contributions appear in the PF statement? The old statements showed only the staff
   member's PF.
4. Yearly leave for encashment: confirm 24 days and the gross ÷ 30 day rate.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 200 passed — new `test/unit/payroll/bonus.spec.ts` (bonus percentage and rounding, January base
  month, encashment amount, joining-year pro rata, nothing left, not yet joined)
* `npm run test:int`: 16 passed (migration set now 12)
* `npm run test:e2e`: 71 passed — new `test/e2e/payroll-bonus.e2e-spec.ts` (duplicate bonus, observers and
  cut-off, missing base sheet, commit before approval, approve, edit blocked, bonus in the salary sheet's net,
  reverse, re-approve, commit, reverse after commit; encashment with recorded leave and a mid-year joiner,
  save, PF ledger one-side rule, own PF statement with opening and running balance, others refused, dues
  balance, all reports, remove encashment)
* Visual check of the bonus sheet (Bangla names) and PF statement; dev server migrated, restarted, all 87
  payroll routes mapped
