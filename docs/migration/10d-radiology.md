# Step 10d — Radiology: imaging studies, reports and reporting fees

Status: **done** (2026-10-28). Previous: [step 10c](10c-laboratory.md) · Next: [step 10e](10e-lab-reagents.md)
(reagents); transfusion medicine follows as 10f.

Radiology is added to the **laboratory module**:

* report templates per imaging test;
* studies with accession numbers;
* reports written and signed by the radiologist;
* the radiologist's reporting fee on the hospital's doctor ledger;
* the imaging report, held while the patient owes.

## Where the old logic lives

CoxBazar:

* **Report entry and publishing.** `/diagnostic/radiological-report-entry`, `…-finalization`, `…-published`, writing
  `Diag.RadiologyReports` with `RadiologyTemplates` and `Modalities`.
* **The worklist.** It runs on the bill line's `AccessionNumber` (`UNP.GetNextAccessionNumber`), `SOPInstanceUID` and
  `ProcedureStep` for the modality worklist. The API `RISController.GetRISInfoByAccessionNumber` serves the PACS side.
* **Reporting fees.**
  * `Diag.TestWiseReportingFees` (doctor × test: % or amount) and `TestGroupWiseReportingFees`.
  * Worked out by `Diag.fnRadiologyReportingFee` for the payment sheet (`RadiologyConsultantPaymentSheet*`).
  * Marked paid with `IsReportingFeePaid` on the bill line.

## Decisions (step 10c's open questions; "next" without answers, so the recommendations)

1. **Radiology lives in the laboratory module, apart from the lab:**
   * report templates per imaging test (name, findings, impression);
   * studies of their own.

   Lab tests and imaging tests refuse each other's templates (`not_lab_test`, `not_imaging_test`).
2. **No sample:** an imaging test is marked **done** with an accession number of the day (`AC-yymmdd-0001`). There is
   no DICOM or modality-worklist link.
3. **The radiologist signs the report (`lab:verify`); no second verifier.** The report must have findings, an
   impression and the radiologist (a doctor of the hospital) before it is signed. A signature is taken back for a
   correction before the report is handed over.
4. **The reporting fee is a share of the test's rate (`reportingFeePercent`) or an amount (`reportingFeeAmount`, never
   above the rate), set on the diagnostic test.**
   * It is credited to the radiologist's doctor ledger when the report is signed: Dr `reporting_fee_expense` /
     Cr `consultant_payable`.
   * It is taken back when the signature is taken back, and paid with the doctor payments of 9g.
   * It goes through a new contract, **`ReportingFees`**, published by the hospital: the lab never writes the
     hospital's ledger.
5. **Delivery is held while the patient owes** on the bill (403 `due_outstanding`), unless `lab:manage` lets it go,
   as for lab reports.

Other decisions:

* **A test is done once** (409 `already_done`), and a cancelled test is not done.
* **`DiagnosticOrders` gains `doctors`,** so the lab can name and check the radiologist.
* **Per-doctor fees and test-group fees are not ported.** The fee is per test; one radiologist reports a study.

## API (`/api/v1/lab`)

| Endpoint | Who | What |
|---|---|---|
| `GET` / `PUT tests/:testId/imaging-templates` | `lab:read` / `lab:manage` | The whole list of an imaging test's report templates |
| `POST imaging-studies` | `lab:result` | `billId`, `line`: the imaging test done, with its accession number |
| `GET imaging-studies`, `GET imaging-studies/:id` | `lab:read` | By state, bill, radiologist and day; with the bill, patient, test, radiologist's name and the test's templates |
| `PUT imaging-studies/:id/report` | `lab:result` | `version`, findings, impression, radiologist (before signing) |
| `POST imaging-studies/:id/sign` | `lab:verify` | Signed for the radiologist; returns the reporting fee credited |
| `POST imaging-studies/:id/unsign` | `lab:verify` | Back to written; the fee comes back off |
| `POST imaging-studies/:id/deliver` | `lab:result` | Handed over to whom (held while the patient owes, unless `lab:manage`) |

`/hospital/diagnostic-tests` gains `reportingFeePercent` and `reportingFeeAmount`.

## Report

**`laboratory.imaging-report`** (`studyId`) shows:

* the test as its title;
* the patient, UHID, age and sex;
* the accession number with its barcode, the bill, when it was done and signed, and the referring doctor;
* the findings and the impression as written;
* the radiologist's signature.

A report not signed is refused (`not_signed`).

## Not ported here

* **DICOM / PACS, the modality worklist (MWL), SOP instance UIDs and procedure steps.**
* **Modalities and rooms as records.**
* **Reporting fees per doctor or per test group, and the reporting fee payment sheet.** The doctor ledger and the 9g
  doctor payments cover the payment.
* **Imaging done for admitted patients without a bill.** Every study comes from a diagnostic bill (10b).

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. The laboratory module credits
  fees only through `ReportingFees`.
* Migration `0046_radiology`: 3 tables, and the test's reporting fee
* `npm test`: 349 passed. The new `test/unit/laboratory/imaging.spec.ts` covers:
  * **Templates:** a name, findings and impression each, names once.
  * **A study:**
    * not signed before it is written;
    * signed with its fee;
    * not rewritten once signed;
    * reopened with the fee to take back;
    * handed over only when signed, and not reopened after.
* `npm run test:int`: 16 passed (migration count 47, new tables)
* `npm run test:e2e`: 138 passed. The new `test/e2e/radiology.e2e-spec.ts` covers:
  * **Templates and studies:**
    * templates refused for a lab test;
    * a study done with its accession number, refused twice and for a lab test on the bill;
    * the template read back.
  * **Signing:**
    * a signature refused before the report is written, and to the technologist;
    * signed by the radiologist, with 25 % of 600 on her ledger;
    * the report printed.
  * **A correction:** the signature and fee taken back, the report corrected and signed again.
  * **Books and delivery:**
    * the GL closings;
    * delivery held while unpaid, then let go by a manager;
    * no reopening after;
    * the radiologist's list.
* Imaging report checked visually
* Dev server restarted; readiness 200
