# Step 5b — Payroll: monthly salary

Status: **done** (2026-10-25). Previous: [step 5a](05a-payroll-salaries.md) · Next: [step 5c](05c-payroll-bonus-ledgers.md) (bonus, encashment, PF
ledger).

The reference is FAK's live logic, the Bellevue procedures `Payroll.spGetHrSalarySheet` and
`SpInsertToApproveSalarySheet` (see [5a](05a-payroll-salaries.md#where-the-old-logic-lives)).

## Scope

| Old | Outcome |
|---|---|
| `Payroll.StaffOvertimes` | Record `salary_overtimes` (work month, pay month, days, hours, fixed amount) |
| `Payroll.StaffSalaryDeductions` | Record `salary_deductions`, one per person and pay month (the old screen updated the existing one) |
| `Payroll.SalaryPunishments` | Record `salary_punishments` |
| `Payroll.ArrearRecords` | Record `salary_arrears`, one per person and pay month (the old duplicate check) |
| `Payroll.AllowancePayments` | Record `allowance_payments` |
| `Payroll.StaffMonthlySalaryRecords` | Record `salary_payments` (advance and salary actually paid) |
| `Payroll.SalaryStartStopRecords` | Record `salary_stops` (a log; nothing reads it, as before) |
| `spGetHrSalarySheet` + scratch table `MonthlyHrSalarySheet` | `GET /payroll/salary-sheets/:year/:month/preview`, worked out in the domain (`salaryLine()`), nothing saved |
| `SpInsertToApproveSalarySheet` → `ApprovedSalarySheets` | `POST …/approve` → `salary_sheets` + `salary_sheet_lines` |
| `CommitApprovedSalarySheetCommand` (`IsCommit`) | `POST …/commit` |
| `SpGetSalaryPaySlip` | `GET …/payslips/me`, `GET …/payslips/:staffId`, report `payroll.payslip` |
| `SpGetBanksalaryStatement(2)`, `SpGetCashsalaryStatement` | Report `payroll.salary-statement` (`mode`: `bank` / `cash`) |
| `spGetDeptWiseHrSalarySummary` | Report `payroll.department-summary` |
| `Reports/Kham` (`KhamDocument`) | Report `payroll.salary-envelope` |
| `spGetInActiveHrSalarySheet`, gross/LWP/overtime/punishment/deduction statements, `…Dynamic` variants | Data available through the sheet and the input lists (filters by person and month); printable variants can follow |
| Festival bonus inside the sheet (`FestivalBonuses`, basic ÷ 2) | Step 5c: approved bonuses paid with salary |
| Income tax (`IndividualSalariesIncomeTax.NetTaxPayablePerMonth`) | Step 5d; the column is 0 until then |
| `EmployeeSalaryStops` / `spGetSalaryStopEmployee` | Not ported: a Bellevue table FAK does not have |

## The sheet (one line per person)

Who is on it: staff who are active now, have a salary structure and joined by the end of the month (the old
procedure also listed people who had not joined yet; they are left out).

| Column | Rule (all whole taka) |
|---|---|
| Basic, house rent, medical, conveyance, other allowance | From the salary structure |
| Gross | Their sum (= the structure's gross) |
| Allowance, special allowance | Sums of the month's allowance payments (the structure's special allowance is **not** paid, as in the old sheet) |
| Overtime | gross ÷ (days of the **previous** month × 8) × hours + fixed overtime amounts |
| Festival bonus | Approved festival bonuses marked "pay with salary" for this month ([step 5c](05c-payroll-bonus-ledgers.md)) |
| Arrear | Arrear records + increment arrears of the month; someone who joined during the month has gross ÷ days × (joining day − 1) taken off here |
| Total payable | gross + allowance + special + arrear + overtime + bonus |
| PF | From the structure (0 when PF is off) |
| Income tax | 0 until step 5d |
| LWP | gross × LWP days ÷ days of the month |
| Punishment | Punishments + the deduction record's "other deduction" |
| Total deduction | punishment + LWP + PF + income tax |
| Net payable | total payable − total deduction, never below 0 |
| Advance, paid | Shown only; not subtracted (as in the old sheet) |

The old deduction record also has AIT, SM, mobile and food bills, loan and advance salary. The old sheet
ignored them; they are stored but still ignored (see open questions).

## Approve and commit

* **Preview** works the sheet out now and saves nothing.
* **Approve** saves the lines, with each person's details as they were (name, department, bank account), so
  later HR changes do not alter a past sheet. Approving again replaces the saved sheet (the old
  "re-approve") until it is committed.
* **Commit** makes the sheet final. From then on the month's overtime, deductions, punishments, arrears and
  allowance payments cannot be added, changed, moved out of the month or deleted (409 `pay_period_closed`),
  increments cannot be applied or reversed for it, and approving again is refused (409
  `salary_sheet_committed`). Salary payments can still be recorded, as they happen after the commit.
* Payslips, payment statements, the department summary and envelopes read the saved sheet (404 before
  approval). The salary sheet report prints the saved sheet, or a draft marked "not approved".

The record toolkit gained a `guard` hook for this: a check run inside the transaction with the old and new row
before every write.

## Permissions

`payroll:read` and `payroll:manage` from 5a. People see their own payslip through
`GET /payroll/salary-sheets/:year/:month/payslips/me`; the payslip report also lets people print their own
(others need `payroll:read`), once their role has the report.

## Endpoints (under `/api/v1`)

| Method and path | Access |
|---|---|
| `… payroll/overtimes`, `… payroll/deductions`, `… payroll/punishments`, `… payroll/arrears`, `… payroll/allowance-payments`, `… payroll/salary-payments` (`GET` with `staffId`, `payYear`, `payMonth`; `POST`; `GET/PATCH/DELETE /:id`) | read / manage |
| `… payroll/salary-stops?staffId=` | read / manage |
| `GET payroll/salary-sheets/:year/:month/preview?departmentId=` | `payroll:read` |
| `GET payroll/salary-sheets/:year/:month?departmentId=` (saved) | `payroll:read` |
| `POST payroll/salary-sheets/:year/:month/approve` → `{ lines, netPayable }` | `payroll:manage` |
| `POST payroll/salary-sheets/:year/:month/commit` | `payroll:manage` |
| `GET payroll/salary-sheets/:year/:month/payslips/me`, `…/payslips/:staffId` | own / `payroll:read` |

Reports: `payroll.salary-sheet` (Legal landscape, by department with totals and amount in words; PDF +
Excel), `payroll.payslip`, `payroll.salary-statement` (bank with account numbers, or cash; signature column),
`payroll.department-summary`, `payroll.salary-envelope` (9 × 4 in, one envelope per page, for the approved
net pay). Reports gained a `paper` size option for the envelopes.

## Old → new routes

| Old | New |
|---|---|
| `GET api/v1/StaffOvertimes/GetAllData/{payMonth}/{payYear}`, `POST`, `DELETE {id}` | `/payroll/overtimes?payYear=&payMonth=` |
| `GET api/v1/StaffSalaryDeductions/get-data/{month}/{year}`, `POST`, `DELETE` | `/payroll/deductions?payYear=&payMonth=` |
| `GET api/v1/SalaryPunishments/get-monsth/{m}/{y}`, `POST`, `DELETE` | `/payroll/punishments?payYear=&payMonth=` |
| `GET api/v1/ArrearRecords/get-data/{m}/{y}`, `POST`, `DELETE` | `/payroll/arrears?payYear=&payMonth=` |
| `GET api/v1/AllowancePayment/get-data/{m}/{y}`, `POST`, `DELETE` | `/payroll/allowance-payments?payYear=&payMonth=` |
| `GET/POST/DELETE api/v1/StaffMonthlySalaryRecords` | `/payroll/salary-payments` |
| `GET api/v1/SalaryStartStopRecord/get-data/{m}/{y}`, `POST`, `DELETE` | `/payroll/salary-stops` |
| `POST api/v1/Salary/SalarySheet`, `…/SalarySheet/report` | `GET /payroll/salary-sheets/:y/:m/preview`, report `payroll.salary-sheet` |
| `POST api/v1/ApprovedSalarySheet/ApproveReApprove`, `POST api/v1/ApprovedSalarySheet` | `POST /payroll/salary-sheets/:y/:m/approve` |
| `GET api/v1/ApprovedSalarySheet/Commit` | `POST /payroll/salary-sheets/:y/:m/commit` |
| `GET api/v1/ApprovedSalarySheet`, `DELETE {id}` | `GET /payroll/salary-sheets/:y/:m` (lines are not deleted one by one) |
| `POST api/v1/Salary/EmployeWiseSalary`, `…/EmployeeSalary` | payslip endpoints / report |
| `POST api/v1/Salary/BanksalaryStatement2`, `…/CashsalaryStatement` | report `payroll.salary-statement` |
| `POST api/v1/Salary/DeptWiseHrSalary` | report `payroll.department-summary` |
| `POST api/v1/Salary/Kham`, `api/v1/Reports/Kham` | report `payroll.salary-envelope` |

## Data migration notes (step 13)

* `ApprovedSalarySheets` rows become saved sheets per month (status `committed` when `IsCommit`), with staff
  details taken from the staff record at migration time.
* `StaffSalaryDeductions.Punishment` / `PunishmentComment` move to `salary_punishments`.

## Open questions

1. Should AIT, mobile and food bills, loan and advance salary from the deduction record be deducted? The old
   sheet ignored them, so salaries paid so far did not include them.
2. Should the structure's special allowance be paid every month? The old sheet paid only allowance payments.
3. Should advances paid be subtracted from net pay?
4. Should a salary stop (`salary_stops`) keep the person off the sheet until restarted?
5. Overtime is priced on the previous month's days; confirm.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 196 passed — new `test/unit/payroll/salary-sheet.spec.ts` (all columns of a line, mid-month
  joiner, net floor at 0, joined after the month, January overtime on December)
* `npm run test:int`: 16 passed (migration set now 11)
* `npm run test:e2e`: 69 passed — new `test/e2e/payroll-sheet.e2e-spec.ts` (inputs, duplicate deduction, LWP
  dates, preview numbers incl. a mid-month joiner, permissions, commit before approval refused, approve,
  re-approve after a change, own payslip vs. others, commit, frozen inputs incl. moving out of the month and
  delete, payments still allowed, other months open, re-approve and increments refused, all reports)
* Visual check of the sheet (Legal landscape, Bangla names), payslip and envelope; dev server migrated,
  restarted, all 61 payroll routes mapped
