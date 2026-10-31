# Step 15c — Inpatient care gaps: observations, nursing care, reopening, corrections, visitor passes

Status: **done** (2026-10-31). Previous: [step 15b](15b-culture-and-written-reports.md) · Next: step 15d (pharmacy
credit to corporate clients and staff).

The third and sixth gaps of the page-by-page check: the inpatient nursing records the new EMR lacked, and
corrections to an admission after admitting.

## Where the old logic lives

CoxBazar:

| Old page | Tables | What it did |
|---|---|---|
| `/hospital/follow-up-schedule` | `Hospital.FollowUpSheetSchedules` | Named rounds with a start and end time |
| `/Hospital/dynamic-follow-up-data` | `Hospital.FollowUpData` (+ details) | A dynamic form's answers per round, by the nurse |
| `/hospital/AddEdit_NonMedication_Order` | `NonMedicationOrders`, `IPDNonMedicationOrders` | Care orders ("Catheter care") with a dose and instruction, per stay |
| `/hospital/bring-discharged-patient-live` | admission, cabin allocation, final bill ledger | A discharge undone, the patient back in their cabin or another |
| `/hospital/visiting-card` | visiting cards | Cards for attendants, sold by the card, cash or card |

**Faults of the old pages:**

* **Follow-up data.** The old follow-up sheet kept a form builder's answers as text. Nothing could be charted or
  flagged, and a round missed was not seen.
* **Care orders.** They had no times and nothing marked them done.
* **Reopening a discharge.** It rewrote the admission and cabin rows. The final bill's ledger was left as it was,
  so a reopened patient kept a bill in force.
* There was no correction of an admission's referrer or payer after admitting.

## What it is here

### Observation sheet (clinical; `emr:read` to see, `emr:write` to record)

**Rounds** (`/clinical/observation-rounds`, kept with `rx:manage`):

* a name and a window of local time (morning 06:00–12:00, …);
* a night round's end is the next morning.

**An observation** (`POST /clinical/admissions/:id/observations`):

* **Readings:**
  * temperature in °F;
  * pulse, respiratory rate, blood pressure, SpO2;
  * pain 0–10, blood sugar in mmol/L;
  * intake and output in ml;
  * consciousness (alert, voice, pain, unresponsive);
  * a note.
* **Checks:**
  * each value within plausible bounds;
  * both pressures or neither, the diastolic below the systolic;
  * something recorded.
* **Time:** taken now, or up to 24 hours ago (written after a busy round); not before the admission.
* **Round:** it answers the round whose window holds its time.
* **Flags** a nurse reports, at common ward thresholds:
  * fever ≥ 100.4 °F, temperature < 95 °F;
  * pulse > 120 or < 50;
  * breathing > 24 or < 10;
  * SpO2 < 92;
  * systolic < 90, or ≥ 180 / diastolic ≥ 110;
  * sugar < 3.9 or > 16.7;
  * not alert.

**Entered in error** (`POST /clinical/observations/:id/strike`): struck through with a reason, kept and shown, no
longer counted.

**Reading:**

* `GET /clinical/admissions/:id/observations?from&to`: the sheet of a period (up to 31 days).
* `GET /clinical/observation-board?day=`:
  * every admitted patient by ward and bed;
  * each round of the day: done, due (its window open), missed or to come;
  * the flags of their latest reading.

**Print:** `clinical.observation-chart` (admission, period).

### Nursing care orders (clinical; ordered with `emr:order`, done with `emr:write`)

* **Ordering:** `POST /clinical/admissions/:id/care-orders` with the care ("Turn the patient"), how it is done if
  more is said, and the same schedules as medicines: set times, every N hours, once, or when needed.
* **One model:** care orders are treatment orders of kind `care`. They have no medicine and no route.
* **Steps:** they are held, resumed and stopped as medicines are, and each due time is marked done or not done
  (`POST /clinical/orders/:id/doses`).
* **The chart** (`GET …/chart`) takes `kind` (medicine or care).
* **Prints:**
  * the medication chart prints medicines only;
  * the new `clinical.care-chart` prints the day's care.

### Admission corrections (hospital; `ipd:admit`)

`PUT /hospital/admissions/:id`, while the patient is in:

* What can be put right: the kind, the reason, the referring doctor and who pays (a corporate client, a staff
  member, or the patient).
* The answer lists the fields changed; nothing changed is refused.
* **Who pays** is changed only before the final bill (`bill_made`). A new credit client is held to its credit
  limit, as on admission.

### Reopening a discharge (hospital; `ipd:manage`)

`POST /hospital/admissions/:id/reopen` with a reason, and a bed if not the old one.

* **The final bill is cancelled** as a bill cancel does:
  * its income, discount, due and shares are reversed in one voucher;
  * the advance put against it is held again.
* **Refused once the bill is paid**, at the counter or collected later (`bill_paid`). The patient is admitted again
  instead.
* **The bed:** the patient goes back into the bed they left when no one has taken it (it may still be in
  housekeeping), or into the bed given.
* **From now:** the time out of hospital is not a stay and is not charged.
* **Doctors:** the consultant they had is restored.
* The discharge is forgotten. The new stay's reason and the audit log keep why.
* Discharging again needs a new final bill, as any discharge.

### Visitor passes (hospital; `ipd:admit` to issue, `ipd:read` to see)

* **Issuing:** `POST /hospital/admissions/:id/visitor-passes` with the visitor's name, relation and mobile. Numbered
  `VP-<year>-…`.
* **Limit:** up to the IPD policy's `visitorPassLimit` in force at once (2 unless set; 1 to 10). It is taken under the
  admission's lock, so two counters cannot pass it together (`pass_limit`).
* **Handed back** (`POST /hospital/visitor-passes/:id/return`) when lost or the attendant changes. A discharge ends
  them all.
* **Print:** `hospital.visitor-pass`, a card with the patient, ward, bed and a barcode. Refused for a pass no longer
  in force.

## Decisions ("next" without answers: the recommendations)

1. **Reopening is a manager's (`ipd:manage`), with a reason, and only before the final bill is paid.** Paid means
   paid at the counter or collected later. An advance put against the bill is not a payment; it is held again.
2. **Nursing orders are a doctor's orders that nurses mark done**, with the medicines' schedules. This is not a
   medication chart with every dose time typed in.
3. **A visitor pass limit of 2** at once, set in the IPD policy.
4. **The old card fee is not kept.** When wanted, the card is charged to the stay as a service, so it is on the final
   bill rather than in a cash drawer of its own.
5. **The follow-up sheet's form builder becomes fixed readings.** They can then be charted and flagged.
   Temperature is kept in °F, as the wards read it.
6. **Flags, not an early-warning score.** A score (NEWS2) needs a clinical decision on its use; the flags report the
   same readings without one.

## Not done here

* **Old follow-up data and care orders** are not brought over: they were free-text forms without times.
* **Ward-scoped access** (duty nurses and doctors seeing their floor's patients) is its own gap.
* **Screens.** The inpatient screens (admissions, bed board, billing, these records) come with the IPD's turn in the
  UI steps.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
* Migration `0061_inpatient_care` adds:
  * observation rounds, observations, visitor passes;
  * the kind of a treatment order (dose and route optional for care);
  * the policy's visitor pass limit.
* The visitor pass card and the observation chart (flags marked, a struck entry) were checked in screenshots.
* `npm test`: 453 tests passed. New and extended tests:
  * `observation.spec.ts`: bounds, pressures, something recorded, flags, night rounds, round states.
  * `visitor-pass.spec.ts`: name, mobile, handed back once.
  * `admission.spec.ts`: corrections tell what changed and refuse two payers; reopening from now into a bed under the
    old consultant.
  * `treatment.spec.ts`: care has no medicine and no route.
* `npm run test:int`: 16 tests passed (migration count 62).
* `npm run test:e2e`: 173 tests passed. Extended:
  * **`hospital-ipd-billing`:**
    * a discharge undone by a manager only;
    * the bill cancelled, the advance held again, the patient back in W-1;
    * not twice;
    * billed again and paid, then not reopened (`bill_paid`).
  * **`hospital-ipd`:**
    * a correction listing what changed, nothing changed refused, a stale one refused;
    * two passes, a third refused;
    * one handed back, another issued;
    * the list;
    * a pass printed, a returned one refused.
  * **`clinical-treatment`:**
    * care ordered by the doctor only and marked done;
    * the care chart and its print;
    * rounds kept;
    * readings refused (rights, bounds, pressures, nothing, ahead);
    * a reading flagged and answering its round;
    * the board and the print;
    * struck through and no longer counted.
* Dev server restarted; readiness 200.
