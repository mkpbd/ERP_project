# Step 14c — Rehearsal 1: a dry run on the old QA copy

Status: **done** (2026-10-31). Previous: [step 14b](14b-clinical-history-rest.md) · Next: [step 15a](15a-operation-theatre.md).

The first rehearsal of the cut-over runbook ([13g](13g-cut-over-runbook.md)): the data migration read the whole
old database for the first time.

| | |
|---|---|
| Old database | `FAK_Cox_DB_LIVE_QA` on 202.5.43.193,1533 (the QA copy named in the old app's Development settings) |
| Login | The old app's SQL login. The old settings keep it encoded, and it is decoded in memory as the old app does |
| Here | A fresh database, `erp_rehearsal`, migrated for the run |
| Run | `--dry-run --cut-over=2026-11-01`: everything in one transaction, rolled back. Nothing kept |
| Old database | Read only. Nothing was changed there (as asked) |

**What stays out of the repository.** The connection is built by a wrapper outside the repository. The old
password, the user and the connection string were never printed, logged or saved.

## What it found in the code (fixed)

Every fault below passed the tests (they feed the loaders a fake old database) and showed only on the real one.

1. **`npm run etl` could not start.**
   * **Cause.** It ran through `tsx`, which emits no decorator metadata, so the app's dependency injection failed.
   * **Fix.** It now builds and runs the compiled tool, like `db:seed:dev`. `npm run etl:prod` runs the build
     alone, on a server.
2. **The SQL Server driver was not found.** `mssql` is CommonJS: from the compiled ES modules its exports sit under
   `default`.
3. **Pages overlapped.** Fixed in all six queries that had it: doctors, GL accounts, sub-ledgers, staff, pharmacy
   products, store items.
   * **Cause.** Where a query read a Guid key out as text under the same name (`CAST([Id] …) AS [Id]`),
     `ORDER BY [Id]` sorted by the text, while `WHERE [Id] > @after` compared Guids.
   * **Effect.** Pages overlapped and could skip rows. 3,696 pharmacy products were read twice in one run.
   * **Fix.** The queries now filter and sort on the table's own column (`t.[Id]`).
   * **Kept as a rule.** The paging helper says so.
4. **The connection dropped mid-run** (`ECONNRESET`), about an hour in, over the internet. Reads are now retried up
   to four times; they only read, so a retry is safe.
5. **Registration days never set** (`0001-01-01`) made birth days in year −29.
   * The registration day is now the day the row was saved.
   * The age-based birth estimate no longer goes before year 1.
6. **Mobiles.** Numbers written in **Bangla digits**, among words, or two in one field are now read; the first is
   taken.
7. **The chart.**
   * Two categories shared codes (04, 13). The second of each was rejected, and **71 rows of chart below them were
     lost**. Now the second gets a numbered code (`04-2`), noted.
   * 13 GL accounts had no code. They now get `OLD-<id>`, to be recoded here.
8. **Store items.** The old `SupplyChain.SubCategories` table is **empty**, so all 973 items were rejected. Items
   whose sub-category is gone now go under a "General" category and sub-category.
9. **Doctors' payables.** The old consultant ledger cannot say what each doctor is owed:
   * 28,635 of its 28,902 keys, holding 354.65 million owed, are ids of **no record at all**. The old OPD billing
     wrote shares against bill lines that were not kept (the fault noted in 9c).
   * The doctors' own rows are mostly payments.

   **Nothing is written**, and the report gives the totals: each doctor's payable is entered from Accounts.
10. **The error message.**
    * **Before.** On a failure the tool printed Drizzle's "failed query" with its values (patients' details).
    * **Now.** It prints the database's own error and the constraint, never the values.

## What it found in the data (to decide or to know)

| Area | Old | Comes over | Why the rest does not |
|---|---|---|---|
| Patients | 248,589 | about 147,000 | See the patients rule below |
| Lab reports | 363,042 | about 334,000 | Their patients were left out (above) |
| Prescriptions | 17,414 | 0 in this copy | See the prescriptions rule below |
| Discharge certificates | 76 | 0 | All 76 are blank in the old database |
| Doctors' payables | 28,902 ledger keys | none | Entered from Accounts (above) |
| Opening balances, admitted patients | — | none | This copy has no vouchers and no one admitted before 2026-11-01 |

**Patients left out:**

* 93,100 have **no usable phone**, of whom 51,146 have lab or admission history.
* 7,922 have no birth day or age.
* 175 have no sex that can be read.
* 58 UHIDs were taken twice.

As decided, the rules stay: a patient here needs a phone and a birth day. Those left out are listed in the
report, and their history stays in the old database.

**Prescriptions.** Every Rx visit names a UHID from 2023–2025 (`230302302` …). This copy's registrations start in
2026, so it holds the visits but not the patients. Check on a full copy of the live database.

**Accounts to finish here:** recode the `OLD-` GL accounts, set doctors' payables, and look at the numbered category
codes.

## Next

**Rehearsal 2** needs a **full, recent copy of the live database** (`FAK_COX_LiveDB2`), restored to a separate
server: the QA copy lacks the earlier patients and the books. Then, as in the runbook:

* dry run;
* real run;
* `--reconcile`;
* the spot checks.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
* `npm test`: 440 tests passed (mobiles in Bangla digits, among words, two in one field).
* `npm run test:int`: 16 tests passed.
* `npm run test:e2e`: 166 tests passed. The doctors' payables guard is covered: in the test the old ledger is keyed to
  doctors, so it writes.
* The dry run on the QA copy, again with the paging fix: all 73 loaders ran and nothing was kept. 5,414 pharmacy
  products were read (none twice) and 5,318 written.
