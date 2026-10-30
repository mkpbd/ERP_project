# Step 13g — Cut-over: rehearsals, reconciliation and the go-live runbook

Status: **done** (2026-10-31). Previous: [step 13f](13f-clinical-history.md) · Next: [step 14a](14a-access-and-discounts.md).
This closes step 13 and the port as planned; step 14 fills gaps step 13 left to set by hand.

This is the plan for the night the hospital moves from the old system to this one. It has three parts:

* the reconciliation that proves the move;
* two rehearsals before it;
* the steps of the night, the go/no-go and the way back.

## The reconciliation

```
ETL_SOURCE_URL=… npm run etl -- --reconcile --cut-over=2027-01-01
```

It sets the old system's own totals beside this system's, area by area. Each line **agrees**, needs an
**explanation** (records a loader reported leaving out), or **fails** (where nothing may differ).

| Area | What is compared |
|---|---|
| Records | Users, doctors, patients, staff, GL accounts, suppliers, pharmacy products, store items, lab reports, prescriptions: old count against those brought over |
| Books | **The trial balance, account by account**, old voucher lines before the cut-over against the books here on the day before. Fails beyond the opening's rounding (under one taka), or when an account with a balance was not brought over |
| Stock | Pharmacy units in date, old against the openings. Pharmacy stock value and each store item type's stock value against its inventory account |
| Admitted patients | Patients in their beds; the advances they had paid |
| Dues | Owed to doctors, owed by staff, owed by canteen members, PF held for staff |

**The verdict:**

* **go** when everything agrees;
* **go with notes** when only explanations are asked;
* **no go** when anything fails. The command then exits with an error.

**Logged and printed.**

* The result is logged in `etl_runs` (loaders `reconcile`) and listed under `GET /data-migration/runs` (permission
  **`migration:read`**, new).
* It is printed with the report **`data-migration.reconciliation`** (`{ runId }`). The print has lines for Accounts,
  IT and Management to sign.
* Any loader run's counts and notes are in `GET /data-migration/runs/:id`.

## Before the night

**1. Set up the new server once.**

* Migrations: `npm run db:migrate`.
* The first administrator: `npm run admin:bootstrap`.
* `REPORT_TIME_ZONE=Asia/Dhaka`.
* Check that the server's backups run.

**2. Ask the old server's DBA for a read-only login.**

* `SELECT` on the old schemas.
* `EXECUTE` on `[SupplyChain].[SpGetBrandExtensionCurrentStockBySubStore]`, for the store stock (13d).
* Keep the connection string only in `ETL_SOURCE_URL` on the machine that runs the tool. Never commit it.

**3. Set up what the loaders cannot.**

* At least one canteen outlet (13e).
* Fiscal years that do not overlap the old calendar years (13b).

**4. Rehearsal 1, on a copy.**

* Restore last night's backup of the old database to a separate server, and point `ETL_SOURCE_URL` at it.
* Use a fresh database here.
* Dry run:

  ```
  npm run etl -- --dry-run --cut-over=<first day of next month>
  ```

* Read every loader's rejections. Fix what should come over in the old system, or accept it in writing.
* Then the real run, then `--reconcile`.
* Go through each "explain" line with Accounts.

**5. Rehearsal 2, on a fresh copy and a fresh database.**

* The same steps, timed: the night is planned from this rehearsal's durations.
* Trial users open the system here and check what they know (see the spot checks below).

**6. Set up access here.**

* Grant roles their permissions here. Roles come over without permissions (13a).
* Set the posting roles not set from the old system (13b).
* Link bank accounts to their GL accounts.
* Give pharmacists their outlets and store users their stores.

## The freeze (the day before the cut-over)

Close in the old system before it stops:

* **purchase orders, requisitions, store indents and transfers:** received, served or cancelled (13d);
* **lab and imaging tests:** ordered tests reported and delivered, or cancelled and refunded (13e);
* **outpatient and diagnostic bills:** settled, or left as a due (they come over as the patient's balance, 13b);
* **cash:**
  * the day's cash and bank deposits posted;
  * no voucher left unposted;
  * the month's salary sheet approved and posted;
* **wards:** every advance for admitted patients entered, and every bed allocation correct.

## The night

The cut-over is the **first day of a month**: the books open on the last day of the old month.

| When | What | Who |
|---|---|---|
| 20:00 | **Freeze.** Logins to the old system closed except IT. Counters and wards keep paper slips for the night | IT, all counters |
| 20:15 | Full backup of the old database, kept apart | DBA |
| 20:30 | Fresh database here: `npm run db:migrate`, `npm run admin:bootstrap`, the setup above | IT |
| 21:00 | `npm run etl -- --dry-run --cut-over=…`: rejections as in rehearsal 2 | IT |
| 21:30 | `npm run etl -- --cut-over=…` (the real run; may be repeated, nothing is written twice) | IT |
| after | `npm run etl -- --reconcile --cut-over=…`, printed | IT, Accounts |
| 06:00–09:00 | **Spot checks**, below | Each department |
| 09:00 | Sign the reconciliation | Accounts, IT, Management |
| **by 12:00** | **Go or no go** | Management |

**Spot checks** (each by the people who know the figures):

* **Patients:** ten known patients found by UHID, their history there (13f); a new registration gets the next UHID.
* **Wards:** each admitted patient in their bed, with the right advance; one stay's account looks right.
* **Accounts:** the trial balance at the old month's end prints and matches the old one; three party ledgers (a
  patient, a supplier, a corporate client) open at the old balance.
* **Pharmacy and stores:** stock of ten items per outlet and store counted on the shelf.
* **HR and payroll:** five staff with their salary, leave left this year and PF.
* **Sign-in:** five users with their old passwords (they are upgraded at first sign-in, 13a).

## Go live

* **Paper slips.** The night's paper slips are entered here: registrations, admissions, advances, sales.
* **The old system becomes read-only** for looking things up:
  * on the old database server, `ALTER DATABASE [<old>] SET READ_ONLY WITH ROLLBACK IMMEDIATE;`;
  * logins limited to a view-only role.
* Users are told the old system is for reading only.

## No go: the way back

1. Note what failed (the reconciliation's lines, the spot checks) with the rehearsal's notes.
2. **Reopen the old system:** logins back, and the database read-write if it was set read-only.
3. Enter the night's paper slips there.
4. Keep this system's database for finding the cause, then start the next attempt from a fresh one.
5. Try again **a week later**, after a rehearsal that passes. If that week crosses the month, the cut-over day is
   the next month's first.

## A year after

The old database stays **read-only for one year**. After that:

* take a final backup, kept twice (one off-site);
* detach the database;
* retire the old servers.

## Decisions (step 13f's open questions; "next" without answers, so the recommendations)

1. **Two rehearsals** on copies of the old database, each with a dry run, a real run and the reconciliation, before
   the night.
2. **An overnight freeze** (about 12 hours), on the night before the first day of a month.
3. **A side-by-side reconciliation, printed for Accounts, IT and Management to sign.**
4. **The old system stays read-only for a year**, then is archived.
5. **Go or no go by noon of the first day.** On no go, back to the old system the same day and another attempt a
   week later.

## What step 13 brought over (in short)

| Part | What |
|---|---|
| [13a](13a-data-migration-framework.md) | The tool; users and roles (old passwords work), specialities, doctors, patients (UHIDs kept) |
| [13b](13b-accounts-opening-balances.md) | The chart of accounts and its masters; opening balances as one voucher, checked account by account |
| [13c](13c-hr.md) | HR structure, staff, salaries, leave policies and this year's leave, PF openings |
| [13d](13d-catalogues-stock.md) | Pharmacy and store catalogues, suppliers, opening stock per outlet and store |
| [13e](13e-open-documents-dues.md) | Wards and beds, patients still admitted, doctors' payables, staff and canteen dues |
| [13f](13f-clinical-history.md) | The clinical history, read-only, with lab results to follow over time |
| 13g (this) | Reconciliation, rehearsals, the night, go/no-go and the way back |

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
* The reconciliation print was checked by a screenshot of its HTML.
* `npm test`: 433 passed. New: `test/unit/data-migration/reconcile.spec.ts` covers:
  * agreeing to the paisa;
  * explanations;
  * strict failures;
  * the verdict.
* `npm run test:int`: 16 passed.
* `npm run test:e2e`: 163 passed. `test/e2e/data-migration.e2e-spec.ts` reconciles a loaded cut-over:
  * **Line by line:**
    * records left out explained;
    * the books' 0.01 rounding explained on account 3001;
    * stock, advances and dues agree.
  * **Verdict:** go with notes.
  * **In the app:**
    * the run is listed and shown;
    * the print renders;
    * a loader run is refused as a reconciliation.
* Dev server restarted; readiness 200.
