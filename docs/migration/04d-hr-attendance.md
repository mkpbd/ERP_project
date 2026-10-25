# Step 4d — HR: attendance

Status: **done** (2026-10-25). Previous: [step 4c](04c-hr-roster.md) · Next: [step 4e](04e-hr-recruitment.md) (recruitment).

## Scope

| Old API | Outcome |
|---|---|
| `HR.TimedAttendanceLogs`, `HR.AttendanceRecord` (+ `AttendanceRecordController`, `AttendanceController.FromotherDB` pulling from the device database) | `attendance_punches`: raw punches pushed by a device integration through `POST /hr/attendance/punches` |
| `HR.ManualAttendances` (+ `ManualAttendanceWorkflowCommand`, `ManualAttendanceRules.Evaluate`, `GetManualAttendanceContextQuery`) | `manual_attendances` with the same draft → pending → approved / rejected / cancelled workflow and the same day checks |
| `HR.ManualAttendanceLogs` | The audit log (`manual_attendance.created/edited/submitted/approved/rejected/cancelled`) |
| Daily status that the old reports worked out in SQL | `attendanceDay()` in the domain: one rule set for the API and every report |
| Reports `DailyAttendance`, `MonthlyAttendance`, `AttendanceReportSummary`, `FingerPrintReport28/29/30/31` | `hr.attendance-daily`, `hr.attendance-monthly` (one month report replaces the four month-length variants) |
| Reports `AttendanceReportEmployeeWise` (+ `…ForEdit`), `IndividualAttendanceReport`, `EmployeePunchHistory` | `hr.attendance-individual` (days + raw punches) |
| `HR.DutyRoasterSettings` (per-person in/out times, `LateMinuteApproved`) | **Not ported**: nothing in the old code read it any more. Lateness now comes from the roster shift plus the grace minutes in the leave policy (see open questions) |

## Model

* A **punch** is a biometric number, a machine number and an instant (`punched_at`, sent with an explicit
  offset). It is linked to a staff record through `staff_records.biometric_enrollment_no`. A punch whose number
  matches nobody is **kept** (`staff_id` null) and reported back as unmatched; once someone is given that
  number, those punches count for them. The same number at the same instant is stored once, so a device can
  resend a batch safely.
* A **manual entry** is one person, one date, a local in time and/or out time (`HH:mm`), a reason and a
  workflow status. At most one live (not cancelled) entry per person and day.
* The **day status** is computed, not stored:

  | Precedence | Status |
  |---|---|
  | 1 | `leave` — approved leave covers the day (from step 4b) |
  | 2 | `day-off` — a roster day off, or the person's weekly holiday on a day without duty |
  | 3 | `holiday` — a government holiday on a day without duty (with a duty, the person is expected) |
  | 4 | `absent` — no punches and no approved manual entry |
  | 5 | `late` / `present` — late when the first in is more than the grace minutes after the shift start |

  In = first punch, out = last punch (when there are at least two). An approved manual entry **replaces** the
  punches for that day (`source: "manual"`). The result also carries late, early-out, worked and overtime
  minutes.
* **Which punches belong to a day:** from 4 hours before the first shift start to 6 hours after the last shift
  end, so a night shift's 08:00 out punch counts for the night it started. Without a duty, the local calendar
  day (`REPORT_TIME_ZONE`, default Asia/Dhaka).
* **Grace minutes:** the person's own leave policy if assigned, else the year's policy (`late_grace_minutes`,
  step 4b), else 0.
* The old free-text weekly holiday (`"Friday"`, `"Fri, Sat"`) is read as weekday names.

## Rules (ported from `ManualAttendanceRules`)

| Rule | Error |
|---|---|
| In time, out time or both; `HH:mm`; out after in | `Enter the in time, the out time or both` / overnight message |
| Reason 1–500 characters | `Give the reason for the manual entry (1-500 characters)` |
| Person must be active | `The staff member is not active; attendance cannot be entered` |
| Today or earlier (organization time zone) | `Attendance can only be entered for today or earlier` |
| Not on a day covered by approved leave | `Approved leave (Casual leave) covers this day; cancel or shorten the leave first` |
| One live entry per person and day | `A manual entry (pending) already exists for this day; edit or cancel that one` |
| Warning only: punches exist / it is a day off | shown by `GET …/manual/context` |
| Edit only while draft or rejected | `This entry is approved and cannot be edited` |
| Approve/reject: not the creator, not the submitter, not your own attendance | 403 `self_review` |
| Reject and cancel need a reason; cancelling an **approved** entry (revoking it) needs `attendance:approve` | |
| Every action sends the entry's `version`; a stale one is refused | 409 `stale_manual_attendance` |

The day checks are re-run on create, submit and approve, so leave approved in the meantime still blocks.
Entries for one person are serialized with an advisory lock.

Punch ingestion: up to 5,000 punches per call; punches more than 5 minutes in the future are refused.

## Permissions

| Key | Allows |
|---|---|
| `attendance:read` | Daily status of everyone, anyone's attendance and punches, manual entry list |
| `attendance:enter` | Create, edit, submit and cancel (not approved) manual entries |
| `attendance:approve` | Approve, reject, revoke approved entries |
| `attendance:ingest` | Push device punches (give it to the integration's service account only) |

Your own attendance (`/hr/attendance/me`, or `/staff/:id` for your linked staff record) needs only sign-in.

## Endpoints (under `/api/v1`)

| Method and path | Access |
|---|---|
| `POST hr/attendance/punches` `{ punches: [{ biometricNo, machineNo, punchedAt }] }` → `{ received, accepted, duplicates, unmatchedBiometricNos }` | `attendance:ingest` |
| `GET hr/attendance/daily?date=&departmentId=&subDepartmentId=` | `attendance:read` |
| `GET hr/attendance/me?from=&to=` (≤ 62 days) | own |
| `GET hr/attendance/staff/:id?from=&to=`, `GET hr/attendance/staff/:id/punches?from=&to=` | own or `attendance:read` |
| `GET hr/attendance/manual?status=&staffId=&departmentId=&from=&to=&page=` | read, enter or approve |
| `POST hr/attendance/manual` `{ staffId, date, inTime, outTime, reason, submit }` | `attendance:enter` |
| `GET hr/attendance/manual/context?staffId=&date=&inTime=&outTime=&excludeId=` → `{ errors, warnings, preview }` | read, enter or approve |
| `GET hr/attendance/manual/:id`, `PATCH hr/attendance/manual/:id` `{ version, inTime, outTime, reason }` | read / `attendance:enter` |
| `POST hr/attendance/manual/:id/{submit,approve,reject,cancel}` `{ version, remarks }` | per the rules above |

Reports (`POST /reports/<key>/render`, PDF or Excel):

* `hr.attendance-daily` (`date`, optional department/sub-department): every active person with shift, in, out,
  late, worked minutes, status, plus status counts.
* `hr.attendance-monthly` (`year`, `month`, scope): a letter per day (P, L, A, LV, O, H) and month totals;
  Legal landscape.
* `hr.attendance-individual` (`staffId`, `from`, `to` ≤ 62 days): day-by-day statement and raw punches.

## Old → new routes

| Old | New |
|---|---|
| `POST api/v1/AttendanceRecord` | `POST /hr/attendance/punches` |
| `POST api/v1/Attendance/FromotherDB` (pull from device DB by date) | the device side pushes to `POST /hr/attendance/punches` |
| `GET api/v1/ManualAttendance` | `GET /hr/attendance/manual` |
| `POST api/v1/ManualAttendance` (add/edit) | `POST /hr/attendance/manual`, `PATCH /hr/attendance/manual/:id` |
| `POST api/v1/ManualAttendance/workflow` | `POST /hr/attendance/manual/:id/{submit,approve,reject,cancel}` |
| `GET api/v1/ManualAttendance/context` | `GET /hr/attendance/manual/context` |
| `GET api/v1/ManualAttendance/{id}/logs` | `GET /audit-logs?resourceType=manual_attendance&resourceId=` |
| `GET api/v1/ManualAttendance/permissions` | the user's permissions from `GET /users/me` |
| `DELETE api/v1/ManualAttendance/{id}` | `POST /hr/attendance/manual/:id/cancel` (kept for the audit trail) |
| `POST api/v1/Report/AttendanceReportEmployeeWiseForEdit`, `GET api/v1/HRReport/print/AttendanceReportEmployeeWise` | `GET /hr/attendance/staff/:id` (data), `POST /reports/hr.attendance-individual/render` (print) |
| Daily / monthly / summary / FingerPrint28–31 reports | `POST /reports/hr.attendance-daily/render`, `POST /reports/hr.attendance-monthly/render` |

## Open questions

1. **Weekly holiday** is still free text on the staff record. Should it become a weekday list (and should a
   duty on that day count as overtime)?
2. **Grace minutes** come from the leave policy, as in the old `LeavePolicy.LateGraceMinutes`. Per-shift grace
   or the old `DutyRoasterSettings.LateMinuteApproved` (per person and day) can be added if HR uses it.
3. **Punch window** (4 h before / 6 h after the shift) is a choice made here; the old SQL used the calendar day,
   which split night shifts. Confirm with HR.
4. **Holiday with a duty**: a person rostered on a government holiday is expected to come (absent otherwise).
   Should holiday duty be paid extra in payroll (step 5)?
5. The **device integration** (ZKTeco or similar) needs a small push agent; the old pull from the device's
   database is not ported.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 186 passed — new `test/unit/hr/attendance.spec.ts` (grace, late/early-out/overtime, status
  precedence, manual entry replacing punches, night-shift window, weekly holiday text, multi-day computation,
  manual time validation, workflow, self-review, reasons, revoke permission, day checks)
* `npm run test:int`: 16 passed (migration set now 8)
* `npm run test:e2e`: 63 passed — new `test/e2e/attendance.e2e-spec.ts` (idempotent ingestion, unmatched
  numbers linked later, ingest permission, roster shift + grace → present/late/absent with minutes, own vs.
  other access, daily list, full manual workflow with stale version, self-approval refusal, revoke, audit
  trail, future/leave/duplicate blocks, context endpoint, daily/monthly/individual reports PDF + Excel)
* Visual check of the monthly grid (Bangla names render); dev server migrated, restarted, all 14 attendance
  routes mapped
