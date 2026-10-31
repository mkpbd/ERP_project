# Step 15e — Dashboards

Status: **done** (2026-10-31). Previous: [step 15d](15d-pharmacy-credit.md) · Next: [step 16e](16e-dashboard-screen.md) (the
dashboard screen).

The fifth gap of the page-by-page check: the old management and department dashboards, which the new system did not
have.

## Where the old logic lives

CoxBazar (`database/2026-10-24/ManagementDashboard/`, pages in `Components/Pages/DashboardComponent/`):

| Old page | Procedures | What it showed |
|---|---|---|
| `/infomation-dashboard` (management) | `SPGetManagementDashboardData`, `…Breakdown`, `fnMgmtDashboardCollection` | Collection by department, hospital sale, discount, due, admissions, OPD, diagnostic and pharmacy totals |
| `/marketing-infomation-dashboard` | `SPGetMarketingDashboardData`, `…Breakdown` | Running patients, admissions, bills by marketing officer and referring doctor |
| `/account-dashboard` | `SPGetAccountDashboardData`, `…Breakdown` | Cash in and refunds (from the collection function), supplier payments and purchases |
| `/pharmacy-dashboard` | `SPGetPharmacyDashboardData`, `…Breakdown` | Sales outdoor and indoor, discount, returns, collection, credit sales, purchases, stock, expiry |
| `/diagnostic-dashboard` | `SPGetDiagnosticDashboardData`, `…Breakdown` | Sales, discount, cancellations, due, collection, patients, tests by department |
| `/canteen-dashboard`, `/hr-dashboard`, `/scm-dashboard` | their `SPGet…DashboardData`, `…Breakdown` | Canteen food bills; staff and attendance; purchase orders and receipts |

One generic page drew whatever a procedure returned:

* tiles and cards, each a "head";
* a click opened the head's breakdown (by day, user, department, …);
* the same heads over the period before, as up/down percentages;
* a day trend of the first tile;
* Excel and PDF export.

**Faults of the old dashboards** (from the old README, LiveDB3, 1–20 August 2026):

* **Wrong figures.**
  * Collection was short by about 43 lakh: no advances, no due collections.
  * Admissions ignored the dates asked.
  * Indoor medicine and tests were counted twice in "all department sales".
* **Marketing showed nothing.** The heads joined on a doctor type that 835 of 836 doctors lacked.
* **Duplicated rules.** Each procedure copied the collection report's rules branch by branch. A change to one had
  to be made in the other.
* **One permission for all.** The menu grant showed everything, money included, to anyone given the page.

## What it is here

### The API

`GET /dashboard?from=&to=` returns the sections the user may see.

* **Which sections.** A section is shown to anyone with its desk's read permission.
* **Which heads.** Money heads are shown only with the new `dashboard:finance`.
* **Each head:**
  * its value over the days asked (today when none are given);
  * the same over as many days just before, as `previousFrom`–`previousTo`;
  * whether it is a count or money;
  * a hint;
  * the splits it offers.
* **Heads "as of now"** (stock, beds, dues, staff) have no previous value.
* **Limits.** At most 366 days (`period_too_long`); never backwards (`invalid_period`).

`GET /dashboard/heads/:key?from=&to=&by=` returns one head split by one of its dimensions: day first, then
desk, way paid, user, doctor, ward, outlet and so on.

* A split by user is named from the user directory.
* A long split keeps 24 rows and sums the rest as "Other".
* A head the user may not see is not found (`dashboard_head_not_found`).
* A split it lacks is refused (`invalid_dimension`).

**Freshness.** Figures are worked out when asked and kept for a minute, so that many people opening the dashboard
do not repeat the work.

### How a module adds to it

As with reports, each module registers its section in the shared `DashboardRegistry`.

* A head is SQL over the module's own tables: what counts, its day, its value, its splits (`sqlHead`).
* No module reads another's tables.
* The Money section reads the books.

### The sections

| Section (permission) | Heads | Splits |
|---|---|---|
| **Money** (`dashboard:finance`) | Collected, paid back, net collection: every desk's vouchers on the cash, card and wallet accounts | day, desk, way paid, posted by |
| **Outpatients** (`opd:read`) | New patients, OPD bills, consultations; OPD billed, discount; OPD dues now | day, payer, company, doctor, visit, user |
| **Inpatients** (`ipd:read`) | Admissions, discharges, admitted now, free beds now; indoor billed, discount; indoor dues now | day, kind, referring doctor, discharge type, ward, bed category, payer, company, user |
| **Diagnostics** (`diag:read`) | Diagnostic bills, tests; diagnostic billed, discount; diagnostic dues now | day, referring doctor, department, test, payer, company, user |
| **Laboratory** (`lab:read`) | Samples collected, samples rejected, results verified, results waiting now | day, status, reason, report form, user |
| **Pharmacy** (`pharmacy:read`) | Counter sales, lots expiring in 90 days; sales value, discount, returns, credit sales, ward medicine, purchases received, stock at cost now | day, outlet, user, way paid, owed by |
| **Canteen** (`canteen:read`) | Canteen sales; their value, credit | day, outlet, customer, user |
| **Staff** (`hr:read`) | Staff now, joined, separated | day, department, service nature |

**Which day a figure falls on:**

* Bills, sales and returns: their own day.
* Admissions and discharges: their time, on the organisation's day (`REPORT_TIME_ZONE`).
* Verified results: when verified.

## Decisions ("next" without answers: the recommendations)

1. **One dashboard API with a section per desk, shown by permission.** The old system had one page per
   department. A manager sees every section together; a counter sees only its own.
2. **Worked out when opened, kept for a minute.** There are no nightly snapshots: today's figures are today's.
3. **A new `dashboard:finance` permission for money.** A desk's read permission shows its counts. Money (sales,
   collections, dues, stock value) needs `dashboard:finance`, which also shows the Money section.
4. **Collection comes from the books.** The old dashboard copied the collection report's rules. Here every desk
   posts each payment to the cash, card or wallet account, so the vouchers say what was collected, by desk and by
   user. Journals entered by hand (bank deposits, expenses) are left out.
5. **Indoor medicine and tests count once:**
   * on the indoor bill, under Inpatients;
   * at the pharmacy, as ward medicine;
   * in the lab, as work;

   never added together as sales.

## Not done here

* **The screen** (step 16e): tiles, change on the period before, the breakdown, a day trend.
* **Export to Excel and PDF.** The reports cover the same figures.
* **Marketing.** Bills by referring doctor are in the Outpatients, Inpatients and Diagnostics splits; marketing
  officers have no data to split by.
* **Supply chain.** The old SCM dashboard had single-digit rows.
* **Attendance** (biometric) and payroll on the Staff section. They are reports of their own.
* **Laboratory by department.** The departments are the hospital's. Tests by department are on the Diagnostics
  section.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. No migration.
* `npm test`: 458 tests passed. `dashboard.spec.ts` covers:
  * sections registered under their keys, a head split by day first, no section twice;
  * today in Dhaka and the days before;
  * the 366-day limit;
  * sections by permission, money by `dashboard:finance`;
  * the minute's cache, and a failure not kept.
* `npm run test:int`: 16 tests passed.
* `npm run test:e2e`: 179 tests passed. New `dashboard`:
  * **Every figure works out.** Every head of the eight sections, and every split of every head, as admin.
  * **The counter** sees only Pharmacy's counts, and not a money head even by its key.
  * **With `dashboard:finance`:**
    * collected 500 against 0 the days before;
    * by way paid (cash 300, card 200), by day, by seller and by desk;
    * stock at cost now 300.
  * **Refusals:** days backwards, more than a year, an unknown head, a split a head lacks.
  * **No days asked:** today, against the day before.
* Dev server restarted; readiness 200.
