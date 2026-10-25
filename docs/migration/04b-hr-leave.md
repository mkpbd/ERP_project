# Step 4b — HR: leave

Status: **done** (2026-10-25). Previous: [step 4a](04a-hr-staff-records.md) · Next: step 4c (roster and attendance).

## Scope

| Old API | Outcome |
|---|---|
| `HR.LeaveTypes` | Simple record `leave_types` (+ `code`, e.g. `CL`) |
| `HR.LeavePolicies` (one row per year, fixed `Cl`, `Ml`, `MedicalLeave`, `AnnualLeave`, `FestivalLeave`, `GovtLeave` columns) | `leave_policies` (year terms) + `leave_policy_entitlements` (one row per leave type) |
| `HR.IndividualEmployeeLeavePolices` + `IndividualEmployeeLeaveEligibles` | `staff_leave_policies` + `staff_leave_entitlements`: replaces the year's policy for one person |
| `HR.LeaveApprovalSettings` | Simple record `leave_approval_levels` (department, order, name, approver) |
| `HR.LeaveApplications` | `leave_applications` + aggregate `LeaveApplication` with a real workflow |
| `HR.LeaveApproveOnDifferentLevels` | `leave_application_approvals` (one row per decided level) |
| `HR.ApplicationPermissions` ("apply on behalf of") | Simple record `leave_delegates` |
| `HR.LeaveRecords`, `HR.MaternityLeaveRecords` | Simple record `leave_records` (maternity is a leave type); `days` is a generated column |
| Leave reports (`EmployeeLeaveReport`, `HRLeaveReport`, `EmployeeLeaveBalanceReport`, `LeaveRecordStatement`, `MaternityLeaveStatement`, `SpGet_EmployeeWise_LeaveStatement`, `SpGetEmployeewiseLeaveStatementSummary`) | `hr.leave-applications`, `hr.leave-balances`, `hr.leave-statement` |
| `LeavePolicies.LateConsiderAfterMins`, `OnedaySalaryDeductionForLateInDays`, `AbsentDeduction` | Kept on the policy (`lateGraceMinutes`, `lateCountPerDeduction`, `absentDeduction`); **used by attendance (4c) and payroll (5)** |
| `LeaveApplications.ApplicationInPdf`, `ApplicationInWord` (uploaded scans) | Deferred (see below) |

## Why the workflow is new code

In the old API, leave was plain CRUD: the **client** set `LeaveApprovalStatus` (a free string), computed
`TotalLeaveQTY`, and wrote the per-level approval rows itself. The remaining-balance and "applications for
me to approve" logic lived in stored procedures (`SpGetRemainingLeaveCalculation`,
`SpGetLeaveApplicationsByStaffId`, …) whose bodies are **not in the source repository**. Nothing on the server
stopped an applicant from approving their own leave or exceeding their balance. The rules below are therefore
designed here; each is listed so it can be checked against how HR actually works.

## Rules

| # | Rule |
|---|---|
| 1 | Days are **inclusive calendar days** (weekends and holidays count). |
| 2 | An application lies within **one calendar year**; leave over New Year is split into two applications. |
| 3 | The **effective policy** for a person and year is their own (`staff_leave_policies`) if HR set one, otherwise the organization's (`leave_policies`). No policy for the year → applying is refused (`no_leave_policy`). |
| 4 | A leave type **without an entitlement row** in the effective policy has **no limit** (e.g. leave without pay). |
| 5 | Balance = entitled − taken (approved applications + recorded leave) − **pending** (pending days are reserved, so two applications cannot spend the same days). Applying for more than remains → `insufficient_leave_balance`. |
| 6 | No overlap with the same person's pending/approved applications or recorded leave (`leave_overlaps`). Submissions for one person are serialized with a lock, so parallel requests cannot both pass the checks. |
| 7 | Only **active** staff can apply; the substitute must be someone else and active. |
| 8 | Who may apply: the person themselves (user linked to the staff record), a **delegate** (`leave_delegates`), or anyone with `leave:manage`. |
| 9 | The department's approval levels are walked **in order**. Only the approver configured for the **current** level may approve or reject; the approval chain length is fixed when the application is submitted. The **last** level's approval makes it `approved`. |
| 10 | An approver may **shorten** the period (never extend it); later levels start from the shortened period. |
| 11 | `leave:approve-any` lets HR decide at the current level (e.g. approver absent). **Nobody decides their own application.** |
| 12 | Rejection needs a reason and is final. |
| 13 | The applicant (or whoever submitted it) may withdraw a **pending** application; only `leave:manage` may cancel an **approved** one (days return to the balance). |
| 14 | Recorded leave (`leave_records`) is HR's direct entry (paper registers, maternity): it counts against the balance and blocks overlapping applications, but is not checked against the balance itself. |
| 15 | Every decision is audited (`leave.submitted/approved/rejected/cancelled`, `leave.policy_set/deleted`). |

Status values: `pending`, `approved`, `rejected`, `cancelled`. The ETL maps the old free-text
`LeaveApprovalStatus` values to these after looking at the distinct values in the live data.

## Permissions

| Key | Allows |
|---|---|
| `leave:read` | All applications, balances, policies, delegates and recorded leave |
| `leave:manage` | Policies, approval levels, delegates, recorded leave; apply for anyone; cancel approved leave |
| `leave:approve-any` | Decide any pending application at its current level (and view it) |
| `hr-masters:manage` | Leave types |

Without these, people see only what involves them: their own applications and balance, applications of
people they are a delegate for, and applications in departments where they are an approver.

## Endpoints (under `/api/v1`)

| Method and path | Access |
|---|---|
| `GET/POST/PATCH/DELETE hr/leave/types` | read: signed in; write: `hr-masters:manage` |
| `… hr/leave/approval-levels?departmentId=&approverStaffId=` | read: signed in; write: `leave:manage` |
| `… hr/leave/delegates?staffId=&onBehalfOfStaffId=` | `leave:read` / `leave:manage` |
| `… hr/leave/records?staffId=&leaveTypeId=&from=&to=` | `leave:read` / `leave:manage` |
| `GET hr/leave/applications?staffId=&departmentId=&status=&from=&to=` | `leave:read` |
| `POST hr/leave/applications` `{ staffId?, leaveTypeId, startDate, endDate, reason, substituteStaffId? }` | self, delegate or `leave:manage` |
| `GET hr/leave/applications/mine`, `GET hr/leave/applications/awaiting-me` | signed in (linked staff record) |
| `GET hr/leave/applications/:id` | involved people, `leave:read`, `leave:approve-any` |
| `POST hr/leave/applications/:id/approve` `{ startDate?, endDate?, remarks? }` | current level's approver or `leave:approve-any` |
| `POST hr/leave/applications/:id/reject` `{ reason }` | same |
| `POST hr/leave/applications/:id/cancel` `{ reason }` | applicant (pending) or `leave:manage` |
| `GET hr/leave/balance?year=` | own |
| `GET hr/staff/:id/leave-balance?year=` | own, delegate or `leave:read` |
| `GET hr/leave/policies`, `GET/PUT/DELETE hr/leave/policies/:year` | `leave:read` / `leave:manage` |
| `GET/PUT/DELETE hr/staff/:id/leave-policies/:year` | `leave:read` / `leave:manage` |

Reports: `hr.leave-applications` (`from`, `to`, `status`, `departmentId`), `hr.leave-balances` (`year`,
`departmentId`; one column per leave type, Excel with entitled/taken/remaining per type),
`hr.leave-statement` (`staffId`, `year`).

## Old → new routes

| Old | New |
|---|---|
| `api/v1/LeaveType` | `/hr/leave/types` |
| `api/v1/LeavePolicies` (per year) | `GET/PUT/DELETE /hr/leave/policies/:year` |
| `api/v1/IndividualEmployeeLeavePolicy`, `…LeaveEligible` | `GET/PUT/DELETE /hr/staff/:id/leave-policies/:year` |
| `api/v1/LeaveApprovalSettings` | `/hr/leave/approval-levels` |
| `api/v1/ApplicationPermission`, `StaffInform/GetStaffForLeaveApplicationPermissionByStaffId` | `/hr/leave/delegates` |
| `POST api/v1/LeaveApplications` (create/update incl. status) | `POST /hr/leave/applications` + `/approve`, `/reject`, `/cancel` |
| `GetLeaveApplicationByStaffId`, `GetLeaveApplicationByDatesAndPermission` | `GET /hr/leave/applications/mine`, `/awaiting-me`, `GET /hr/leave/applications?…` |
| `POST LeaveApproveOnDifferentLevel` | part of `/approve` / `/reject` |
| `GetRemainingLeaveCalculationByStaffId`, `GetYearlyRemaningLeaveDataByEmpNo` | `GET /hr/leave/balance?year=`, `GET /hr/staff/:id/leave-balance?year=` |
| `api/v1/LeaveRecord`, `MaternityLeaveRecord` | `/hr/leave/records` (maternity = a leave type) |
| `api/v1/Report/print/…Leave…` | `POST /reports/hr.leave-*/render` |

## Changes to earlier code

* The report layout now centres/right-aligns `th.center` / `th.num` (they were overridden).

## Deferred

* **Application attachments** (`ApplicationInPdf`, `ApplicationInWord`): add when needed, the same way as
  staff documents (PDF/image only; Word files are not accepted by the upload checks).
* `LeaveApplications.SentTo` (int) and `ExtraStartDate`/`ExtraEndDate`: their meaning is not visible in the
  backend; not ported. Confirm with the frontend whether they are still used.
* Weekend/holiday-aware day counting — only if HR counts leave in working days (open question 1).
* Notifications to the next approver (email/in-app) — when notifications for business events are added.

## Open questions

1. Are leave days counted as calendar days (assumed) or working days (excluding weekly holiday and
   government holidays)?
2. Which old `LeaveApprovalStatus` strings exist in the data (for the ETL mapping)?
3. Should a pending application of someone who changes department keep its original approval chain
   (current behaviour) or move to the new department's chain?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 167 passed — new `test/unit/hr/leave.spec.ts` (days, year split, balance reservation,
  unlimited types, policy validation, level order, narrowing, no widening, HR override, no self-approval,
  rejection, withdraw vs. cancel)
* `npm run test:int`: 16 passed (migration set now 6)
* `npm run test:e2e`: 57 passed — new `test/e2e/leave.e2e-spec.ts` with real users: two-level approval with
  narrowing and balance updates, overlap / balance / missing policy / year split / self-approval refusals,
  delegate submission, HR override, withdraw vs. cancel, recorded leave in the balance and overlap check,
  visibility for involved people only, per-person policy, all three reports (PDF + Excel)
* Visual check of the balances layout; dev server migrated, restarted, report rendered
