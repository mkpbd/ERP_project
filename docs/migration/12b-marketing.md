# Step 12b — Marketing: the team, doctors looked after, targets and achievement

Status: **done** (2026-10-30). Previous: [step 12a](12a-canteen.md) · Next: [step 12c](12c-communication.md).

What this step adds, in a new `marketing` module:

* **Zones and areas.**
* **The marketing team:** managers; officers under a manager, each working a zone; agents under an officer.
* **The referring doctors each officer looks after.**
* **Monthly targets** per officer, and the gross target.
* **Achievement against target.** It is the hospital's billing on the doctors' referrals in the month: consultations,
  tests and final indoor bills.

## Where the old logic lives

CoxBazar, `Marketing` (`src/Core/Domain/Entities/Marketing/`):

* **Places:** `MarketingZone`, `MarketingArea`, `MarketingZoneMapping` (officer → zone).
* **People:**
  * `HoD`, `MarketingManager` (under a HoD);
  * `MarketingOfficer`, `MarketingJOfficerOrMedia` (officers);
  * `MarketingAgent` (name, designation, code);
  * `Media` (under an officer, with a code).
* **Targets:** `MPOSalesTarget` (officer, month, year, amount), `GrossSalesTarget` (month, year, amount).
* **Commissions:** `CommissionGroup`, `CommissionSetup` (group, test, %), `DoctorCommsion`.
* **Doctors:** `Doctor`, `DoctorFieldOfSpeciality`, `DoctorServiceType`, `VWDoctors`. These are the hospital's
  doctors now (step 9).

## Decisions (step 12a's open questions; "next" without answers, so the recommendations)

1. **The team** is managers → officers → agents (old Media and agents are agents), with zones and areas. Monthly
   targets are set per officer, plus a gross target.
2. **Achievement is referred billing.** Each referring doctor is looked after by one officer. An officer's
   achievement is what the hospital billed on their doctors' referrals in the month (net):
   * consultation bills;
   * diagnostic bills, less tests cancelled;
   * final indoor bills of admissions they referred.

   Cancelled bills are left out. The gross is everything referred, whether an officer looks after the doctor or
   not. It is read through a new hospital contract, **`ReferredBilling`**.
3. **Commission groups are not ported.** Referral commissions stay with the hospital (per test and per doctor, step
   10a), and are paid through the doctor ledger.
4. **Report:** target and achievement by month.
5. **Permissions:** `mkt:read`, `mkt:manage`.

Other decisions:

* **The team's shape is enforced:**
  * a manager works under nobody;
  * an officer under an active manager;
  * an agent under an active officer;
  * only an officer works a zone.

  So nobody can end up under themselves.
* **Codes** (old MarketingCodeNo / Media CodeNo) are unique in any case.
* **Nobody leaves the team while someone active works under them** (`has_reports`).
* **Doctors.** Giving an officer a doctor moves the doctor from any other officer: a doctor has one officer.
* **Targets.**
  * Setting a target replaces the one of that officer and month; an amount of null removes it.
  * Percent is achieved ÷ target, to one decimal, and none without a target.
* **Days.**
  * A bill counts on its day: consultation and indoor bills by their billing day, diagnostic bills by their billing
    time in the organisation's time zone.
  * The month runs from its first day to its last.
* **The old HoD level is not kept.** Managers are the top of the team.

## API (`/api/v1/marketing`)

| Endpoint | Who | What |
|---|---|---|
| `GET` / `POST` / `PATCH` `zones`, `areas` | `mkt:read` / `mkt:manage` | Zones; areas of a zone |
| `GET people?kind=`, `POST people`, `PUT people/:id` | `mkt:read` / `mkt:manage` | The team, with whom each works under and their zone |
| `GET` / `PUT` `people/:id/doctors` | `mkt:read` / `mkt:manage` | The officer's referring doctors (whole list) |
| `PUT targets` | `mkt:manage` | `officerId` (none: gross), `year`, `month`, `amount` (null removes) |
| `GET performance?year=&month=` | `mkt:read` | Per officer: doctors, consultations, tests, indoor, achieved, target, %; gross and unassigned |

## Report

**`marketing.performance`** (`year`, `month`), landscape PDF and Excel. It shows:

* all referred billing against the gross target, and what no officer looks after;
* per officer: manager, zone, doctors, the three kinds of billing, achieved, target and percentage.

## Not ported here

* **Commission groups and setups, doctor commissions:** the hospital's referral commission instead.
* **Heads of department above managers.**
* **Doctors' fields of speciality and service types:** the hospital's specialities.
* **Agents' own achievement.** Agents bring patients through the doctors and officers they work with; bills record
  only the referring doctor.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
  * Marketing reads billing only through `ReferredBilling` and doctors through `OutpatientClinic`.
* Migration `0055_marketing`: 5 tables.
* `npm test`: 399 passed. New: `test/unit/marketing/team.spec.ts` covers:
  * the team's shape (who works under whom, zones);
  * month bounds, including a leap February;
  * officers' achievement, targets and percentages, the gross and the unassigned.
* `npm run test:int`: 16 passed (migration count 56, new tables).
* `npm run test:e2e`: 152 passed. New: `test/e2e/marketing.e2e-spec.ts` covers:
  * **Places:** zones (`mkt:manage` only); an area of an unknown zone refused.
  * **The team:**
    * an officer under nobody refused;
    * an agent under a manager refused;
    * a duplicate code (any case) refused;
    * someone leaving while another works under them refused;
    * the team list.
  * **Doctors:** a doctor moved from one officer to another.
  * **Billing and targets:**
    * three referred diagnostic bills (one by a doctor nobody looks after);
    * officer and gross targets, set twice.
  * **Performance:** each officer's achievement and percentage; the gross, total and unassigned.
  * **Report:** Excel and PDF.
* Dev server restarted; readiness 200.
