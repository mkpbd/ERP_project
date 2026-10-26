# Step 9c — Hospital: OPD consultation billing

Status: **done** (2026-10-26). Previous: [step 9b](09b-hospital-doctors-appointments.md) · Next: step 9d (OPD and
emergency service billing).

## Where the old logic lives

CoxBazar:

* **Billing:** the Consultation Fee page (`/opd/service`, `ConsultationFee.razor.cs` `SaveAsync`), with
  `OPD.PatientRecordConsultancyFees` / `ConsultancyDetails` / `OPDConsultancyLedger`, `Account.ConsultantGlobalLedgers`
  and `Admin.UHIDUsesRecords`.
* **Dues:** `/opd/bill-collection` (Consultation tab).
* **Cancellation:** `/opd/cancel-service` and `/opd/cancel-approval`.
* **Receipt:** `PrintOPDServiceRecieptDocument.rdlc`.
* **Reports:** `OPDCollectionSummary`, `OpdUserwiseCollectionSummary`, `OutdoorConsutationFee` and
  `OPDConsultancyStatement`.

The old billing had these faults; this step fixes them:

* **No transaction.** Each part was saved on its own, so a failed invoice number became invoice 0, and a double click
  made two invoices (BUG-013).
* **Doctor's share.** It was written at a hard-coded **40 % against the bill line's id instead of the doctor**, could
  not be traced to anyone, and was never taken back on a cancellation.
* **Discounts** had no limit and no approval.
* **Cancellation** skipped the approval page.
* **No voucher was posted to accounts.**
* **The follow-up visit type** was chosen by hand.

## OPD policy (`GET` / `PUT /hospital/opd-policy`, `opd:manage` to change)

* **`followUpDays` (default 30).** A visit to the same doctor within these days is suggested as a **follow-up**,
  otherwise **new**. First visits and report showings are chosen by hand. Booking (9b) and billing both use it when no
  visit type is given. `GET /hospital/opd-bills/visit-suggestion?patientId&doctorId` shows the type, the last visit and
  the fee.
* **`defaultSharePercent` (default 40, as before).** The doctor's share when the doctor has none of their own. Doctors
  gained `sharePercent`.
* **`counterDiscountPercent` (default 10).** The discount a counter may give without `opd:discount`.

## Bills (`/api/v1/hospital/opd-bills`, `OC-<year>-<serial>`)

* **`POST /`** (`opd:bill`):
  * a **registered** patient;
  * optionally the appointment it comes from, and a referring doctor;
  * 1–10 lines, each with a doctor who sees patients here and an optional visit type;
  * the discount, with its reason;
  * the payment (cash, card or mobile wallet, with a reference).
* **Fees and shares.** Each line's fee is the doctor's fee for the visit type. The share is the doctor's percentage, or
  the policy's, of the fee, to the paisa.
* **Discount limit.** A discount above the counter's limit is 403 `discount_limit` without `opd:discount`. It is never
  more than the bill.
* **Due.** Less may be paid; the rest is due. More is refused (422 `overpayment`).
* **The appointment:**
  * must be booked or arrived and not billed (422 `appointment_billed`);
  * must have its doctor on the bill;
  * must be for the patient, or still unattached, in which case it is attached;
  * is marked arrived and tied to the bill.
* **In the same transaction:**
  * the bill is numbered;
  * the voucher is posted;
  * each doctor's share goes to **`hospital_doctor_ledger`** under that doctor;
  * the UHID's use is logged in **`hospital_uhid_uses`** (old `UHIDUsesRecords`, service `opd_consultation`).
* **Free consultations.** A consultation with a fee of 0 (a free report showing) posts no voucher.
* **`POST /:id/collections`** (`opd:bill`): collect what is still due. It gets its own receipt number
  (`OR-<year>-<serial>`) and voucher. With the bill's `version`; more than is due is refused.
* **`POST /:id/cancel`** (`opd:bill`): the whole bill, with a reason.
  * **On the bill's own day** by the counter; **later only with `opd:manage`** (403 `cancel_later`).
  * Everything paid and collected goes back **by the method it came in**.
  * The remaining due is cleared.
  * **The doctors' shares are taken back** (reversal rows in their ledger).
  * A reversing voucher is posted.
* **`GET /`** filters: patient, doctor, from, to, status, `withDue` (the due list). Paged.
* **`GET /:id`**: the patient, lines with doctors and rooms, shares, and every payment, collection and refund.

## Accounts (journal `JV`, GL roles)

| When | Debit | Credit |
|---|---|---|
| Billed | `cash_in_hand` / `card_receipts` / `mobile_wallet_receipts` (paid), `opd_receivable` (due), `opd_discount` | `opd_consultation_income` (gross) |
| Billed | `doctor_fee_expense` (shares) | `consultant_payable` |
| Due collected | the receipt account | `opd_receivable` |
| Cancelled | `opd_consultation_income`; `consultant_payable` | the receipt accounts (paid back), `opd_receivable` (due cleared), `opd_discount`; `doctor_fee_expense` |

## Reports

* `hospital.opd-receipt`: the receipt on an 80 mm roll. It has:
  * a Code 39 barcode of the bill number;
  * the UHID with prefix, the patient, age and mobile, and the referring doctor;
  * the doctors with room and visit type;
  * total, discount and payable;
  * each payment, collection and refund;
  * the due, the PAID / DUE / CANCELLED stamp, the amount in words and who printed it.
* `hospital.opd-collection` (old OPD collection summary): per user over a period, by cash, card and wallet. It shows
  what was taken at billing, dues collected, what was paid back, and the total to hand over. PDF and Excel.
* `hospital.doctor-consultations` (old outdoor consultation fee / consultancy statement): per doctor over a period.
  It shows:
  * visits by kind and fees;
  * visits and fees cancelled, **on their cancel date**;
  * net fees;
  * the share earned, taken back and net.

  PDF and Excel.

## Permissions

`opd:bill` (bill, collect, cancel on the day), `opd:discount` (above the counter's limit), `opd:manage` (policy,
cancel later).

## Decisions taken (after the first version of this step)

* The doctor's share is worked out on the gross fee: the hospital bears the whole discount, as before.
* A bill is cancelled as a whole and billed again; there is no cancelling of one doctor's line.
* Paying doctors their share (Dr consultant payable / Cr cash or bank) comes with step 9f, with the IPD consultant
  ledger.
* Corporate clients and staff billing come with step 9d.
* The fee stays the doctor's fee for the visit type; the counter cannot change it, only discount it.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0037_hospital_opd_billing`: 6 tables, the doctor's share percentage and the appointment's bill
* `npm test`: 316 passed. The new `test/unit/hospital/opd-bill.spec.ts` covers:
  * the visit suggestion at the edge of the days;
  * shares to the paisa (800 × 50 %, 333.33 × 33.33 % = 111.10);
  * the discount limit at exactly 10 % and one paisa above;
  * the reason needed, more than the bill, overpayment;
  * collections up to the due and not before the bill;
  * cancellation needing a reason, refused later to the counter, done by a manager with cash and card paid back by
    method;
  * a cancelled bill refusing collections.
* `npm run test:int`: 16 passed (migration count 38, new tables)
* `npm run test:e2e`: 123 passed. The new `test/e2e/hospital-opd.e2e-spec.ts` covers:
  * **Policy:** the defaults; the policy refused to the counter, set by a manager.
  * **Billing an appointment:**
    * the booking fee and the suggestion (new, 800);
    * a bill of Nusrat 800 at her 50 % and Kamal 600 at the policy's 40 %;
    * 150 off refused, 140 allowed;
    * 1,000 paid, 260 due;
    * the appointment arrived and not billed twice.
  * **Ledgers:** cash, receivable, discount, income, doctor fees and payable all as expected.
  * **Due list and collection:**
    * the due list;
    * a stale and an excessive collection refused;
    * 260 collected by card with an `OR` receipt;
    * the next visit to Nusrat suggested as a follow-up at 500.
  * **Cancellation:**
    * the bill cancelled on its day with 1,260 paid back (1,000 cash, 260 card);
    * every ledger back to 0;
    * the payments and refunds listed.
  * **Other bills:** a free report visit with no voucher; a manager's discount above the limit with the rest due.
  * **Reports:**
    * the receipt PDF;
    * the collection sheet: cash and card in, out, net 0;
    * the doctor sheet: Nusrat 1 new, 800 fees, 1 cancelled, share 400 earned and taken back.
  * **Refused bills:**
    * a doctor who does not see patients;
    * an appointment booked by name attached to the patient billed;
    * an appointment of another patient or without its doctor on the bill;
    * an unknown patient.
* Receipt, collection and doctor consultations checked visually (Bangla name, barcode)
* Dev server restarted; readiness 200
