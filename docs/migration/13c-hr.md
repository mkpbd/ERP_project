# Step 13c — Data migration: HR, salaries, leave and PF

Status: **done** (2026-10-30). Previous: [step 13b](13b-accounts-opening-balances.md) · Next: step 13d (catalogues,
suppliers and opening stock).

```
ETL_SOURCE_URL=… npm run etl -- --cut-over=2027-01-01 [--dry-run] [--only=staff-salaries,pf-openings]
```

The same `--cut-over` day as the books (13b) decides this year's leave and the PF openings. Without it, staff,
structure, salaries and leave policies come over and those two are left out (noted in the report).

## What comes over

| Old | New | How |
|---|---|---|
| `HR.Divisions`, `HR.Departments`, `HR.SubDepartments` | `hr_divisions`, `hr_departments`, `hr_sub_departments` | By name (sub-departments within their department) |
| `HR.Designations` | `designations` | By name, with joining salary and increment after confirmation |
| `HR.LeaveTypes` | `leave_types` | By name; codes made from the names (Casual Leave → `CL`, then `ML`, `ML2`…), Bangla name kept |
| `HR.StaffRecords` | `staff_records` | See the staff rules below |
| `Payroll.GeneralSalaryPolicies` | `salary_policies` | Percentages as they were |
| `Payroll.SalaryEvaluationDurations` | `salary_review_cycles` | By name |
| `Payroll.IndividualSalaries` (+ `IncrementTypes`) | `staff_salaries` | See the salary rules below |
| `HR.LeavePolicies` | `leave_policies` + an entitlement per leave type | See the leave policy rules below |
| `HR.IndividualEmployeeLeavePolices` + `…Eligibles` | `staff_leave_policies` + `staff_leave_entitlements` | Per person and year |
| Approved `HR.LeaveApplications` of the cut-over year | `leave_records` | See the leave taken rule below |
| `Payroll.PFLedgers` up to the cut-over | one `opening` PF entry per person | See the PF rule below |

**Staff** — everyone, former staff included:

* **Status:** separated staff come over `separated`, inactive ones `inactive` with their reason.
* **Separation day:** the old resignation day. When the old system had none, the day the record last changed is
  used, and the reason says so.
* **Kept:** employee numbers (upper-cased), structure and designation, joining designation, personal details,
  council numbers, working-time notes.
* **Values read the way 13a reads them:** sex, blood group, mobile.
* **Linked:** each person to the user account that was theirs (`Users.StaffRecordId`).
* **Sub-department:** staff with none go under a "General" sub-department of their department.
* **Biometric numbers:** a number another person has already is left out (noted).
* **Rejected:** deleted records, no employee number, no name, no joining day, an employee number taken, and a
  department or designation that did not come over.

**Salaries:**

* Amounts are taken as they were. The old "percent" columns of house rent and medical held amounts.
* The gross is the old total, or the sum of the parts when the total was not kept.
* PF and CPF are taken only where PF deduction was on.
* The increment method comes from the old increment type's name.

**Leave policies:**

* The old policy's fixed day columns (CL, ML, medical, annual, festival, government) become entitlements of the leave
  type whose name fits: casual, maternity, medical or sick, annual or earned, festival, govt.
* A column with days but no single fitting type is left out and noted.
* A year that already has a policy here is not changed.

**Leave taken.** This year's balances carry on:

* The old **approved** applications that touch the cut-over year become leave records of their type, cut to that
  year.
* Earlier years' leave stays in the old database.
* Old `HR.LeaveRecords` had no leave type and are not brought.

**PF.**

* Each person's old PF ledger balance before the cut-over (credits less debits) becomes one `opening` entry, dated
  the day before.
* This system's PF position adds no employer match on an opening, so the opening is the whole balance as the old
  ledger kept it.
* An overdrawn ledger comes over as a debit and is noted.

## Decisions (step 13b's open questions; "next" without answers, so the recommendations)

1. **Everyone comes over, former staff too**, separated or inactive, because final settlements and PF need them.
   Deleted records do not.
2. **Structure, designations, grades and salaries as they are**, matched by name.
3. **Leave:**
   * policies and individual entitlements come over;
   * the cut-over year's approved leave comes as leave records, so balances carry on;
   * earlier history stays in the old database.
4. **Staff are linked to their user accounts.** Doctor records are linked to users in 13a and are not staff records,
   so nothing links staff to doctors.
5. **PF balances open the PF ledger at the cut-over.** The old system had no staff loans table; what staff owe
   service units (`StaffGlobalLedgers`) is step 13e (dues).

## Not done here

* **Leave and HR history before the cut-over year.** Attendance, rosters, recruitment, earlier leave, increments,
  salary sheets, bonuses and tax: kept in the old database.
* **Profile photos, documents, education, emergency contacts, festival mapping, department in-charges and
  nationality countries.** They can follow in a later run if wanted.
* **Approval chains** (`LeaveApprovalSettings`): set up here per department.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. No new migration.
* `npm test`: 423 passed. New: `test/unit/data-migration/hr-records.spec.ts` covers:
  * staff made or rejected;
  * separation days (recorded or not) and inactive reasons;
  * leave type codes;
  * salaries (gross from the parts, PF only when on, increment methods);
  * policy columns matched to one leave type only;
  * leave cut to a year;
  * PF openings on their side.
* `npm run test:int`: 16 passed.
* `npm run test:e2e`: 159 passed. `test/e2e/data-migration.e2e-spec.ts` adds HR. A dry run and a real run with the
  same counts; a re-run writes nothing. It covers:
  * **Rejections:** a department without its division, deleted staff, staff without a number, a salary of someone
    not brought over, leave outside the year.
  * **Staff:** in the right sub-department or "General", linked to their user, separated with the noted day, a
    second biometric number left out.
  * **Salary:** as it was.
  * **Leave:**
    * leave type codes;
    * the policy with a festival column noted;
    * a person's own entitlement;
    * leave crossing into the year cut to its days in the year.
  * **PF:** the opening entry.
* Dev server restarted; readiness 200.
