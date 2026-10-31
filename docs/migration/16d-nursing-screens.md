# Step 16d — Nursing screens (Angular)

Status: **done** (2026-10-31). Previous: [step 16c](16c-ipd-screens.md) · Next: step 15d (pharmacy credit) · API:
[step 11c](11c-treatment-orders.md) (treatment orders and the medication chart) and [15c](15c-inpatient-care.md) (observations, rounds, care
orders).

The ward nurses' screens in the Angular frontend (`D:\Pratices\ERP_Frontend`, `mkpbd/ERP_frontend`, commit
`b205271`).

## Old → new

| Old page (CoxBazar, Blazor) | New screen | Route |
|---|---|---|
| Follow up sheet dashboard | **Observation rounds**: every admitted patient, each round of the day done, due, missed or to come | `/nursing` |
| Follow up sheet (entry and list) | **Observations** tab of a stay: the day's sheet, recording, striking through | `/nursing/admissions/:id` |
| Medicine administration, medication chart | **Medicines** tab: the day's chart, ordering, given or missed per due time | same |
| Non-medication orders | **Nursing care** tab: the same for care orders, done or not done | same |
| Follow up sheet schedule | **Rounds** setup | `/nursing/rounds` |

## The screens

**Observation rounds** (`emr:read`):

* A column per active round with its window (e.g. Morning 06:00–10:00).
* A row per admitted patient: ward and bed, the patient (linked to their records), each round's state, the last
  reading's time and its flags.
* Any day can be looked at. On today's board, `emr:write` records a round straight from the row.
* After recording, the flags are named to the nurse: "Recorded. Tell the doctor: Fever, Fast pulse."
* **Rounds** (`rx:manage`) leads to the setup.

**A stay's nursing records:**

* The header names the patient and the admission, and links back to the stay (`/ipd/admissions/:id`). The IPD
  stay page links here too (`emr:read`).
* A day picker with previous and next day; all three tabs follow it.
* A discharged stay's records are read only, and say so.

**Observations tab:**

* The day's sheet: time, round, temperature, pulse, respiration, BP, SpO2, pain, sugar, intake/output, the note,
  who recorded it.
* Each reading's flags are shown on its row.
* A struck reading stays on the sheet, struck through, with who struck it and why.
* **Record observation** (`emr:write`):
  * every reading is optional, with a bound (no temperature of 200);
  * consciousness (AVPU), a note;
  * a time up to a day back, or now.
* **Strike through** (`emr:write`) asks why.
* **Print the day's sheet**: `clinical.observation-chart` for the day.

**Medicines and Nursing care tabs:**

* Each order of the kind: what, dose and route (or how the care is done), when, the doctor, the note, the
  status.
* Each due time of the day:
  * given or done, with the time;
  * missed or not done, with the reason;
  * or due, with **Given** / **Missed** buttons (`emr:write`).
* A when-needed order has **Given now**; its doses of the day are listed.
* **Order** (`emr:order`):
  * a medicine found in the pharmacy (`rx:read`, brand or generic), or one written by name;
  * a dose and route;
  * nursing care as words and how;
  * when: set times each day, every so many hours, once, or when needed.
* **Hold**, **resume** and **stop** (`emr:order`); hold and stop ask why. Each sends the order's version.
* **Print the day's chart**: `clinical.medication-chart` or `clinical.care-chart`.

**Rounds** (`rx:manage`):

* The shared master table over `/clinical/observation-rounds`: name, from, to, active.
* A round whose end comes before its start runs into the next morning.

After any change the stay's sheet, charts and orders are read again. A conflict (409) reloads them too, so the nurse
sees what changed.

## Decisions

1. **One page per stay with three tabs**, not three pages. A nurse works one patient at a time, and the day picker
   holds across the tabs.
2. **Recording from the board** for today only. A past day's board is for looking back; a late reading is written on
   the stay's sheet with its time.
3. **Flags are told to the nurse** when a reading is saved (as an error-toned message), not only marked on the row,
   so the doctor is called.
4. **A medicine is chosen from the pharmacy when it is there**, and written by name otherwise (as the old free-text
   order allowed).
5. **The submit helper moved to `shared/utils`**: the IPD dialogs and the nursing dialogs share it.

## Not done here

* The EMR notes (doctor's notes, progress notes) and the discharge summary.
* The nurse handover sheet.
* A ward filter on the board. The board lists every admitted patient.

## Verification

* Frontend `npm run check` (typecheck, lint, architecture, format, unit tests, build): clean.
  * 72 unit tests.
  * New: `stay-nursing.store.spec.ts`:
    * the day read and changed;
    * who may write and order, and a discharged stay read only;
    * a reload after a change and after a conflict;
    * `scheduleText`.
* Frontend e2e (Playwright, mocked API): 37 passed (the live-backend test skipped). New: `e2e/nursing.spec.ts`:
  * **The board:** a round recorded from the row; the flags named; the round done.
  * **The sheet:** a reading struck through with its reason.
  * **The medication chart:** a pharmacy medicine ordered at 08:00 and 20:00; one dose given, one missed with a
    reason; the order held; the chart printed.
  * **The care chart:** a dressing ordered and done.
  * **Read only:** a discharged stay; an unknown admission.
  * **Rounds:** a night round added.
  * **Accessibility:** no axe violations on the board or the stay.
* The board, the observation dialog, the sheet, the order dialog and the charts were looked at in screenshots.
