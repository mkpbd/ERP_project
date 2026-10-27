# Step 10b — Diagnostics: admitted patients' tests and the hospital statements

Status: **done** (2026-10-27). Previous: [step 10a](10a-diagnostic-billing.md) · Next: step 10c (the lab: samples,
results, verification, reports).

This step:

* puts an admitted patient's tests on the indoor bill;
* brings diagnostic bills into the hospital statements of step 9g;
* adds a diagnostic collection sheet for each user.

## Where the old logic lives

CoxBazar:

* **The ward's indent.** `/hospital/ipdinvestigation-indent` (`Diag.IPDInvestigationIndents/Details`).
* **The invoice.** `ProcessIPDInvestigationInvoiceCommand` writes the same `InvestigationInvoices` with
  `IPDPatientRecordId` and the cabin, at the same rate as the OPD, usually unpaid.
* **Paying during the stay.** `Diag.IPDDueCollections`.
* **The final bill.** `spGetInvestigationInvoiceDetailsByPatientIdAndGroupType` gives the Pathology and Radiology heads,
  with the IPD service charge on them. `IsIPDPaid` is set once the bill is settled.
* **Books.** Posted only with integrated accounts on: Dr IPD receivable (patient) / Cr IPD sale.
* **Statements:** DiagDueList, DiagDiscountByEachPerson, IndoorOutdoorDepartmentWiseIncomeStatement,
  CorporateClientStatement, DiagUserwiseCollectionSummary / DiagnosticCollectionSummary.

## Decisions (step 10a's open questions; "next" without answers, so the recommendations)

1. **An admitted patient's tests are a diagnostic bill with the admission** (`admissionId` on `POST diagnostic-bills`).
   * They are charged to the stay: no payer, discount, payment or collection on the bill itself (422 `indoor_bill`).
     The final bill gives the discount and takes the payment.
   * The patient must be the admission's (422 `admission_mismatch`), still in, and not billed (409 `bill_made`).
   * The final bill adds an **Investigations** head, one line per diagnostic bill: what its tests still billed are
     worth.
   * The referring doctor's commission is earned as for any test.
2. **The indoor service charge applies to investigations**, as the old final bill charged it on pathology and radiology.
   The IPD policy's percentage is used.
3. **Diagnostic bills are in the statements:**
   * dues, discounts and the patient statement (bills and receipts);
   * income by head ("Diagnostic tests", billed and cancelled test by test, with their discounts);
   * the corporate statement.

   An admitted patient's tests never show as a due of their own; the indoor bill carries them.
4. **A diagnostic collection sheet per user**, the same sheet as the OPD's.
5. **No ward indent for tests.** The counter bills the admission's tests directly.

Other decisions:

* **Tests are cancelled before the final bill only.** After it, the bill must be cancelled first. Tests and the bill
  take the same admission lock.
* **An admission is not cancelled while it has tests billed** (409 `has_charges`).
* **Books:**
  * Billing: Dr `ipd_investigation_unbilled` / Cr `diagnostic_income` (the commission as usual).
  * The final bill credits `ipd_investigation_unbilled` for the Investigations head and `ipd_service_charge_income`
    for its service charge.
  * Cancelling tests before the bill credits `ipd_investigation_unbilled` back.

## API

* **`POST diagnostic-bills`** takes `admissionId`.
* **`GET diagnostic-bills`**:
  * filters by `admissionId`;
  * `withDue` leaves out admitted patients' bills;
  * bills show their `admissionId`.
* **`GET admissions/:id/account`** shows the Investigations lines.

## Reports

* **`hospital.ipd-bill`** has an Investigations group.
* **Statements now with diagnostic bills:**
  * `hospital.dues`: "Diagnostic", what is left after cancelled tests.
  * `hospital.discounts`.
  * `hospital.patient-statement`: bills and receipts.
  * `hospital.income-by-head`: a "Diagnostic tests" row.
  * `hospital.corporate-statement`: what is left after cancelled tests, collections.
* **`hospital.diagnostic-collection`** (period): per user, taken at billing, dues collected and paid back, by cash,
  card and wallet, with what to hand over. PDF and Excel. It is the OPD collection sheet over diagnostic payments.

## Not ported here

* **The ward's test indent.**
* **Paying for tests separately during the stay** (`Diag.IPDDueCollections`).
* **Pathology and radiology as separate heads on the final bill.** The income by department report splits them.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0044_hospital_indoor_tests`: the diagnostic bill's admission, with a check that it has no payer, discount
  or payment
* `npm test`: 342 passed. New cases:
  * an admitted patient's diagnostic bill refusing a payer, discount, payment and collection, and cancelling a test
    from it;
  * the Investigations line with the service charge.
* `npm run test:int`: 16 passed (migration count 45)
* `npm run test:e2e`: 135 passed. `test/e2e/hospital-diagnostics.e2e-spec.ts` now also covers:
  * **An admitted patient's tests:**
    * a payment and another patient refused;
    * no due listed;
    * a collection refused;
    * a test cancelled.
  * **The account and the final bill:**
    * the account's Investigations line with the service charge;
    * the admission's cancel refused;
    * the final bill paid, after which tests and cancellations are refused;
    * the GL closings.
  * **Statements:**
    * the cashier's collection sheet;
    * income by head with the Diagnostic tests row;
    * the patient statement;
    * the dues and corporate statements with a company's diagnostic bill.
* Indoor bill with Investigations checked visually
* Dev server restarted; readiness 200
