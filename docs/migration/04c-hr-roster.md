# Step 4c — HR: duty roster

Status: **done** (2026-10-25). Previous: [step 4b](04b-hr-leave.md) · Next: [step 4d](04d-hr-attendance.md) (attendance).

Roster and attendance were planned as one step; attendance (device punches, the manual-attendance approval
workflow, daily status and attendance reports) is its own step **4d**, and recruitment moves to **4e**.

## Scope

| Old API | Outcome |
|---|---|
| `HR.RoasterType` | Simple record `shift_types` (per department; `code`, `name`, local `start_time`/`end_time`) |
| `HR.DutyRoasterCalender` + `DutyRoasterCalenderDetail` (+ `Application/Features/HR/Roster/*`: `RosterEntryPlanner`, `RosterMonthCommands`, `RosterShiftTime`) | `roster_duties` + month view and cell-by-cell save with the old planner's rules |
| `EMR.Holidays` (a person's day off in the roster) | `staff_days_off` |
| `HR.DutyExchangeRecords` | Simple record `duty_exchanges` |
| `HR.OverManageDutyRecords` | Simple record `extra_duties` (extra days worked, and the days off given back) |
| `RoasterCalender/GetReport` (roster print) | Report `hr.duty-roster` (PDF grid on Legal landscape + Excel) |
| `HR.Roasters` (older roster table: name, department, shift type, times) | Not ported: superseded by the month roster in the old code itself |
| `HR.DutyRoasterSettings` (per-person/date in-out times, `LateMinuteApproved`) | **Step 4d** (it feeds lateness in attendance) |
| `OTName` | Step 5 (payroll overtime) |
| Old reports `DutyExchangeStatement`, `OverManageStatement` | Listed via the record endpoints (filters by person and period); printable statements can follow if needed |

## Model

* **Shift types** belong to a department and have local wall-clock times; an end before the start means the
  shift runs past midnight. Start = end is refused (the length would be ambiguous).
* A **duty** is one person, one date, one shift type. Its start and end are stored as real instants
  (`timestamptz`), computed in the organization time zone (`REPORT_TIME_ZONE`, default Asia/Dhaka — now used
  as the organization's local zone for rosters too). That makes overlap checks exact across days and months.
* A **day off** is one person, one date.
* Each duty also records the department/sub-department roster it was planned in, so past months still show
  under the right roster after someone moves.
* Old shared rows (`EmployeeIds` with several people in one row) are split into one row per person by the
  ETL; the old "legacy shared row" restrictions are therefore gone.

## Rules (ported from `RosterEntryPlanner`)

| Rule | Error |
|---|---|
| A cell holds duties **or** a day off, never both | `A day cannot hold both a duty and a day off` |
| Adding a duty or day off needs an active person placed in this department/sub-department (removing does not) | `… not active …` / `… does not belong to this department / sub-department` |
| The shift type must belong to the roster's department | `That shift type is not set up for this department` |
| One person's shifts must not overlap — including a night shift from the day before or into the next day, and duties in other departments. Shifts that only touch (one ends 08:00, the next starts 08:00) are fine. | `Shift M overlaps shift N on 2026-11-10` |
| The date must be inside the roster month | `The date is outside the roster month` |
| Remarks ≤ 500 characters | |
| **Optimistic concurrency:** each cell has a `version`; a save must send the version it loaded (`""` for an empty cell) or that cell is reported as `conflict` | `Changed by someone else …` |

A save sends up to 2,000 cells. Each cell is judged on its own and reported as `saved`, `unchanged`, `invalid`
or `conflict`; all valid cells are written in one transaction, so later cells in the same request see the
earlier ones (e.g. two overlapping cells in one save are caught). The people being changed are locked in a
fixed order, so two editors saving at once cannot double-book someone. One audit entry per save
(`roster.saved`, with the month and counts).

## Permissions

| Key | Allows |
|---|---|
| `roster:manage` | Shift types, saving roster cells, duty exchanges, extra duties |

Reading the roster, shift types, exchanges and extra duties needs only sign-in (staff look up their duty).
`GET /hr/roster/me` shows your own duties via your linked staff record.

## Endpoints (under `/api/v1`)

| Method and path | Access |
|---|---|
| `GET/POST/PATCH/DELETE hr/roster/shift-types?departmentId=` | read: signed in; write: `roster:manage` |
| `GET hr/roster/month?departmentId=&subDepartmentId=&year=&month=` | signed in |
| `PUT hr/roster/entries` `{ departmentId, subDepartmentId, year, month, entries: [{ staffId, date, shifts: [{ shiftTypeId, remarks }], dayOff, dayOffRemarks, expectedVersion }] }` | `roster:manage` |
| `GET hr/roster/me?from=&to=` (≤ 93 days) | own |
| `… hr/roster/duty-exchanges?staffId=&from=&to=`, `… hr/roster/extra-duties?staffId=&from=&to=` | read: signed in; write: `roster:manage` |

Report `hr.duty-roster` (`departmentId`, `subDepartmentId`, `year`, `month`): one row per person, one column
per day with shift codes or `OFF`, government holidays shaded, legend with shift times.

## Old → new routes

| Old | New |
|---|---|
| `GET/POST/DELETE api/v1/RoasterType` | `/hr/roster/shift-types` |
| `POST api/v1/RoasterCalender/Month` (`GetRosterMonthQuery`) | `GET /hr/roster/month` |
| `POST api/v1/RoasterCalender/Entries` (`SaveRosterEntriesCommand`) | `PUT /hr/roster/entries` |
| `GET/POST/DELETE api/v1/RoasterCalender` (older week-based header/detail) | `PUT /hr/roster/entries` |
| `POST api/v1/RoasterCalender/GetReport` | `POST /reports/hr.duty-roster/render` |
| `POST/DELETE api/v1/Holiday`, `POST api/v1/Holiday/GetByDates` | day off inside `PUT /hr/roster/entries`; read via `GET /hr/roster/month` or `/hr/roster/me` |
| `api/v1/DutyExchangeRecord`, `api/v1/OverManageDutyRecord` | `/hr/roster/duty-exchanges`, `/hr/roster/extra-duties` |
| `api/v1/Roaster` | not ported (see scope) |

## Open questions

1. Should a duty exchange also **swap the roster cells** automatically? The old code only kept a log; so does
   the new one.
2. Should extra-duty compensation days appear as days off in the roster automatically?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 176 passed — new `test/unit/hr/roster.spec.ts` (24-hour times, time-zone placement, overnight
  shifts, back-to-back vs. overlapping shifts, overlap with yesterday's night shift, keep/update/remove,
  duty-or-day-off, month/department/active checks, cell versions)
* `npm run test:int`: 16 passed (migration set now 7)
* `npm run test:e2e`: 59 passed — new `test/e2e/roster.e2e-spec.ts` (mixed save with per-cell results,
  cross-day overlap, wrong sub-department, conflict on a stale version, unchanged, month view, own roster,
  permission, shift-type validation, CHECK → 422, report PDF + Excel)
* Visual check of the roster grid; dev server migrated, restarted, report listed
