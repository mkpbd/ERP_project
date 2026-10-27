# Step 10a — Diagnostics: test catalogue and diagnostic billing

Status: **done** (2026-10-27). Previous: [step 8i](08i-pharmacy-ward-medicine.md) · Next: step 10b (tests of admitted
patients and diagnostic bills in the hospital statements).

Step 10 is split:

| Step | Covers |
|---|---|
| **10a** | The test catalogue and the diagnostic bill: report times, discount, referral commission, cancelling tests, dues, corporate collection |
| **10b** | Tests of admitted patients on the indoor bill; diagnostic bills in the 9g statements |
| **10c** | Lab: samples, results, verification, report printing |
| **10d** | Radiology reports |
| **10e** | Reagents and transfusion medicine |

Diagnostic billing lives in the **hospital module**. It shares the hospital's:

* patients and payers (corporate clients, staff);
* the credit limit;
* the doctor ledger and doctor payments;
* the corporate collection.

The lab, radiology and blood bank steps will go to their own modules behind a contract.

## Where the old logic lives

CoxBazar:

* **Catalogue.**
  * `Diag.ParentGroup` (Pathology, Radiology …).
  * `Diag.TestItems`: one rate for OPD and indoor, `IsDiscountAllow`, the report day and hours.
  * `Diag.OPDPackages` / `OPDPackageTestItems`: `PackageRage` is each test's rate inside the package.
  * Report-delivery slots.
  * Discount groups per corporate client.
* **The invoice.** `/diagnostic/investigation`, saved by `CreateInvestigationInvoiceFullCommand` into
  `Diag.InvestigationInvoices`, `InvestigationInvoiceDetails` and `InvestigationInvoiceLedgers`.
  * The due is never stored; it is always worked out from the ledger rows.
  * A walk-in patient is registered on the spot.
  * The referring doctor and a marketing area are mandatory.
  * Discounts are per line, capped by a discount category's maximum.
  * Each line carries `ProbableReportDeliveryDateTime`.
* **Cancelling.** Per test, approved first, then done (Cancel, DiscountAdjustment and Refund rows).
* **Dues.** `/diagnostic/due-collection` and `/diagnostic/corporate-client-collection`.
* **Referral / marketing commission.** A percentage per test and per commission group of the doctor's
  media/marketing officer (`Marketing.CommissionSetups`).
  * It was never stored: `SpGetMediaCommissionStatementForHospitalAndDiagnostic` worked it out when asked.
  * It was paid on `/account/media-payment`.
* **Receipt.** `PrintInvestigationInvoiceDocument` ("Cash Memo", QuestPDF).
* **Books.** No voucher was posted for OPD diagnostic invoices.

## Decisions (step 8i's open questions; "next" without answers, so the recommendations)

1. **Step 10 is split** as above.
2. **A diagnostic bill of its own** (`DB-`; dues `DR-`), with the OPD rules:
   * the patient's corporate client by default;
   * a cash client pays in full;
   * a credit client is held to its limit;
   * a staff member's bill goes to the staff receivable;
   * a counter limit on the discount, with `diag:discount` above it;
   * cancelling on the bill's day by the counter, later by a manager.
3. **Tests of admitted patients on the indoor bill:** step 10b.
4. **The referring doctor's commission** is a percentage of each test's rate. It is the doctor's own (`referralPercent`
   on the doctor), else the test's, else the diagnostic policy's default.
   * It is earned when billed and taken back when a test is cancelled.
   * It goes to the same doctor ledger as OPD and indoor shares, and is paid with doctor payments (9g).
   * Marketing officers, media and commission groups are not ported.
5. **Lab results with parameters, reference ranges and verification:** step 10c.

Other decisions:

* **Patients must be registered.** A walk-in is registered first (9a); the old page did it silently.
* **The referring doctor is optional** ("Self" on the receipt).
* **The discount is taken on the bill and shared over the tests that may be discounted**, in proportion to their rates.
  Tubes and government-rate tests are never discounted. A corporate client's own percentage applies to those tests.
* **Each test's report is due** at billing time plus the test's report hours. A test with none (a tube) shows no time.
* **A test is on a bill once** (422 `duplicate_test`). A package adds its tests at its rates.
* **Cancelling tests:**
  * By line, or all that are left, with a reason.
  * What the tests were worth after their part of the discount comes off the due first. Money beyond what is left is
    paid back by the method asked for.
  * A bill with no test left is cancelled.
* **Posted at once:**
  * Dr cash / card / wallet, the receivable (`diagnostic_receivable`, `corporate_receivable` or `staff_receivable`) and
    `diagnostic_discount` / Cr `diagnostic_income`.
  * Dr `referral_commission_expense` / Cr `consultant_payable`.
  * A cancellation posts the reverse, with the refund.

## Catalogue (record endpoints, `diag:read` to see, `diag:manage` to change)

| Path | What |
|---|---|
| `/hospital/diagnostic-departments` | Name (unique), kind (lab, imaging, other) |
| `/hospital/diagnostic-tests` | Code (unique), name (unique in its department), short name, department, specimen, room, rate, report hours, discount allowed, referral %, active |
| `/hospital/diagnostic-packages` | Name (unique), active; `PUT :id/tests` sets the whole list of its tests, each at its rate inside the package; `GET :id/tests` shows them with the list rates and the total |
| `/hospital/diagnostic-policy` | `GET` / `PUT`: the counter's discount % and the default referral % |
| `/hospital/doctors` | gains `referralPercent` |

## Diagnostic bills (`/api/v1/hospital`)

* **`POST diagnostic-bills`** (`diag:bill`):
  * patient;
  * referring doctor (optional);
  * payer (left out: the patient's corporate client);
  * `testIds` and `packageIds`;
  * discount and reason (null: the corporate client's own);
  * payment.

  Returns the number, net and due.
* **`GET diagnostic-bills`** (patient, referring doctor, period, status, `withDue`, corporate client; paged) and
  **`GET diagnostic-bills/:id`**. The bill shows each line's test, department, room, specimen, package, rate, its part
  of the discount, commission, report time and state, plus the payments.
* **`POST diagnostic-bills/:id/collections`** (`version`, amount, method, reference) collects a due.
* **`POST diagnostic-bills/:id/cancel`** (`version`, `lines` or all, reason, refund method) cancels tests.
* **`POST corporate-clients/:id/collections`** now settles diagnostic bills too (`kind: 'diag'`), oldest first with
  the company's OPD and indoor bills. The company's credit limit counts them.

## Reports

* **`hospital.diagnostic-receipt`** (`id`): the receipt on an 80 mm roll, with a barcode. It shows:
  * the patient, the referring doctor ("Self" when none), the payer;
  * each test with its department, room, package and report time (cancelled tests struck through);
  * the total, discount, tests cancelled, payable, payments and refunds, and due;
  * PAID, DUE or CANCELLED.
* **`hospital.referral-commission`** (period): per referring doctor:
  * tests sent and their billed value;
  * tests cancelled (on the day cancelled);
  * commission earned, taken back and net.

  PDF (landscape) and Excel.
* **`hospital.diagnostic-income`** (period): per department, tests and income billed, tests cancelled (on the day
  cancelled), income, discount and net. PDF (landscape) and Excel.

## Not ported here

* **Marketing officers, media, commission groups and areas** (`Marketing.MarketingJOfficerOrMedias`,
  `CommissionGroups`, `CommissionSetups`, `MarketingAreas`), and the media payment pages.
* **Discount categories and per-test corporate discount groups.** One discount with a reason and a counter limit
  replaces them.
* **Report-delivery slots, urgent tests and weekend rules.** Report hours per test replace them.
* **VAT on diagnostics.** The old page defaulted to 0.
* **Lab numbers, sample tubes and radiology accession numbers.** These come with steps 10c and 10d.
* **Radiologists' reporting fees** (`TestWiseReportingFees`): step 10d.
* **Rx links** (prescribed tests pulled into the bill): with the EMR.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0043_hospital_diagnostic_billing`:
  * 8 tables;
  * the doctor's referral %;
  * the doctor ledger's diagnostic bill.
* `npm test`: 340 passed. The new `test/unit/hospital/diagnostic-bill.spec.ts` covers:
  * the discount shared over the tests that may be discounted, the commission and report times, and no commission
    without a referrer;
  * the discount held to what may be discounted and to the counter limit, with a reason;
  * a test on a bill twice, overpayment and a cash client's part payment all refused;
  * cancelling one test (due cleared, the rest paid back), then the rest later by a manager;
  * collections.
* `npm run test:int`: 16 passed (migration count 44, new tables)
* `npm run test:e2e`: 134 passed. The new `test/e2e/hospital-diagnostics.e2e-spec.ts` covers:
  * **Catalogue and policy:**
    * departments and tests by a manager, refused to the cashier;
    * the policy refused to the cashier.
  * **A bill with a cancelled test:**
    * a bill over the counter's limit refused;
    * a bill with a tube that is not discounted, the lines' discount, commission and report times;
    * an X-ray cancelled with 120 paid back;
    * the referrer's ledger and every GL closing.
  * **A package and a collection:** a package at its own rates referred by a doctor with her own commission, collected
    later.
  * **Prints and sheets:** the receipt, the referral commission sheet, the income by department sheet.
  * **Corporate:** a company patient's X-ray on the company, settled by the company's payment with `kind: 'diag'`.
* Receipt, referral commission and diagnostic income checked visually (Bangla names)
* Dev server restarted; readiness 200
