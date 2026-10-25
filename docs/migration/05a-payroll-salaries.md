# Step 5a — Payroll: salary structure and increments

Status: **done** (2026-10-25). Previous: [step 4e](04e-hr-recruitment.md) · Next: [step 5b](05b-payroll-salary-sheet.md) (monthly salary).

Payroll is large in the old system (23 tables, 114 feature files and about 60 stored procedures), so it is
split like HR:

| Step | Content |
|---|---|
| **5a** | Salary policies, each person's salary structure, yearly increments (this step) |
| 5b | Monthly salary: overtime, deductions, punishments, arrears, allowances, salary stop/start, the salary sheet, approval, payment, payslip, bank/cash statements, salary envelope (`Kham`) |
| 5c | Festival bonus, leave encashment, PF ledger, staff global ledger |
| 5d | Income tax (tax slabs, certificates, TDS/VAT), PF book |

## Where the old logic lives

Most payroll logic is not in the C# code but in SQL Server procedures, which the API repository does not
contain. On 2026-08-24 FAK replaced its payroll procedures with the Bellevue ones
(`FouadAlKhateeb_CoxBazar/database/2026-08-24/09_Replace_HR_Payroll_SPs_With_Bellevue.sql`), so the Bellevue
scripts (`Bellevue_New_UIUX/…/PMCH_To_BelleVue_Migration/Payroll/04_StoredProcedures`) are the reference
for this port. The salary split itself was done by the Blazor screens
(`Pages/Payroll/IndividualSalary`, `IncrementRecord`), not the API.

## Scope

| Old | Outcome |
|---|---|
| `Payroll.GeneralSalaryPolicies` | Simple record `salary_policies`; the conveyance cap (hard-coded 2,500 in the screens) is now a policy field |
| `Payroll.SalaryEvaluationDurations` | Simple record `salary_review_cycles` (a label; nothing computed from it) |
| `Payroll.IncrementTypes` (rows "Percentage(%)", "Fixed", "Individual", matched **by name** in SQL and screens) | `incrementMethod` on the salary: `percentage`, `fixed`, `individual` |
| `Payroll.IndividualSalaries` (+ `ViewIndividualSalaries`) | `staff_salaries`, one per person; the split is now worked out by the server |
| `Payroll.IncrementRecords` + `CommitIncrementCommand` + `ReverseIncrementCommand` | `salary_increments` with the salary before each increment; commit and reverse per pay month |
| `spGetEligibleEmployeeListForIncrement` | `GET /payroll/increments/candidates` |
| `IncrementStatementEmployeeWise` | Report `payroll.increment-statement` |
| Individual salary list / Excel export | Report `payroll.salary-structure` |
| `Payroll.TaxSlabs`, `TaxableAmount` use | Step 5d (`taxableAmount` is kept on the salary) |
| `SalaryStartStopRecords` | Step 5b |

## Salary split (old salary screen)

From the gross and the policy:

* basic = gross × basic % (whole taka)
* house rent = basic × house-rent %, medical = basic × medical % (whole taka)
* the remainder is **conveyance** up to the policy's cap, and **other allowance** above it
* PF and CPF = basic × PF % / CPF % when PF is on for the person, else 0

Amounts are rounded to whole taka with halves away from zero (the old `MidpointRounding.AwayFromZero`);
paisa in the gross stay in conveyance/other, so the parts always add up to the gross. A policy whose
basic, house rent and medical add up to more than the gross is refused. Special allowance, the old
"Others", overtime rate per hour and the taxable amount are entered as they are.

Old column names `HouseRentInPercentOfBasic` and `MedicalAllownceInPercentOfBasic` held **amounts**; the new
columns are `house_rent` and `medical`.

## Increments

* **Who is due** (old procedure): active people with a salary whose joining anniversary fell in the month
  before the pay month, after at least one full year (joined March 2023 → increment with April 2026 salary).
  The old procedure also joined increment records with a condition that never matched, so its "last
  increment" date and its second branch (13 months since the last increment) never returned anything; they
  are not ported. A hard-coded excluded employee number (`PH01610`) is not ported either.
* **Amount by method**: `percentage` → the person's increment % (the old procedure always used 10 %, now the
  default) of basic + house rent + medical; `fixed` → the person's fixed increment; `individual` → entered
  when applying.
* **Arrear** for the anniversary month: increment ÷ days of the month before the pay month × days from the
  joining day to the end of the joining month (joined 10 March → 22/31). Increments given to someone who is
  not due get no arrear unless one is entered. The arrear is paid with the salary of the pay month (5b).
* **Applying** raises the gross by the increment and splits it again with the person's policy (as the old
  screen did). Each increment stores the salary before it. One increment per person per pay month (409
  `increment_exists`). Applying a batch is all or nothing.
* **Reverse** undoes the month's pending increments by restoring each stored salary exactly (the old code
  recomputed it from the gross, losing manual changes). If a salary was changed after its increment, nothing
  is reversed and the people are named (409 `salary_changed_since_increment`).
* **Commit** marks the month's pending increments final; committed increments are not reversed.

## Permissions

| Key | Allows |
|---|---|
| `payroll:read` | Everyone's salary, increments and candidates |
| `payroll:manage` | Policies, review cycles, setting and revising salaries, applying/committing/reversing increments |

Salaries are confidential: unlike HR masters, only payroll staff list them. People see their own salary
through `GET /payroll/salaries/me` (linked staff record). Policies and review cycles hold no personal data and
can be read by anyone signed in.

## Module boundary

Payroll is its own module. It reads staff details (number, name, department, designation, joining date,
status) through a new shared contract, **`StaffDirectory`**, published by the HR module; it never queries HR
tables. Lists are joined in memory, which suits a hospital's staff count (thousands at most).

## Endpoints (under `/api/v1`)

| Method and path | Access |
|---|---|
| `GET/POST/PATCH/DELETE payroll/salary-policies[/:id]` | read: signed in; write: `payroll:manage` |
| `GET/POST/PATCH/DELETE payroll/salary-review-cycles[/:id]` | read: signed in; write: `payroll:manage` |
| `GET payroll/salaries?departmentId=&policyId=&q=&page=&pageSize=` | `payroll:read` |
| `GET payroll/salaries/me` | own |
| `GET payroll/salaries/:staffId` | own or `payroll:read` |
| `PUT payroll/salaries/:staffId` `{ gross, policyId, pfEnabled, specialAllowance, otherFixed, overtimeRatePerHour, taxableAmount, incrementMethod, incrementPercent, fixedIncrement, reviewCycleId }` | `payroll:manage` |
| `PATCH payroll/salaries/:staffId` `{ version, …any of the above }` (409 `stale_salary` on an old version) | `payroll:manage` |
| `GET payroll/increments?year=&month=&staffId=&departmentId=&status=` | `payroll:read` |
| `GET payroll/increments/candidates?year=&month=` | `payroll:read` |
| `POST payroll/increments` `{ year, month, entries: [{ staffId, amount?, arrear? }] }` | `payroll:manage` |
| `POST payroll/increments/commit`, `POST payroll/increments/reverse` `{ year, month }` | `payroll:manage` |

Reports: `payroll.salary-structure` (`departmentId?`; by department with totals; PDF + Excel) and
`payroll.increment-statement` (`year`, `month`, `departmentId?`; previous gross/basic, increment, arrear,
gross after; PDF + Excel).

## Old → new routes

| Old | New |
|---|---|
| `GET/POST api/v1/GeneralSalaryPolicies` | `/payroll/salary-policies` |
| `GET api/v1/SalaryEvaluationDuration` | `/payroll/salary-review-cycles` |
| `GET/POST/DELETE api/v1/IncrementTypes` | `incrementMethod` on the salary |
| `GET api/v1/IndividualSalaries` | `GET /payroll/salaries`, `GET /payroll/salaries/:staffId` |
| `POST api/v1/IndividualSalaries` (`Id = empty` creates) | `PUT /payroll/salaries/:staffId` (create), `PATCH` (revise) |
| `GetEligibleEmployeeListForIncrementQuery` (sent in-process by the Blazor screen; no API route) | `GET /payroll/increments/candidates` |
| `POST api/v1/IncrementRecord/GetAllByYearMonth` | `GET /payroll/increments?year=&month=` |
| `POST api/v1/IncrementRecord` + `POST api/v1/IndividualSalaries` per person (done by the screen) | `POST /payroll/increments` |
| `POST api/v1/IncrementRecord/Commit`, `…/Reverse`, `DELETE api/v1/IncrementRecord/{id}` | `POST /payroll/increments/commit`, `…/reverse` (per pay month) |
| `POST api/v1/IncrementRecord/PrintTaxCertificateNew` | step 5d |
| Increment statement report | `POST /reports/payroll.increment-statement/render` |

## Data migration notes (step 13)

* `IncrementTypes` names map to methods: "Percentage(%)" → `percentage`, "Fixed" → `fixed`, anything else →
  `individual`. `FixedAmount` → `fixedIncrement`.
* Existing salaries are loaded with their stored split as it is (not recomputed).
* Old increment records do not keep the salary before them. Migrated increments are loaded as `committed`
  (never reversed), with the gross before taken as the gross after minus the increment.

## Open questions

1. Should the percentage increment be on basic + house rent + medical (old) or on the gross?
2. The 10 % default and the 2,500 conveyance cap are now settings; confirm the values for FAK.
3. Should salary structures keep a dated history (effective from a month) instead of one current structure
   plus increments?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 193 passed — new `test/unit/payroll/salary.spec.ts` (split with cap and paisa, rounding,
  impossible policy, due rule incl. January, arrear, each method, increase and exact undo); the architecture
  test caught a direct HR table join, which led to the `StaffDirectory` contract
* `npm run test:int`: 16 passed (migration set now 10)
* `npm run test:e2e`: 68 passed — new `test/e2e/payroll.e2e-spec.ts` (policy name and percentage checks,
  split, duplicate salary, stale version, own salary vs. others, search, policy in use; candidates with
  amount and arrear, individual method needs an amount, apply, duplicate increment, exact reverse, reverse
  refused after an edit, commit, reports PDF + Excel)
* Visual check of the salary structure report; dev server migrated, restarted, all 20 payroll routes mapped
