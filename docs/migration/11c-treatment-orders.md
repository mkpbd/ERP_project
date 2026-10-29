# Step 11c — Treatment orders, the medication chart, the discharge summary

Status: **done** (2026-10-30). Previous: [step 11b](11b-emr-notes.md) · Next: [step 11d](11d-nutrition.md).

What this step adds to the `clinical` module, for admitted patients:

* **Treatment orders.** A doctor orders a medicine (from the pharmacy's catalogue or by name) with a dose and route.
  It is given at **set times** each day, **every so many hours**, **once**, or **when needed** (prn).
  * Orders are held (with a reason), resumed, or stopped (with a reason).
  * Every change is kept as an event.
* **The medication chart.** The nurses record each due dose as **given**, or **missed** with the reason, and each
  when-needed dose when given. The chart of a day shows each order's due doses as given, missed, due or overdue.
* **The discharge summary.** It holds:
  * diagnosis and course in hospital;
  * condition on discharge;
  * medicines to take home, diet and advice;
  * follow-up.

  The doctor writes it as a draft, signs it, and can reopen it while the patient is in.
* **Prints:** the medication chart and the discharge summary.

## Where the old logic lives

CoxBazar:

* **Orders:** `Hospital.RxIpdTreatment`.
  * Brand or manual brand, dosage, duration, route, start/stop/hold dates and times, and their notes.
  * Status and dose status, doctor and consultant, `IsDischargeCertificate`.
  * An event row per change (TreatmentId, EventName, Note).
* **Dose times:** `EMR.TreatmentDoseTiming` (`TimingType`: TimeBasis / IntervalBasis, StartDate) and
  `TreatmentDoseTimingDetail` (Time, IntervalInMinute).
* **Doses given:** `EMR.AppliedMedicationDose` (the treatment, apply date and time, the timing detail, the user).
* **On discharge:**
  * `EMR.TreatmentOnDischarge`, `DietOnDischarge` (food pattern, fluid and protein restrictions, calories),
    `AdvicesOnTreatment`;
  * the discharge certificate.

## Decisions (step 11b's open questions; "next" without answers, so the recommendations)

1. **An order** is:
   * a medicine of the catalogue (its name copied) or written by name;
   * a dose, a route (oral, IV, IM, SC, topical, inhaled, rectal, other) and a schedule.

   It starts now, or at a set time up to 7 days ahead but not before the admission day. It belongs to the ordering
   doctor: the one signed in, or named. It is held and resumed, or stopped for good.
2. **The chart.**
   * The nurses record due doses as given or missed, and when-needed doses as given. Nothing is recorded for a time
     the order was not in force.
   * The chart shows due against given.
3. **Orders don't touch the pharmacy.** The ward indent (step 8i) stays the way medicine reaches the ward and the
   bill.
4. **The discharge summary** is written by the doctor and signed; it is printed only when signed. The diet is free
   text until nutrition (step 11d).
5. **New permission `emr:order`** for doctors: orders, hold, resume, stop, the discharge summary. Charting doses
   needs `emr:write`.

Other decisions:

* **Schedules.** Old TimeBasis / IntervalBasis become:
  * `times`: 1 to 12 HH:MM times each day, in the organisation's time zone;
  * `interval`: every 1 to 72 hours, counted from the start;
  * `once`: at the start;
  * `prn`: when needed, with no due times.

  Each schedule takes only its own fields.
* **Due times** are worked out from the order's events. The order is in force from each start or resume to the next
  hold or stop, so nothing falls due while it is held.
* **Recording a dose.**
  * A due dose names its exact due time. It is given at most 2 hours early, and not ahead of now.
  * A dose is missed only once its time has come, and with a reason.
  * Each due time is answered once (`dose_recorded`).
  * A when-needed dose is recorded when given, while the order is in force.
* **Overdue** on the chart: no record an hour after the due time.
* **Holding or resuming** needs the patient to be in. Stopping does not.
* **The discharge summary.**
  * One per admission. The first draft is written with `version: null`.
  * The doctor is the one signed in (or named).
  * Signing needs the diagnosis. A signed summary is reopened before it is changed.
  * A follow-up date is not in the past.
* **Old `IsDischargeCertificate` on orders** (an order carried to discharge) is not kept. The client copies the
  active orders into the summary's medicines, which are their own list.

## API (`/api/v1/clinical`)

| Endpoint | Who | What |
|---|---|---|
| `GET admissions/:id/orders?status=` | `emr:read` | Orders with their events (and who made each) and the doctor's name |
| `POST admissions/:id/orders` | `emr:order` | `productId` or `drugName`, `dose`, `route`, `schedule`, `times`, `intervalHours`, `startAt`, `note`, `doctorId` |
| `POST orders/:id/hold` / `resume` / `stop` | `emr:order` | `version` (+ `reason` to hold or stop) |
| `POST orders/:id/doses` | `emr:write` | `dueAt` (none for prn), `outcome` given/missed, `givenAt`, `reason` |
| `GET admissions/:id/chart?day=` | `emr:read` | The day's orders with due doses and their states, and prn doses |
| `GET` / `PUT admissions/:id/discharge-summary` | `emr:read` / `emr:order` | The summary; the draft (`version` null for the first) |
| `POST admissions/:id/discharge-summary/sign` / `reopen` | `emr:order` | `version` |

## Reports

* **`clinical.medication-chart`** (`admissionId`, `day`, landscape). For each order: the medicine, dose, route,
  schedule and status, then each due dose given (when, by whom), missed (why) or outstanding, and the prn doses.
* **`clinical.discharge-summary`** (`admissionId`), signed only. It shows:
  * the patient and the admission;
  * diagnosis, course and condition;
  * the medicines table, diet, advice and follow-up;
  * the doctor's signature.

## Not ported here

* **Consultant vs doctor on an order** (`ConsultantId`). One ordering doctor.
* **Dose status flags.** The chart works them out.
* **Duration on an order.** Stopped when done.
* **Diet patterns, fluid and protein restrictions, served calories on discharge.** They come with nutrition (step 11d).
* **Order sets / protocols.** The prescription templates of step 11a are for the chamber.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
* Migration `0051_clinical_treatment`: 4 tables.
* `npm test`: 382 passed. New: `test/unit/clinical/treatment.spec.ts` covers:
  * local times to instants and day bounds, including a daylight-saving zone;
  * each schedule's fields;
  * due times at set times skipping a hold;
  * every N hours from the start;
  * once, and prn with none;
  * hold, resume and stop transitions with periods;
  * discharge summary checks.
* `npm run test:int`: 16 passed (migration count 52, new tables).
* `npm run test:e2e`: 147 passed. New: `test/e2e/clinical-treatment.e2e-spec.ts` covers:
  * **Ordering:**
    * a nurse may not order;
    * no doctor named;
    * a mixed schedule refused;
    * four orders (every 4 h, once, prn, set times) with names from the catalogue.
  * **Doses:**
    * a time not due;
    * too early;
    * missed before its time;
    * missed without a reason;
    * given;
    * twice refused;
    * a once dose missed;
    * prn with a due time refused, then given.
  * **Chart:** given and missed states, prn doses.
  * **Hold, resume, stop:**
    * a dose while held is not due;
    * resume and stop;
    * the event history;
    * resuming a stopped order refused.
  * **Prints:** the chart.
  * **Discharge summary:**
    * a first write with a version refused;
    * a stale draft;
    * signing without a diagnosis refused;
    * signed;
    * writing a signed one refused;
    * the print;
    * reopened, after which the print is refused.
* **Visual check** of both prints (screenshots).
* Dev server restarted; readiness 200.
