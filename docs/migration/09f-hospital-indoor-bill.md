# Step 9f — Hospital: the indoor bill

Status: **done** (2026-10-27). Previous: [step 9e](09e-hospital-admissions.md) · Next: step 9g (doctor payments,
corporate collections across OPD and indoor bills, ledgers and statements, UHID merge).

This step bills the stay:

* services and consultant visits charged on the wards;
* advances taken and refunded;
* the final bill, which counts bed nights, the admission fee, the round fee and the service charge;
* discharge clearance;
* collecting what is still due after discharge.

Medicine and investigations join the bill when the pharmacy's indoor sales (step 8i) and diagnostics come.

## Where the old logic lives

CoxBazar:

* **The bill.** It is never stored while it grows. Every time it opens, it is recomputed from the source tables by
  `GetAllHospitalBillingGridQuery` and `HospitalBillingGridBuilder`.
* **Bed days.**
  * `spGetCabinOccupancyListByPatientId` turns each allocation into one row per day.
  * `ApplyGracePeriodAsync` applies the grace hours (`CabinChargeRules`).
  * `GetStayingDataForSpecificDate` applies the dearest-bed rule and the ICU rule.
* **Charges.**
  * `IPDServiceRecords` (page IPD Service Records).
  * `IPDConsultantServices`: a consultant visit was a service head priced from its rate, with the doctor picked beside it.
* **Advances.** `AdvancePayments` holds Payment and Refund rows with no receipt number. The pages are Advance Payment
  and Return Advance Payment.
* **Final bill.** `GenerateFinalBillingDashboardPage.SaveAsync` writes `FinalBills`, `FinalBillSummarys` (one row per
  head) and `FinalBillLedgers`.
* **Dues.** `IPDDueCollectionForDischargedPatientPage` adds DueCollection rows.
* **Prints.** QuestPDF: `PrintHospitalBillSummaryDocument`, `PrintHospitalBillDetails`, `PrintAdvancePayment` and
  `PrintIPDDueCollectionDocument`.

What changes from the old billing:

* **Nothing was ever final.** The bill was recomputed on every open, and discharged bills were edited in place. Now the
  final bill is saved with all its lines. It is changed only by cancelling it and billing again.
* **The settlement was never posted.** The voucher code for the final bill, discount and due collection was commented
  out. Only the advance and the charges reached the books. Now every money step posts its voucher.
* **The round fee and service charge were fixed elsewhere.** The round fee was 330 in the code, and the service charge
  was an app setting. Both are now in the indoor policy.
* **No discount limit and no role check** on charges or discounts. Now the counter has a limit, and `ipd:discount` is
  needed above it.
* **Advances had no receipt numbers.** Now every receipt is numbered.
* **The doctor's share of indoor work** came from a stored procedure that is not in the source (`SPGetDoctorPayment`).
  Now each doctor is credited their share when the bill is made, in the same doctor ledger as the OPD.

## Decisions (step 9e's open questions; "next" without answers, so the recommendations)

1. **Bed nights:**
   * every day from admission up to the day billed is one night;
   * the billing day is not a night;
   * a same-day stay has none;
   * a day with several beds is charged at the dearest one;
   * a day moved **out of** intensive care (ICU, HDU, CCU, NICU …) is charged at the bed moved to.

   This is the old rule.
2. **No grace hours.** Nights only.
3. **Discharge needs the final bill, made that day.**
   * A bill from an earlier day must be cancelled and made again (409 `stale_bill`).
   * A patient leaving with something of their own still due needs `ipd:manage` (403 `due_on_discharge`). The old page
     let this go with a remark.
   * A due owed by a company or a staff member does not stop the discharge.
4. **An advance can be taken with the admission** (`advance` on `POST admissions`), and at any time before the bill.
5. **An admission is not cancelled while it has charges, a bill or advance held.** The old system blocked this once
   charges existed. Cancel the charges and refund the advance first.

Other decisions:

* **More advance than the bill** is refused (`over_advance`); refund the difference first. This is the old rule.
* **A corporate client's discount** comes off unless the counter gives another, and the limit is the larger of the
  client's discount and the counter's.
* **A cash client's bill** is paid in full.
* **The credit limit** is not checked on indoor bills yet. It comes with 9g, together with corporate collections that
  cover both OPD and indoor bills.

## Indoor policy (`GET` / `PUT /hospital/ipd-policy`, `ipd:read` / `ipd:manage`)

* **Round fee per night.** Default 0; the old system charged 330. Set it at go-live.
* **Service charge %.** It applies to the admission fee, bed nights and round fee, not to services. Default 0.
* **Counter discount %.** The share of a final bill the counter may discount without `ipd:discount`. Default 10.

## The account (`/api/v1/hospital`)

### Charges (`ipd:bill`)

**`POST admissions/:id/charges`** adds a charge:

* It is a service marked `isIpd` and active. A consultant visit is a service such as "Consultant visit" with the
  doctor given.
* It takes a quantity and a day of the stay (today by default; never before admission or after today).
* It is charged at the service's rate. A service with a share needs the doctor who gave it.

**`POST admissions/:id/charges/:chargeId/cancel`** takes a charge off, with a reason.

Charges are taken only while the patient is in and before the final bill (409 `bill_made`).

### Advances (`ipd:bill`)

* **`POST admissions/:id/advances`:** an advance, numbered `AR-`, by cash, card or mobile wallet.
* **`POST admissions/:id/refunds`:** advance held given back, numbered `AF-`, at most what is held.

Both are refused once the bill is made.

### Final bill (`POST admissions/:id/final-bill`, `ipd:bill`, numbered `IB-`)

The bill is made of these lines:

* the admission fee kept at admission;
* one line per run of nights in a bed at its rate;
* the round fee for every night;
* the service charge on those three;
* every charge.

Then:

* The discount is taken off (with a reason). The advance held is taken against what is left.
* The rest is paid on the spot (receipt `IR-`) or owed by the patient, the company or the staff member.
* Each doctor is credited their share of their charges.

**`GET admissions/:id/account`** shows the bill in force, or what it would be today (an interim bill). It includes:

* the lines;
* the charges, including cancelled ones;
* every receipt;
* the advance held;
* the balance.

### After the bill

* **`POST ipd-bills/:id/cancel`** (with the bill's `version` and a reason) cancels the bill.
  * Only while the patient is in. The counter may do it on the bill's day; later needs `ipd:manage`.
  * Everything put in against the bill is held as advance again, and the doctors' shares are taken back.
* **`POST ipd-bills/:id/collections`** (with the bill's `version`) records a due collected, numbered `IR-`.
* **`GET ipd-bills`** filters by patient, period, status, `withDue` and corporate client. Paged.
* **`GET ipd-bills/:id`** returns the bill with its lines.

## Books

| Step | Debit | Credit |
|---|---|---|
| Advance | cash / card / wallet | `ipd_advance` |
| Refund | `ipd_advance` | cash / card / wallet |
| Final bill | `ipd_advance` (held), cash / card / wallet (paid), `ipd_receivable` / `corporate_receivable` / `staff_receivable` (due), `ipd_discount`, `doctor_fee_expense` (shares) | `ipd_admission_income`, `ipd_bed_income`, `ipd_round_income`, `ipd_service_income`, `ipd_service_charge_income`, `consultant_payable` (shares) |
| Bill cancelled | the incomes, `consultant_payable` | `ipd_discount`, the receivable (due), `ipd_advance` (all put in), `doctor_fee_expense` |
| Due collected | cash / card / wallet | the receivable |

Income is taken when the bill is made, as the old system did (charges were posted to the patient as they came, but the
settlement never was).

## Reports

* **`hospital.ipd-bill`** (`admissionId`): the final bill, or an interim bill before it is made. It shows:
  * the patient, stay, consultant, bed and payer;
  * every line under its head (admission, bed charges with their dates, round fee, services and visits with the
    doctor);
  * the totals, discount, advance taken, paid, collected and due, with the amount in words;
  * every receipt;
  * PAID, DUE or INTERIM.
* **`hospital.ipd-receipt`** (`number`): the receipt for an advance, refund, bill payment or due collection, printed on
  an 80 mm roll with a barcode.
* **`hospital.ipd-collection`** (`from`, `to`): one row per user, with:
  * advances, final bill payments, dues collected and advances paid back, each by cash, card and wallet;
  * what to hand over.

  PDF (landscape) and Excel.

## Not ported here

* **Grace hours, manual cabin days, bed rent packages, cabin discounts and extra cabins** (`CabinChargeRules`,
  `ManualCabinDays`, `BedRentPackages`, `CabinDiscounts`, EC rows).
* **Package admissions** (`AdmittedPackages`, `ConsultancyPackages`).
* **Per-line discounts and service charge on services.** The discount is on the bill.
* **Medicine, investigations, OT and room-service food on the bill.** These come with the pharmacy's indoor patients
  (8i), diagnostics, OT and the canteen.
* **Nurse station and pharmacy clearance flags.**
* **Paying doctors their shares, corporate collections and the credit limit across OPD and indoor bills, ledgers,
  statements and the UHID merge.** All of these are step 9g. The old system had no UHID merge at all.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0040_hospital_ipd_billing`: 5 tables and the doctor ledger's indoor bill
* `npm test`: 331 passed. The new `test/unit/hospital/ipd-bill.spec.ts` covers:
  * **Bed nights:**
    * one bed;
    * a same-day stay;
    * the dearest bed of a day, up or down;
    * a day out of ICU charged at the bed moved to, and a day into ICU at the dearest.
  * **Lines:** the service charge on the admission, bed and round lines only; a doctor's share; no round fee without
    a night.
  * **The bill:**
    * the advance taken and the due;
    * more advance than the bill, overpayment and a cash client's part payment all refused;
    * the counter's limit and the reason;
    * collections, then cancellation (later only by a manager) with the money held again.
* `npm run test:int`: 16 passed (migration count 41, new tables)
* `npm run test:e2e`: 128 passed. The new `test/e2e/hospital-ipd-billing.e2e-spec.ts` covers:
  * **First scenario** (a 3-night stay, backdated):
    * an admission with an advance;
    * visits with a share; a service without its doctor, an outdoor-only service and a day before admission all
      refused; a dressing cancelled;
    * the account: 3 nights, round fee and service charge;
    * cancelling refused with charges; a refund;
    * no discharge without the bill; the counter's discount limit;
    * the bill with a payment; no charge after it;
    * the discharge with a due needing a manager; collections; no cancel after discharge; a stale version refused;
    * every GL closing;
    * the bill, receipt and collection prints, and the collection sheet.
  * **Second scenario:**
    * a company patient billed with its discount;
    * the bill cancelled and made again with a forgotten visit;
    * discharged owing without a manager;
    * a mistaken admission with an advance: refunded, then cancelled.

  `test/e2e/hospital-ipd.e2e-spec.ts` now makes the final bill before the LAMA discharge.
* Indoor bill, receipt and collection sheet checked visually (Bangla names)
* Dev server restarted; readiness 200
