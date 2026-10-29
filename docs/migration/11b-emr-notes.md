# Step 11b — EMR: notes, handovers, death and birth records

Status: **done** (2026-10-30). Previous: [step 11a](11a-prescriptions.md) · Next: step 11c (treatment orders).

What this step adds to the `clinical` module, for admitted patients:

* **Notes**, one kind each:
  * a doctor's round;
  * a consultation;
  * a procedure;
  * a transfer;
  * the ICU course;
  * a nurse's **handover**, acknowledged by the nurse taking over.
* **Note templates.** Shared text a note starts from, such as an endoscopy form.
* **Death records** and **birth records**, each with a certificate.
* **The case notes print.**

## Where the old logic lives

CoxBazar, `EMR` (`src/Core/Domain/Entities/EMR/`):

* **Notes:**
  * `ConsultancyVisitNote`, `DoctorVisitPlan` (doctor, assistant doctor, visit time);
  * `ProcedureNote`, `TransferNotesEMR` (department), `ICUCourse`;
  * `NurseToNursePatientHandOverRecord` (handed over by / to, `IsReceipantAcknowledged`), `HandOverSheet`.
* **Templates and order forms:** `OTTemplate`, `OTTemplateGroup`, and the special order forms
  (`EndoscopyEMROrder`, `ERCPEMROrder`, `ColonscopyEMROrder`, `ZolendronicEMROrder`).
* **Records:** `DeathRecord` (date and time, NIDs, guardian, family contact; detail and common-data groups),
  `BirthCertificate` (child, sex, place, father, religion, grandfather, time, delivery mode, weight, addresses).
* **Left for step 11c:** the treatment side (`TreatmentDoseTiming`, `AppliedMedicationDose`, `TreatmentOnDischarge`,
  `DietOnDischarge`, `AdvicesOnTreatment`, …).

## Decisions (step 11a's open questions; "next" without answers, so the recommendations)

1. **Scope:**
   * notes (round, consultation, procedure, transfer, ICU course, handover);
   * death and birth records.

   Treatment orders become step 11c; nutrition moves to 11d and the patient portal to 11e.
2. **One note table with a kind**, not one table per old entity. A new kind is a value, not a table.
3. **The death and birth records are records only.** A death record doesn't discharge the patient or change the
   stay: it is billed and closed as now.
4. **Three permissions:**
   * `emr:read`;
   * `emr:write`, for doctors and nurses;
   * `emr:certify`, for death and birth records.

   Note templates use the existing `rx:manage`, which now covers every shared clinical list.
5. **The special order forms are not ported one by one.** A procedure note started from a template covers them.

Other decisions:

* **Notes are written while the patient is admitted.**
  * The time noted may be earlier (written up later), but not before the day admitted and not ahead of now (5 minutes'
    slack).
  * A round or consultation names the doctor. A doctor signed in names themself by default.
  * A handover, and only a handover, names the user taking over. It cannot be to oneself.
* **Corrections.** Only its writer corrects a note, within **24 hours**; after that a new note is written. Corrected
  notes print as "corrected".
* **Handovers** wait in the taker's `handovers/pending` until acknowledged. Only the taker acknowledges.
* **A death record:**
  * one in force per admission, during the stay, with a certifying doctor and an immediate cause;
  * optionally: the antecedent cause and other conditions, NIDs (10, 13 or 17 digits), the guardian and their
    relation, and a mobile number for the family.
* **A birth record:**
  * only on a woman's admission, one per child (twins: two);
  * sex, time, delivery mode (normal, caesarean, assisted), weight 0.3–7 kg kept to 10 g, the attending doctor;
  * optionally: the child's name, the father, grandfather, religion and addresses. The place of birth is the
    organisation.
* **Voiding.** A record made in error is voided with a reason (`emr:certify`). It is kept, marked void, and no
  longer printed; a new one may then be recorded.
* **Numbering:** `DTH-<year>-00001` and `BRT-<year>-00001`.
* **Admissions** are read through `InpatientRegister`, patients through `PatientDirectory`, doctors through
  `OutpatientClinic`, users through `UserDirectory`.

## API (`/api/v1/clinical`)

| Endpoint | Who | What |
|---|---|---|
| `GET admissions/:id/notes?kind=` | `emr:read` | The stay's notes, oldest first, with doctor, writer and taker names |
| `POST admissions/:id/notes` | `emr:write` | `kind`, `note`, `doctorId`, `notedAt`, `handedTo` |
| `PUT notes/:id` | `emr:write` (the writer) | Correct within 24 hours (`version`) |
| `GET handovers/pending` | `emr:read` | Handovers to me not acknowledged, with admission and patient |
| `POST notes/:id/acknowledge` | `emr:write` (the taker) | Acknowledge a handover |
| `GET admissions/:id/records` | `emr:read` | The death record in force and the births |
| `POST admissions/:id/death-record`, `POST admissions/:id/birth-records` | `emr:certify` | Record |
| `POST death-records/:id/void`, `POST birth-records/:id/void` | `emr:certify` | Void with a reason (`version`) |
| `GET` / `POST` / `PATCH` `note-templates` | `rx:read` / `rx:manage` | Name, kind, body |

## Reports

* **`clinical.case-notes`** (`admissionId`): the stay's notes in time order. Each shows the doctor, the writer,
  whether it was corrected, and handover acknowledgements.
* **`clinical.death-certificate`** (`deathRecordId`), void ones refused. It shows:
  * the deceased, with UHID, sex, age at death and NID;
  * the admission;
  * the time of death and the causes;
  * the guardian;
  * the certifying doctor.
* **`clinical.birth-certificate`** (`birthRecordId`), void ones refused. It shows:
  * the child, the time and place of birth, the delivery and the weight;
  * the mother (UHID, admission), the father and the family;
  * the attending doctor.

## Not ported here

* **The special order forms field by field** (endoscopy, ERCP, colonoscopy, zoledronic acid) and OT template groups:
  templates instead.
* **The assistant doctor on a round** (`DoctorVisitPlan.AssistantDoctorId`): the writer is recorded.
* **Death record common-data groups** (pick lists of causes): free text.
* **Department-wise handover sheets** (`HandOverSheet` JSON): handover notes.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
* Migration `0050_clinical_emr`: 4 tables.
* `npm test`: 376 passed. New: `test/unit/clinical/emr.spec.ts` covers:
  * **Notes:**
    * a doctor on rounds, a taker on handovers only;
    * an empty note refused;
    * the writer corrects within 24 hours;
    * the taker acknowledges once;
    * notes fall within the stay.
  * **Records:**
    * cause, NID and mobile checks;
    * birth weight.
* `npm run test:int`: 16 passed (migration count 51, new tables).
* `npm run test:e2e`: 145 passed. New: `test/e2e/clinical-emr.e2e-spec.ts` covers:
  * **Notes:**
    * a round without a doctor refused;
    * a doctor's round names them;
    * a note ahead of now refused;
    * a handover pending, refused to another nurse, then acknowledged;
    * a correction by someone else refused, by the writer accepted;
    * the list and the kind filter.
  * **Templates:** a template kept with `rx:manage` only.
  * **Reports:** the case notes print.
  * **Death records:**
    * `emr:certify` needed;
    * a second refused;
    * the certificate;
    * a void, after which the certificate is refused and a new record allowed.
  * **Births:**
    * none on a man's admission;
    * weight checked;
    * twins;
    * the records view;
    * the birth certificate.
* Dev server restarted; readiness 200.
