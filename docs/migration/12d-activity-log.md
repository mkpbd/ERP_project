# Step 12d — Activity log: summary, sign-in history, sessions, prints

Status: **done** (2026-10-30). Previous: [step 12c](12c-communication.md) · Next: [step 13a](13a-data-migration-framework.md).

Most of the old activity log was already here: the **audit log** that every module writes, searched with
`audit:read` (`GET /audit-logs`). The signed-in user's own sessions were here too.

This step adds:

* **The activity summary** over days (old `HealthSnapshot`):
  * actions per day, with failures, denials and active users;
  * per hour of day;
  * per module;
  * the most frequent actions and the most active users.
* **Sign-in history** of a user: successful and failed sign-ins, why one failed, from which address and browser.
* **A user's active sessions** for administrators.
* **Prints:** the audit log, the activity summary and the sign-in history (PDF and Excel).

## Where the old logic lives

CoxBazar, `Log` (`src/Core/Domain/Entities/Log/`):

* **`HisActivityLog`:** user, module, page, action, task, IP, machine, user agent, time, duration, success, error,
  old and new data, record key.
* **`UserActivityLog`:** user, activity type, module type, details, table.
* **`HealthSnapshot`:** a window's peak hour, totals, successes and failures, active users, per-module and per-page
  JSON, hourly load.

## Decisions (step 12c's open questions; "next" without answers, so the recommendations)

1. **Audit log print** (`audit.log`): the existing search over days, by user, action or outcome. Newest first, at
   most 5,000 entries; it says when the rest were left out.
2. **Activity summary** (`GET /audit-logs/summary`, `audit.activity`):
   * days and hours in the organisation's time zone;
   * a module is the part of the action before its first dot (`auth`, `user`, `clinical` …).
3. **Sign-in history** (`GET /audit-logs/sign-ins`, `audit.sign-ins`).
   * It comes from the `auth.login` entries the sign-in already writes: success, or failure with its reason
     (`invalid_password` …).
   * An auditor sees anyone's; a user sees their own.
   * **A user's sessions:** `GET /users/:id/sessions` with `users:read`. Before, administrators could only revoke
     them.
4. **No before-and-after data on changes** (old OldData / NewData). The audit entries keep what changed in their
   metadata, never secrets.
5. **The audit log is kept forever for now.** A retention period (with a daily purge) can come later as a setting.

Other decisions:

* **Periods.** A period runs from the start of its first day to the start of the day after its last, in the
  organisation's time zone. It is at most 366 days, and the start comes before the end (`invalid_period`).
* **No new tables.** Everything is read from `audit_logs` and the sessions.
* **Grouping by position.** The summary's per-day and per-hour counts group by column position: the time zone is a
  bound parameter, and the same expression in GROUP BY would not be taken as equal.

## API

| Endpoint | Who | What |
|---|---|---|
| `GET /audit-logs/summary?from=&to=` | `audit:read` | Totals; by day, hour, module; top actions and users |
| `GET /audit-logs/sign-ins?userId=&from=&to=` | `audit:read`, or the user themself | Sign-ins newest first: outcome, reason, IP, browser |
| `GET /users/:id/sessions` | `users:read` | The user's active sessions |

## Reports

* **`audit.log`** (`from`, `to`, `actorUserId`?, `action`?, `outcome`?): landscape PDF and Excel. Each entry shows
  when, the user's name, the action, the resource, the outcome and the IP.
* **`audit.activity`** (`from`, `to`).
  * PDF: totals, per day, per hour, per module, top actions, most active users.
  * Excel: the per-day table.
* **`audit.sign-ins`** (`userId`, `from`, `to`): the user, counts and each sign-in. PDF and Excel.

## Not ported here

* **Page names, durations, machine names and old/new data of every request** (old `HisActivityLog`). The audit log
  records security-relevant changes, not page views.
* **Missing-index and page-resource diagnostics of `HealthSnapshot`.** Database monitoring belongs to the database
  tools.
* **Audit retention and purge.**

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
* No migration (no new tables).
* `npm test`: 404 passed. New: `test/unit/audit/activity.spec.ts` covers the period bounds in the time zone, order
  and length.
* `npm run test:int`: 16 passed.
* `npm run test:e2e`: 155 passed. New: `test/e2e/audit-activity.e2e-spec.ts` covers:
  * **The summary:**
    * a day's totals with a failed sign-in;
    * modules and top actions;
    * refused without `audit:read`;
    * a backwards period refused.
  * **Sign-ins:**
    * success, failure with its reason, success;
    * seen by the auditor and by the user;
    * another's refused.
  * **Sessions:** a user's two sessions for the administrator; refused to others.
  * **Prints:** the audit log sheet filtered to sign-ins, and the three PDFs.
* Dev server restarted; readiness 200.
