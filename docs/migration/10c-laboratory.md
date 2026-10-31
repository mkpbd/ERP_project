# Step 10c — Laboratory: samples, results, verification and the lab report

Status: **done** (2026-10-28). Previous: [step 10b](10b-diagnostic-indoor-statements.md) · Next: [step 10d](10d-radiology.md)
(radiology reports and reporting fees).

This step adds a new **`laboratory` module**:

* each lab test's parameters and normal ranges;
* samples with lab numbers for the hospital's diagnostic bills;
* results entered, flagged, verified by someone else, printed and handed over.

## Where the old logic lives

CoxBazar:

* **Sample collection.** `/diagnostic/sample-collection` writes `Diag.SampleCollectionRecords`, with a lab number per
  sample tube from `SPGetNextLabNo` and `Diag.TestSamples`.
* **Lab acknowledgement.** `/diagnostic/sample-acknowledgement-lab` (`SampleStatus`, `SampleCarriers`).
* **Result entry.** `/diagnosis/pathology-result-entry` writes `Diag.PathologyReports/Details` against
  `ReportParameters`, with normal values by age in `AgeVariantNormalValue`. Culture and sensitivity have their own
  tables.
* **Verification.** `/diagnosis/pathology-result-finalized` (`ReportVerifiers`).
* **Publishing and delivery.** `/diagnosis/lab-report-published2` and `/diagnosis/report-delivery`.
* **Lab machines.** LIS machine interfaces (`LISPatientRecord`, `LISResultRecord`, `PathologicalMachine*`).

## Decisions (step 10b's open questions; "next" without answers, so the recommendations)

1. **A `laboratory` module** that reads the diagnostic bills through a new shared contract, **`DiagnosticOrders`**,
   published by the hospital. The contract gives:
   * the bill;
   * the patient with sex and birth date;
   * the referring doctor;
   * who pays and what is still due;
   * each test with its department and state.

   The lab never reads the hospital tables, and the hospital needs nothing from the lab.
2. **One lab number per bill per lab department** (`LB-yymmdd-0001`, counted per day), not one per tube.
   * The sample holds every test of the bill in that department not already in work.
   * Imaging and cancelled tests are left out.
3. **A template per test:**
   * parameters in order, each with unit, method, numeric or text, and decimals;
   * normal ranges by sex (or either) and age in days.

   Results are entered against it. The patient's range (their own sex first, then either) is copied with each value.
   A number below or above it is flagged low or high. Culture and sensitivity and free-text reports come later.
4. **Entered by the lab (`lab:result`), verified by someone else (`lab:verify`; 403 `same_person`).**
   * Only verified results are printed, signed with the verifier's name.
   * A verification is taken back for a correction, never after the report is handed over.
5. **Handing over:** the sample's verified reports are handed over with who collected them. While the patient owes on
   the bill, the report is held (403 `due_outstanding`) unless `lab:manage` lets it go. Company, staff and admitted
   patients' bills are not held.

Other decisions:

* **A rejected sample** (haemolysed, too little …) frees its tests to be collected again on a new sample and lab
  number. A verified result is never thrown away by a rejection.
* **Values are copied when entered.** A value keeps its parameter's name, unit, method and range as they were, so a
  template changed later does not change a report already made.
* **Only tests of a lab department** take a template (`not_lab_test`). A result is entered only once the lab has
  taken the sample in.

## API (`/api/v1/lab`)

| Endpoint | Who | What |
|---|---|---|
| `GET` / `PUT tests/:testId/parameters` | `lab:read` / `lab:manage` | The whole list of parameters with their ranges |
| `POST samples` | `lab:collect` | `billId`, `departmentId`: a sample with a lab number and the tests waiting on it |
| `GET samples`, `GET samples/:id` | `lab:read` | By state, department, bill and day; with the bill number, patient, department and every result |
| `POST samples/:id/receive` | `lab:result` | Taken in by the lab |
| `POST samples/:id/reject` | `lab:result` | With a reason; its tests are collected again |
| `POST samples/:id/deliver` | `lab:result` | Verified reports handed over to whom (held while the patient owes, unless `lab:manage`) |
| `GET results` | `lab:read` | The worklist by state, sample and day, with the test name |
| `GET results/:id` | `lab:read` | The result with the template and the patient's ranges to enter against |
| `PUT results/:id` | `lab:result` | `version`, values (`parameterId`, `value`), comment |
| `POST results/:id/verify`, `POST results/:id/unverify` | `lab:verify` | `version` |

## Report

**`laboratory.lab-report`** (`sampleId`) shows:

* the patient, UHID, age and sex;
* the lab number with its barcode, the bill, the collection time and the referring doctor;
* every verified test with its values, unit, normal range and H / L marks, and the comment;
* a note when tests of the sample follow later;
* the verifier's signature.

It is refused (`not_verified`) while nothing of the sample is verified.

## Not ported here

* **Sample tubes and barcodes per tube, sample carriers.**
* **Lab machine interfaces (LIS).**
* **Culture and sensitivity, histopathology and other free-text reports.** Done in [step 15b](15b-culture-and-written-reports.md).
* **Report delivery by SMS or the patient portal.**
* **Lab worklist and turnaround reports.**

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. The laboratory module talks to
  the hospital only through `DiagnosticOrders`.
* Migration `0045_laboratory`: 6 tables
* `npm test`: 347 passed. The new `test/unit/laboratory/lab.spec.ts` covers:
  * **Templates:**
    * names once, ranges from low to high, no numbers on a text result;
    * the patient's range by sex and age.
  * **Values:**
    * flags below and above the range;
    * text kept;
    * a non-number refused.
  * **Samples:** the lab number of the day; taken in or rejected once.
  * **Results:**
    * entered;
    * verified only by someone else;
    * reopened for a correction;
    * handed over;
    * no rejection once verified.
* `npm run test:int`: 16 passed (migration count 46, new tables)
* `npm run test:e2e`: 137 passed. The new `test/e2e/laboratory.e2e-spec.ts` covers:
  * **Templates:** set by a manager, refused to the collector and for an imaging test.
  * **Collecting:**
    * a sample of the lab's two tests with its lab number;
    * a second collection, and one for the imaging test, refused.
  * **Entering:**
    * a woman's ranges in the template;
    * a value refused before the sample is taken in;
    * a low haemoglobin flagged;
    * a test without a template refused.
  * **Verifying:**
    * refused to the technologist, and to the pathologist on a result she entered;
    * verified by her on the technologist's entry.
  * **The report and delivery:**
    * the report printed;
    * delivery held while the patient owes, then handed over after the due is collected;
    * no reopening after delivery;
    * the worklist of pending tests.
  * **A rejected sample:** collected again under a new lab number; its report refused until something is verified.
* Lab report checked visually (Bangla names)
* Dev server restarted; readiness 200
