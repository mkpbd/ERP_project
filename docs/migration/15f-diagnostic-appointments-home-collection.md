# Step 15f — Diagnostic appointments and home collection

Status: **done** (2026-10-31). Previous: [step 15e](15e-dashboards.md) · Next: [step 16f](16f-booking-screens.md) (the
screens).

The seventh gap of the page-by-page check: the diagnostic front office. Patients booked tests for a day and window,
and asked for a collector at home. The new system had neither.

## Where the old logic lives

CoxBazar (`Core/Domain/Entities/Diagnostic/`, `Features/Diagnosis/`, pages in `Components/Pages/Diagnostic/`), added
in September 2026:

| Old | What it did |
|---|---|
| `Diag.TestAppointmentSlots` (`/diagnostic/test-appointment-setup`) | Windows tests are booked into: label, start and end, patients a day, one department or any |
| `Diag.TestAppointments` + `TestAppointmentTests` (`/diagnostic/test-appointment-dashboard`) | A booking: day, window, serial, tests quoted. A free-text status: Booked, Arrived, Completed, Cancelled. Counts by department, test and window |
| `Diag.HomeCollectionServiceAreas` (`/diagnostic/home-collection-setup`) | Areas a collector goes to: charge, smallest order, weekdays served (blank: every day) |
| `Diag.HomeCollectionTimeSlots` (same page) | The windows a collector can be asked for, as labels |
| `Diag.HomeSampleCollections` + `HomeSampleCollectionTests` | A home visit: area, address, landmark, day, window, tests, charge, payment mode, status |

**How the old system worked:**

* **Who booked.** Every booking came from the patients' mobile app. Its API is not in the old code we have.
* **What the desk did.** The desk kept the windows and areas and worked the appointment dashboard. It could not book.
* **Home visits.** No screen showed them. No collector was ever recorded: the window's label was all the collector
  got.
* **Billing.** Arriving set a status. The bill was made separately, with nothing linking the two.

**The data.** The tables exist on the QA copy of rehearsal 1, but every one is empty (counts only, nothing else
read). Rehearsal 2, on the live copy, will show whether any rows need bringing over.

## What it is here

### Setup (`diag:manage`)

These are record tables, edited like the other diagnostic masters.

* `hospital/test-appointment-windows`:
  * a label;
  * a start, and an end after it (HH:MM);
  * a capacity a day (1–999);
  * one diagnostic department, or none for any;
  * a display order.

  A label is unique within its department. A window in use is switched off, not deleted.
* `hospital/home-collection-areas`: a name, the visit's charge, the smallest test total a visit is made for, and the
  weekdays served (none: every day, as before).
* `hospital/home-collection-windows`: a label and a display order.
* **The home collection service.** The diagnostic policy names a service: a test of an `other` department, like the
  old SERVICES group. A visit's charge is billed as that service. `PUT diagnostic-policy` takes
  `homeCollectionTestId` and refuses a real test (`not_a_service`).

### Test appointments

* **Booking** (`POST /hospital/test-appointments`, `diag:book`). The patient is either registered, or given as a name
  and mobile number until they register. The booking needs:
  * a day, from today up to 60 days ahead;
  * a window that is active, not over today, and of the tests' department when it has one (`wrong_window`);
  * 1 to 20 lab or imaging tests, quoted at today's rates. Services cannot be booked (`not_bookable_test`).
* **The serial.** The serial is the first place free within the window's capacity (`fully_booked`). It is chosen
  under a lock on the window's day; a unique index is the last guard. A cancelled booking frees its place.
* **Numbers and duplicates.** Numbered `TA-<year>-…`. A patient has one booking per window and day
  (`already_booked`).
* **The window is copied.** The booking keeps the window's label and times as booked. Changing a window later moves
  nothing; the old system had to forbid such changes for that reason.
* **Afterwards:**
  * no-show, from its day on;
  * cancel, with a reason;
  * attach the registered patient.

  Each needs the booking's version (`stale_booking`).
* **The board** (`GET /hospital/test-appointments?from&to&departmentId&windowId&status&patientId`, `diag:read`).
  Today when no days are given; a month at most. It returns the bookings, the counts by status, the amount quoted,
  and the counts by department, test and window (as the old dashboard).
* **Places** (`GET /hospital/test-appointment-availability?date&departmentId`). Each window of the day: capacity,
  booked, left, and whether it is over.

### Home collections

* **Booking** (`POST /hospital/home-collections`, `diag:book`). The patient as above, plus:
  * an area that is active and served that weekday (`area_closed`);
  * a window;
  * an address (required) and a landmark;
  * a note from the patient;
  * lab tests only (`not_home_test`), coming to at least the area's smallest order. A shortfall is named, as the old
    app named it (`below_minimum`).

  The visit is numbered `HC-<year>-…` and keeps the area's charge as booked. A patient has one home collection a day.
* **The collector** (`POST …/:id/assign`, `diag:book`). A user who holds `diag:collect` (`not_a_collector`).
  Another may be sent instead until the samples are taken. `GET /hospital/home-collectors` lists them: the active
  users given `diag:collect` by a role, super-admins left out.
* **Collected** (`POST …/:id/collected`). Recorded by the collector given it, or by the desk for them
  (`not_your_collection`), with a note. A collector without `diag:read` sees only their own on the board and by id.
* **Cancel** before the samples are taken and before the visit is billed. A billed visit is undone on its bill
  (`booking_billed`).
* **The board** (`GET /hospital/home-collections?from&to&status&areaId&collectorId`, `collectorId=me` for one's
  own). Each visit shows the tests, the charge, the total and the bill's due. The counts are by status, unbilled,
  area, collector and window.

### Billing a booking

`POST /hospital/diagnostic-bills` takes `testAppointmentId` or `homeCollectionId` (one at most). The bill is made in
the same transaction that marks the booking billed:

* **A test appointment** is billed on its day only, and once. It is then `billed`.
* **A home collection** is billed once, before the visit (the labels go with the collector) or after it. Its charge
  is added as a line: the policy's service at the area's charge, with no referral commission
  (`home_collection_service_unset` until the service is named).
* **The patient.** A booking made before registering takes the bill's patient. A booking of another patient is
  refused (`booking_patient_mismatch`).
* **The bill's tests are the counter's.** They need not be the tests booked: a patient may add or drop one.

### On the portal

The portal replaces the old mobile app. It works through the hospital's `DiagnosticBookings` contract; the portal
never reads the hospital tables.

* **No sign-in needed:**
  * `GET /portal/tests?q=`: the tests that can be booked, with rates (services left out);
  * `GET /portal/test-appointment-windows?date&departmentId`: the day's windows with places left;
  * `GET /portal/home-collection-offer`: areas (charge, smallest order, days) and windows.
* **The patient's own token:**
  * `POST /portal/test-appointments`, `POST /portal/home-collections`. The same rules as the desk, for the
    signed-in patient. At most 3 waiting of each kind (`booking_limit`).
  * `GET /portal/bookings`: their own, newest first.
  * `POST /portal/test-appointments/:id/cancel`, `/portal/home-collections/:id/cancel`. Another patient's booking
    is not found.
* **On the desk's board.** A portal booking shows as booked through the portal, with no user.

### Prints and the dashboard

* `hospital.test-appointment-slip`: the 80 mm slip, with the day, window, serial, patient and tests quoted.
* `hospital.home-collection-sheet` (date, optional collector; PDF and Excel): the collector's run sheet, by collector
  and window. Each visit shows the patient and mobile, the area, address, landmark and note, the tests, what to
  collect (the bill's due once billed), the bill, and a column to sign.
* **Dashboard.** The Diagnostics section has two more heads. **Test appointments** splits by window, status and
  channel; **Home collections** by area, status and collector.

### Permissions

| Permission | Who |
|---|---|
| `diag:book` (new) | The front desk: booking, no-shows, cancelling, giving collectors |
| `diag:collect` (new) | Collectors: their own visits, recording samples as taken |

`diag:read` shows the boards; `diag:manage` keeps the setup.

## Decisions ("next" without answers: the recommendations)

1. **A booking is a quote, not a payment.** The tests are paid when the patient is billed on the day. Billing with
   the booking's id is the old "Arrived" and "Completed" in one.
2. **Home collection: an area, an address and a collector.** The charge is the area's, billed as a service on the
   diagnostic bill. The collector records the samples as taken at home. The lab then collects and takes them in by
   the bill number, as for any sample.
3. **No SMS reminders** until the SMS provider is chosen. They will go through the communication module then.
4. **The desk books too.** The old desk could not take a phone booking; here it can, for a patient not yet
   registered.
5. **The portal limit.** A patient may hold 3 bookings waiting of each kind on the portal. The desk is not limited.
6. **Nothing to migrate yet.** The QA copy has no rows. If the live copy has some, the ETL brings over the setup and
   the bookings from the cut-over day on.

## Not done here

* **The screens** (step 16f).
* **Preparation videos and the card provider master.** The rest of the old diagnostic front office goes to step 15g
  with the other small items.
* **SMS reminders and confirmations** (see decision 3).
* **Online payment** when booking.
* **Moving a booking to another day.** It is cancelled and booked again.
* **The time a home sample was taken.** The time is on the home collection. The lab's sample record is made when
  the samples are entered at the centre.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. Migration
  `0063_diagnostic_bookings` (six tables and the policy's service).
* `npm test`: 464 passed. New `diagnostic-booking.spec.ts` covers:
  * the days that can be booked, quotes and serials;
  * when a window is over, and the days an area is served;
  * billing an appointment on its day and for its patient;
  * a home visit: its smallest order, the collector, collected, billed once, cancelling.
* `npm run test:int`: passed (migration count 64).
* `npm run test:e2e`: passed. New `hospital-bookings`:
  * **Windows:** unique per department, end after start.
  * **Places:** serials within the capacity; a cancelled place booked again; `wrong_window`, `not_bookable_test`,
    `already_booked`, `fully_booked`.
  * **Board and availability:** the counts.
  * **Billing appointments:** on the day, once, for the right patient; a refused bill leaves nothing.
  * **Home collections:**
    * by area: smallest order, days, lab tests only;
    * collectors: only those with `diag:collect`; each sees and records only their own;
    * the service named in the policy, and billed as a line;
    * a billed visit is not cancelled; closed areas and windows in use.
  * **The portal:** tests, windows and areas without sign-in; booking, the limit of 3, one's own list, cancelling,
    another patient's booking not found.
  * **Prints:** the slip and the run sheet.
  * **Dashboard:** the dashboard suite runs the two new heads and every split.
* The slip and the run sheet were looked at in screenshots.
