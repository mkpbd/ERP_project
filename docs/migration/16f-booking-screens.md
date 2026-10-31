# Step 16f — Diagnostic booking screens (Angular)

Status: **done** (2026-10-31). Previous: [step 15f](15f-diagnostic-appointments-home-collection.md) (its API) ·
Next: [step 15g](15g-small-items.md) (small items).

The screens for step 15f in `D:\Pratices\ERP_Frontend` (`mkpbd/ERP_frontend`, commit `55da081`). They are under
`/diagnostic`, with three entries in the Hospital menu.

## Old → new

| Old page (CoxBazar, Blazor) | New |
|---|---|
| `/diagnostic/test-appointment-dashboard` | **Test appointments** (`/diagnostic/appointments`) |
| `/diagnostic/test-appointment-setup` | **Booking setup**, Test windows tab |
| `/diagnostic/home-collection-setup` | **Booking setup**, Collection areas and Collection windows tabs |
| — (the old mobile app only) | **Book tests** and **Book a home collection** at the desk |
| — (no desk screen) | **Home collections** (`/diagnostic/home-collections`): the desk's board and a collector's own visits |

## The screens

### Test appointments (`diag:read`)

* **The day.** Moved a day at a time or picked. It can be narrowed to one department.
* **The windows.** Each window of the day shows its places booked out of its capacity, and whether it is over.
* **The board.** One line of counts (booked, billed, no-show, cancelled, quoted). Then each booking with its
  window and serial, the patient (UHID or "not registered"), the tests, who booked it (a user or the portal), the
  amount quoted and the status with the bill's number.
* **Book tests** (`diag:book`):
  * the patient: registered (searched by name, UHID or mobile, with `patient:read`) or a name and mobile number;
  * the day (today to 60 days on) and the department;
  * a window with its places left (full and past windows cannot be chosen);
  * the tests, searched and added one by one with the total;
  * remarks.

  The slip is printed when the booking is made, and again from the row.
* **On the row:**
  * **Bill** (`diag:bill`, on the day): the bill dialog below; the receipt is printed;
  * **No-show** (from the day on) and **Cancel** with a reason (`diag:book`).

### Home collections (`diag:read`, or `diag:collect` for a collector)

* **The day.** Moved a day at a time or picked; by area and by collector ("Mine" for a desk user who also collects).
* **The board.** One line of counts (waiting for a collector, on the way, collected, cancelled, not billed,
  quoted). Then each visit with its window and number, the patient, the area, address, landmark and the patient's
  note, the tests, what is still to collect (the bill's due once billed), the status with the collector and the
  time collected.
* **Book a home collection** (`diag:book`):
  * the patient as above;
  * the day, the area (its charge and days shown), the window;
  * the address and a landmark;
  * the tests (lab tests only), with the visit's charge and the total. The screen warns when the tests are short
    of the area's smallest order, or the area is not served that day;
  * a note for the collector.
* **On the row:**
  * **Collector** (`diag:book`): one of the users who take samples at homes;
  * **Collected**: the collector given the visit, or the desk; with a note;
  * **Bill** (`diag:bill`) before or after the visit;
  * **Cancel** with a reason, while it is not collected or billed.
* **Run sheet.** The day's sheet (PDF), for one collector when one is chosen.
* **A collector** without `diag:read` sees "The visits given to you". There is no filter and no billing, only
  their own visits to record.

### Billing a booking (`diag:bill`)

A short bill made from the booking:

* its tests, and the visit's charge for a home collection, with the total;
* the registered patient, asked for when the booking was made without one;
* what is paid now (all of it unless changed), how, and a reference;
* the due after it.

The backend adds the visit's charge as the home collection service. Discounts, payers and other tests are for the
full diagnostic bill screen, still to come.

### Booking setup (`diag:read`; changes `diag:manage`)

Four tabs:

* **Test windows:** the name, start and end, places a day, department ("Any department" when none), order, active.
* **Collection areas:** the area, the visit's charge, the smallest order, the days served (Sat … Fri; none: every
  day), active.
* **Collection windows:** the label the patient reads, the order, active.
* **Visit charge:** the service a home visit is billed as, chosen from the tests of `other` departments.

## The shared master table

The master table and its dialog now take more kinds of fields than text and toggles:

* **numbers**, whole or with decimals, with a lowest and highest value;
* **a choice** of fixed values, or of another master's records, shown by its label ("Any department" for none);
* **several choices**, as toggle buttons ("Every day" for none).

The fields stretch to the dialog's width. `record-master.spec.ts` covers what is sent and how it reads.

Other shared changes:

* `requireAnyPermission` joins the route guards;
* the reason dialog can take an optional note.

## Decisions

1. **Bookings get their own pages under `/diagnostic`** rather than tabs of the lab. Test appointments are the
   front desk's; home collections are shared by the desk and the collectors.
2. **A short bill from the booking.** There is no diagnostic billing screen yet, so a booking is billed from its
   row: its tests at their rates and what is paid. The full bill screen comes with the diagnostic billing step.
3. **A collector's own page is the same page.** Without `diag:read` it shows only their visits and only the
   Collected action.
4. **The setup uses the shared master table**, extended rather than written again for numbers and choices.

## Verification

* Frontend `npm run check` (typecheck, lint, architecture, format, unit tests, build): clean, 80 unit tests.
  New:
  * `diagnostic.models.spec.ts`: days across months, paisa sums, areas served by day, what to collect, window times;
  * `record-master.spec.ts`: the master's numbers, choices and lists, and how they read.
* Frontend e2e (Playwright, mocked API): 47 passed. New `e2e/diagnostic.spec.ts`:
  * **Test appointments:** booking a registered patient in a department's window with a place, the slip, the
    window's places counted, billing on the day and the receipt;
  * **Home collections:**
    * booking for a patient not registered, with the smallest order's shortfall shown;
    * sending a collector, recording the samples with a note;
    * billing the visit to the registered patient with part paid, so the due shows as left to collect;
    * the run sheet;
  * **Setup:**
    * a window with a department and its places;
    * an area served on Saturdays and Sundays;
    * the visit charge's service saved in the policy;
  * **A collector** sees only their own visits, can record them and cannot bill;
  * **No axe violations** on the three pages.
* The full suite flaked under another project's heavy test run on the same machine. With two workers it passed
  in full.
* The dialogs and boards were looked at in screenshots. That found standalone fields of the booking dialog and of
  the master dialog sitting side by side; they now stretch to the dialog's width.
