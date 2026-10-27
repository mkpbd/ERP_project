# Step 9g — Hospital: doctor payments, corporate collections, statements and the UHID merge

Status: **done** (2026-10-27). Previous: [step 9f](09f-hospital-indoor-bill.md) · Next: [step 8i](08i-pharmacy-ward-medicine.md)
(the pharmacy's indoor patients), then step 10.

This step closes the hospital's money:

* paying doctors their shares;
* a company paying its OPD and indoor bills together;
* the credit limit;
* the statements the old reports gave;
* merging a patient registered twice.

## Where the old logic lives

CoxBazar:

* **Doctor payments.**
  * Tables: `Hospital.SaveConsultancyPaymentRecords` (InvoiceNo, ConsultantId, PayDate, Amount, DateFrom, DateTo) with
    `SaveConsultancyPaymentRecordDetails` (one row per service paid).
  * The figures came from `SPGetDoctorPayment` and `SPIPDDoctorPaymentByDueFlag`. Their source is not in either repo.
  * No page is left in the web app, only the API and `PrintSaveConsultancyPaymentRecordDocument`.
  * `IsConsultancyPaId` on the service rows is never set by C#.
  * `Account.ConsultantGlobalLedger` exists but is unused.
* **Corporate collections.** Diagnostics and pharmacy only. The OPD and the wards had none.
* **Statements (rdlc, Hospital folder):**
  * HospitalDuePatientStatement;
  * HospitalDiscountStatement and IPDDiscountByEachPerson;
  * HospitalIncomeStatement, IndoorIncomeStatement and IPDServiceWiseIncomeReport;
  * DoctorPaymentSheet, DoctorPaymentSheetInvoiceWise and DoctorbasedSummryReport.
* **UHID merge.** There is none in either codebase. A duplicate was only deactivated, and its history stayed apart
  under its own UHID.

## Decisions (step 9f's open questions; "next" without answers, so the recommendations)

1. **Doctors are paid from their ledger.**
   * Any amount up to what they are owed, with a receipt number (`DP-`) and a voucher.
   * There is no per-service "paid" flag. The ledger of shares earned, taken back and paid is the record.
2. **A share is earned when the bill is made.** This is how 9c and 9f post it. A cancelled bill takes it back.
3. **A company's payment settles its OPD and indoor bills together**, oldest first, on one receipt and one voucher.
   * **The credit limit is checked at admission**: a credit client at or over its limit takes no more admissions for
     its people. The patient may still be admitted paying for themselves.
   * The final bill is never refused for it, so a discharge is never held up.
   * OPD bills are still held to the limit as in 9d, now counting indoor dues too.
4. **UHID merge** (`patient:manage`): the duplicate's records move to the record kept:
   * appointments;
   * OPD bills;
   * admissions (with their charges, advances and indoor bills, which hang off the admission);
   * indoor bills;
   * the UHID visit log.

   The duplicate is out of use for good: `mergedIntoId`, a reason, and it cannot be reactivated. Two open admissions
   are never brought together (409 `both_admitted`).
5. **Statements:** doctor payables, doctor ledger, patient statement, dues, discounts and income by head.

## Doctors (`/api/v1/hospital`)

* **`POST doctors/:id/payments`** (`doctor:pay`):
  * Body: `amount`, `method` (cash, card, mobile), `reference`, `note`.
  * More than the doctor is owed is refused (`overpayment`).
  * Posts Dr `consultant_payable` / Cr cash, card or wallet.
  * Returns the receipt number and what is still owed.
* **`GET doctors/:id/ledger?from&to`** (`opd:read`): what was owed before the period, then every entry (share earned,
  taken back, paid) with the running balance, the totals and what is owed after.

The doctor ledger (`hospital_doctor_ledger`) now holds:

* OPD shares (9c);
* indoor shares (9f, against `ipd_bill_id`);
* payments (`kind = 'payment'`, negative).

## Corporate clients

* **`POST corporate-clients/:id/collections`** settles OPD and indoor bills oldest first.
  * Each part is listed with its kind (`opd` or `ipd`).
  * An indoor bill's part becomes a collection on its admission's account. It has the company's receipt number, with
    `/2`, `/3` … when several indoor bills are settled.
* **Admission for a credit client at or over its limit:** refused (422 `credit_limit`).
* **`hospital.corporate-statement`** now lists the client's indoor bills next to its OPD bills. For an indoor bill,
  "paid at counter" is the advance taken and what was paid on the bill.

## Patients

**`POST patients/:id/merge`** (`patient:manage`):

* Body: the duplicate's `version`, the `intoId` of the record kept, and a `reason`.
* Both records are locked in a fixed order, under the same lock as admissions.
* Returns how many appointments, OPD bills, admissions, indoor bills and visits moved.
* The duplicate's photo and ID document stay with it.

## Reports

* **`hospital.doctor-payables`** (period): per doctor, owed before, earned, taken back, paid and owed after. PDF and
  Excel.
* **`hospital.doctor-ledger`** (doctor, period): every entry with the running balance and the totals. PDF and Excel.
* **`hospital.patient-statement`** (patient):
  * every OPD and indoor bill, with who pays, paid, due and status;
  * every receipt (payments, collections, advances, refunds);
  * what the patient owes, and what others owe for them.
* **`hospital.dues`** (optionally by payer kind or corporate client): every OPD and indoor bill still owed, oldest
  first, with the days since billing and totals by who owes. PDF (landscape) and Excel.
* **`hospital.discounts`** (period): OPD and indoor bills with a discount (cancelled bills left out), showing the
  bill, discount, %, reason and who gave it, with totals per user. PDF (landscape) and Excel.
* **`hospital.income-by-head`** (period):
  * Heads: OPD consultations and services; admission, bed, round, indoor service and service charge.
  * Each head shows billed, cancelled in the period (taken off on the cancel day, as in 8h) and net.
  * Then the discounts and the net income.

  PDF and Excel.
* **`hospital.doctor-consultations`** counts shares only, so payments are not read as reversals.

## Not ported here

* **Per-service doctor payment, duty / off-duty share rules and OT assistants' fees.** These are `ServiceIncomeShares`,
  `OTAssistantPayments` and the stored procedures whose source is lost.
* **Staff dues deducted from salary.** This needs payroll; the staff receivable is kept.
* **Medicine and investigations in the income and dues.** These come with the pharmacy's indoor sales (8i) and
  diagnostics (10).

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0041_hospital_doctor_payments_merge`: the doctor payments table, `merged_into_id` on patients, and the
  ledger's `payment` kind
* `npm test`: 332 passed. The patient spec covers a merge refused into itself or without a reason, then for good: no
  reactivation and no second merge.
* `npm run test:int`: 16 passed (migration count 42, new table)
* `npm run test:e2e`: 131 passed. The new `test/e2e/hospital-statements.e2e-spec.ts` covers three scenarios.
  * **Doctor payments:**
    * a doctor's OPD and indoor shares;
    * overpayment refused, and a payment refused to the cashier;
    * a manager's payment, the ledger and the GL closings;
    * the payables and ledger sheets;
    * income by head with the discount and net income;
    * the discounts sheet.
  * **Corporate:**
    * a company owing an OPD and an indoor bill;
    * its next admission refused over the limit, while a self-paying one goes through;
    * the dues sheet;
    * one payment settling both bills oldest first, the indoor receipt print, the corporate statement with both.
  * **Merge:**
    * a duplicate with an OPD bill and an open admission with an advance merged into the record kept;
    * refused to the cashier;
    * the counts moved, the duplicate merged for good, the admission and bill now under the kept record;
    * two open admissions refused;
    * the patient statement print.
* Payables, ledger, patient statement, dues, discounts and income by head checked visually (Bangla names)
* Dev server restarted; readiness 200
