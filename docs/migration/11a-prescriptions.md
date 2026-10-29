# Step 11a — Prescriptions

Status: **done** (2026-10-30). Previous: [step 10f](10f-blood-bank.md) · Next: [step 11b](11b-emr-notes.md).

Step 11 is split:

| Part | Scope |
|---|---|
| **11a** (this step) | Prescriptions |
| 11b | EMR for admitted patients |
| 11c | Nutrition |
| 11d | Patient portal sign-in |

What this step adds, in a new `clinical` module:

* **A visit.** It is opened from today's chamber appointment, or for a registered patient seen without one. It gets an
  `RX-` number and the patient's visit number with that doctor.
* **Vitals**, taken by the doctor's assistant.
* **The doctor's prescription.** It holds:
  * complaints and history;
  * examination and diagnosis;
  * medicines from the pharmacy's catalogue (or written by name);
  * tests from the diagnostic catalogue (or by name);
  * advice, notes, referral and follow-up.

  The doctor signs it. It can be reopened for a correction on the visit's day.
* **Each doctor's pick lists and templates.** Pick lists cover complaints, history, findings, diagnoses, advice and
  doses. There are also shared lists for everyone.
* **The prescription print.**

## Where the old logic lives

CoxBazar, `Rx`:

* **Entities** (`src/Core/Domain/Entities/Rx/`):
  * `VisitHistory`: RxNo, VisitNo, RxType, AppointmentId.
  * `InitialData`: vitals, complaints, history, findings, diagnosis, plan, follow-up.
  * `Drug`: `BrandExtensionId` → the pharmacy's brand, `ManualDrugName`, Dosage, Duration, Qty, `IsDoseBangla`.
  * `Investigation`: `TestItemId` → the diagnostic test.
  * `AdviceToPatient`, `PatientChiefComplain`, `PatientClinicalimpression`.
  * Per-doctor lists, keyed by `CPId` = the doctor: `Advice`, `ChiefComplain`, `PresentHistory`, `PastHistory`,
    `OtherFinding`, `Clinicalimpression`, `RxCPDosage`.
  * `RxGenericDosage`: the shared doses per generic.
* **Pages:**
  * `/Rx/digital-rx`: `DigitalRxPage` and its parts: Persistence, Doses, Presets, PrintProfiles.
  * `/Rx/initial-data-entry`: the assistant's vitals.
  * `/opd/vital-prescription`, `/Rx/RxViewer`, `/Rx/invoiced-patients-list`.
* **Print:**
  * `DigitalRxDocument` (QuestPDF): two columns.
  * API `Report/PDF/Rx/PrintRxVisitFullDocument`.
* **The old flow.**
  1. The doctor's assistant ("Doctor Assistant" role) enters vitals; the appointment goes to *Vital*.
  2. The doctor writes; saving replaces every line and marks the appointment *Prescribed*.
  3. Nothing is locked, and `IsServiceCompleted` is never set.
* **Old tests on the Rx.** The investigation invoice page pulled them in by Rx number. They were never billed by the
  Rx itself.

## Decisions (step 10f's open questions; "next" without answers, so the recommendations)

1. **Step 11 is split** into 11a Rx, 11b EMR, 11c nutrition and 11d portal.
2. **Medicines come from the pharmacy's catalogue** through a new contract, **`MedicineCatalogue`** (find, search).
   A medicine can also be written by name. The product's name is copied onto the prescription, so later renames
   don't change what was prescribed.
3. **Templates per doctor.** A doctor keeps named sets of medicines, tests and advice, with a diagnosis.
   * The client fetches a template and puts its lines into the prescription it is writing.
   * Each doctor also has pick lists for complaints, history, examination, diagnosis, advice and doses.
   * Shared lists (no doctor) take the place of the old global dose list and are kept with `rx:manage`.
   * A dose may be tied to a generic.
4. **EMR special orders** (endoscopy and the like) are left to step 11b.
5. **Portal OTP** is left to step 11d.

Other decisions:

* **One prescription per appointment.**
  * It is opened on the appointment's day, while the appointment is not cancelled or a no-show, once the patient is
    registered.
  * The doctor is the appointment's doctor.
  * Without an appointment (old RxType 2), a patient and a doctor are named.
  * The visit number counts the patient's prescriptions with that doctor, not counting cancelled ones.
  * Old RxType 1 (indoor) was never used; indoor notes are step 11b.
* **Who does what.**
  * **The doctor's assistant** (`rx:vitals`) opens visits, takes vitals and cancels a draft, for any doctor.
  * **A doctor** (`rx:write`, signed in with the user account set on the doctor) does the same for their own
    patients only. Only they write, sign and reopen their own prescriptions.
  * Anyone else gets `not_your_patient` (403). A user who is not a doctor gets `not_a_doctor`.
* **Signing.**
  * A prescription is signed once something is prescribed: a diagnosis, a medicine, a test or an advice. Only a
    signed one is printed.
  * It is reopened for a correction on the visit's day only (`rx_locked` after that). It then stays a draft until
    signed again.
  * One signed even once is never cancelled. Only a draft never signed is cancelled (the patient left).
* **The appointment's state is not changed.**
  * The old *Vital* / *Prescribed* states are not copied onto the appointment.
  * The prescription's own state (draft, signed, cancelled) says it, and the appointment links to it by
    `appointmentId`.
* **Tests are not billed by the prescription.** The diagnostic counter finds the prescription by number
  (`GET clinical/prescriptions?number=`) and bills its tests, as before.
* **Vitals checks.**
  * Weight 0.5–400 kg, height 20–260 cm, pressures 40–300 / 20–200, pulse 20–250, temperature 86–113 °F, SpO2 40–100.
  * Blood pressure needs both values, with the systolic above the diastolic.
  * BMI is worked out from weight and height.
* **Patients, doctors and appointments** are read through the existing `PatientDirectory` and a new
  **`OutpatientClinic`** contract (`doctorOfUser`, `doctors`, `appointment`) published by the hospital.
* **Tests to prescribe** are found through a new `DiagnosticOrders.searchTests`, so doctors don't need `diag:read`.
* **Numbering:** `RX-<year>-00001`, yearly.

## API (`/api/v1/clinical`)

| Endpoint | Who | What |
|---|---|---|
| `GET prescriptions`, `GET prescriptions/:id` | `rx:read` | Filters: doctor or `mine=true`, patient (their history), from / to, state, number |
| `POST prescriptions` | `rx:vitals`, or the doctor | Open a visit: `appointmentId`, or `patientId` + `doctorId` |
| `PUT prescriptions/:id/vitals` | `rx:vitals`, or the doctor | Weight, height, BP, pulse, temperature (°F), SpO2 of a draft |
| `PUT prescriptions/:id` | the doctor (`rx:write`) | The whole prescription (lines replaced) |
| `POST prescriptions/:id/sign` / `reopen` | the doctor (`rx:write`) | Sign; back to a draft on the visit's day |
| `POST prescriptions/:id/cancel` | `rx:vitals`, or the doctor | A draft never signed |
| `GET phrases` | `rx:read` | Shared phrases plus the signed-in doctor's own, by kind, text or generic |
| `POST` / `PUT` / `DELETE` `phrases` | `rx:write` (own), `rx:manage` (`shared`) | Pick lists |
| `GET` / `POST` / `PUT` / `DELETE` `templates` | `rx:write` | The doctor's own templates |
| `GET medicines?q=`, `GET tests?q=` | `rx:read` | Active products by brand or generic; active tests by name or code |

## Report

**`clinical.prescription`** (`prescriptionId`), PDF, signed prescriptions only. It shows:

* **Heading:** the doctor (degrees, speciality) and the organisation.
* **Patient line:** age, sex, UHID, date, visit number, Rx number and barcode.
* **Left column:** complaints, history, examination with the vitals, diagnosis, investigations and plan.
* **Right column (℞):** medicines with dose, duration and quantity, then advice, notes, referral, follow-up and the
  signature.
* **Fonts:** the font list includes Bengali fonts, for Bangla doses and advice.

## Not ported here

* **AI suggestions, dictation and drug interaction checks**, per-doctor print profiles and layouts, section styles.
  The print has one layout.
* **Auto-learnt doses** (DigitalRx wrote unknown doses back to the doctor's list). Doses are added on purpose.
* **Bangla number and unit conversion of doses.** A dose is printed as written.
* **Procedure indents** (`OPDProdureSuggession`), relevant-history checklists, sonologist and ophthalmology extras,
  department-wise JSON features.
* **Visit discount on the Rx** (old `VisitHistory.Discount`): discounts belong to the bills.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
  * The clinical module reads patients, doctors, appointments, medicines and tests only through contracts.
* Migration `0049_clinical_rx`: 8 tables.
* `npm test`: 370 passed. New: `test/unit/clinical/prescription.spec.ts` covers:
  * vitals ranges and BMI;
  * content checks: names, doses, follow-up date, duplicate tests;
  * templates;
  * signing needs something prescribed;
  * same-day reopening;
  * no cancelling once signed;
  * stale versions;
  * age text.
* `npm run test:int`: 16 passed (migration count 50, new tables).
* `npm run test:e2e`: 143 passed. New: `test/e2e/clinical-rx.e2e-spec.ts` covers:
  * **Open and vitals:**
    * an appointment opened twice;
    * vitals out of range.
  * **Searches:** medicine and test.
  * **Writing:**
    * the assistant and another doctor refused;
    * a stale version;
    * a follow-up before the visit;
    * sign, then view (BMI, names from the catalogues, doctor and patient);
    * writing after signing refused;
    * same-day reopen and re-sign;
    * cancelling a signed one refused.
  * **Print:** the print, and an unsigned one refused.
  * **Walk-in:**
    * a doctor may not open for another doctor;
    * visit number 2;
    * an empty one cannot be signed;
    * cancelled by the assistant.
  * **Lists:** `mine`, by number and by doctor.
  * **Pick lists:**
    * own vs shared;
    * duplicates;
    * shared needs `rx:manage`;
    * a dose per generic;
    * another doctor's phrase not found.
  * **Templates:**
    * an empty one refused;
    * duplicate name;
    * names from the catalogues;
    * another doctor's not found;
    * stale update;
    * delete.
* **Visual check of the print** (screenshot), with Bangla doses and advice.
  * It caught the durations printing empty: `{{duration}}` hit the report engine's `duration` helper.
  * The template reads `this.duration`.
* Dev server restarted; readiness 200.
