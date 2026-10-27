# Step 8i — Pharmacy: ward medicine for admitted patients

Status: **done** (2026-10-27). Previous: [step 9g](09g-hospital-statements.md) · Next: step 10 (diagnostics).

What this step adds:

* A ward asks an outlet for medicine for an admitted patient.
* The pharmacy sends the medicine, charged to the admission instead of paid at the counter.
* Unused medicine comes back before the final bill.
* The indoor bill of step 9f gains a **Medicine** head.

## Where the old logic lives

CoxBazar:

* **Indents.** `Pharmacy.IPDMedicineIndents` / `IPDMedicineIndentDetails` (ServeType 1 Pending, 2 Partial, 3 Served,
  4 Cancelled, 5 OnHold), raised on `/pharmacy/medicine-indent` and cancelled from the indent dashboard.
* **Sending.** `CreateIPDPharmacySaleTxnCommand` writes the same `Pharmacy.Invoices` as a counter sale, with
  ServeTypeId 7 and the patient's IPD record. Details:
  * The lot's sale rate, less the product's indoor discount (`ProductDiscountSetting.IpdDiscountPercent`; a flat 5 %
    before 19 Oct 2026).
  * Nothing paid at the counter.
  * Stock taken first expiring first.
* **Returns.** `Hospital.MedicineReturnIndents` are raised by the nurse and refused once the pharmacy has cleared the
  patient. The pharmacy receives them through `ProcessIpdMedicineReturnCommand`, which writes a negative invoice
  (ServeTypeId 14) and a stock receive against a pseudo-supplier.
* **On the final bill.** `HospitalBillingGridBuilder` adds the head "Medicine" (`spGetIPDInvoiceDetailListByPatientId`,
  net of returns), less "Medicine(Paid)" (`PIPDDueCollections`).
* **Pharmacy clearance.** "IPD Patients Bill" blocks while indents are Pending or OnHold.
* **At discharge.** Pending indents are deleted.
* **Books.** Nothing was posted for indoor medicine, only sub-ledger rows.

What changes:

* **Ward medicine has its own documents.** Indent, issue and return each have their own numbers (`WN-`, `WI-`, `WR-`).
  They are no longer counter invoices with a flag and negative invoices.
* **The pharmacy books the sale when it sends the medicine.** Dr medicine charged to stays (`ipd_medicine_unbilled`)
  and the sales discount / Cr pharmacy sales; Dr cost of medicines sold / Cr inventory.
* **The final bill clears that account** instead of taking the medicine as hospital income.
* **Returns go back to the lot they came from at its cost.** There is no pseudo-supplier.

## Decisions (step 9g's open questions; "next" without answers, so the recommendations)

1. **Ward indent, then issue, then a Medicine line on the indoor bill.** One issue answers an indent. It may send
   different quantities or other products; the old system served partly, line by line.
2. **Returns are taken only before the final bill.** After it, the bill must be cancelled first (409 `bill_made`).
3. **Price: the lot's sale rate less the product's indoor discount** (the pharmacy discount policy's `ipdPercent`, or
   the product's own rule). This is not the counter discount. It is as the old system did since 19 Oct 2026.
4. **Discharge is not blocked by an unanswered indent.** The admission's account and the indoor bill show how many are
   still open.

Other decisions:

* **Nothing more is sent or indented once the final bill is made.** Cancelling the bill opens the stay again.
* **The pharmacy and the bill never cross.** Every ward document takes the admission's lock, the same one the final
  bill takes.
* **A document is not dated before the admission.**
* **No separate payment to the pharmacy during the stay.** The old "Medicine(Paid)" is not ported; the patient pays
  advances on the admission.

## How the modules meet

The pharmacy and the hospital never read each other's tables. Two contracts in `src/shared/application/contracts`
connect them:

* **`InpatientRegister`** (published by the hospital): an admission as the pharmacy charges to it. It gives the number,
  patient, UHID, admission day, status and whether a final bill is in force. `lockForCharge` locks the admission
  row.
* **`InpatientMedicine`** (published by the pharmacy): the admission's ward issues still charged (issued less
  returned) and the count of open indents.

Both modules are now global so that they can publish these contracts.

## Pharmacy (`/api/v1/pharmacy`)

| Endpoint | Who | What |
|---|---|---|
| `POST ward-indents` | `pharmacy:ward` | outlet, admission, day, note, lines (one per product); not before admission, not once billed |
| `POST ward-indents/:id/cancel` | `pharmacy:ward`, or `pharmacy:sell` at the outlet | an open indent, with a reason |
| `GET ward-indents`, `GET ward-indents/:id` | `pharmacy:ward` or `pharmacy:read` | by outlet, admission, status; with the patient's name and admission number |
| `POST ward-issues` | `pharmacy:sell` + works at the outlet | the indent it answers (optional), day, lines (a lot may be named); first expiring first, never an expired lot |
| `POST ward-issues/:id/returns` | `pharmacy:sell` + works at the outlet | the issue's `version`, day, reason, lines (issue line and units); never more than sent less returned |
| `GET ward-issues`, `GET ward-issues/:id` | `pharmacy:ward` or `pharmacy:read` | by outlet, admission and period; lines with lots, and the returns |

* **Stock:** an issue moves stock out as `ward_issue`, and a return moves it back in as `ward_return`.
* **Stock reports:** the product ledger shows these as "Sent to a ward" and "Returned from a ward". The stock movement
  report counts them with sales and customer returns.
* **Counter reports:** the sales summary and the cash counter keep to counter sales.

## Hospital

* **The indoor bill** has a **Medicine** head: one line per ward issue still charged, with no service charge or doctor's
  share. The final bill posts it against `ipd_medicine_unbilled`, so the account is cleared.
* **`GET admissions/:id/account`** returns `openIndents`.
* **The indoor bill print** shows a Medicine group and a warning when indents are still open.

## Reports

* **`pharmacy.ward-medicine`** (`admissionId`):
  * every unit sent to the wards and sent back, line by line (day, document, outlet, medicine, units, rate, charged);
  * the totals and what stays charged to the stay.

  PDF and Excel.

## Not ported here

* **Indent priority, serving an indent partly line by line, and OT room indents.**
* **Nurse-raised return slips.** The pharmacy records the return directly.
* **Paying the pharmacy separately during the stay** ("Medicine(Paid)", `PIPDDueCollections`).
* **Pharmacy and nurse-station clearance flags.** The open-indent count and the final bill replace them.
* **Medicine packages.**

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0042_pharmacy_ward_medicine`: 6 tables and the two new movement kinds
* `npm test`: 336 passed. The new `test/unit/pharmacy/ward.spec.ts` covers:
  * an indent raised once per product, answered or cancelled with a reason, and stale versions;
  * an issue at the sale rate less the indoor discount;
  * returns taken off at what they were charged, never more than sent;
  * the medicine line on the indoor bill without a service charge.
* `npm run test:int`: 16 passed (migration count 43, new tables)
* `npm run test:e2e`: 132 passed. The new `test/e2e/pharmacy-ward.e2e-spec.ts` follows one admission:
  * **Indents:**
    * the nurse's indent, refused to the pharmacist and before the admission;
    * the open count on the hospital account.
  * **Sending and returns:**
    * the issue answering the indent at 10 % off indoors, with the stock down;
    * an indent the pharmacy cannot answer: short stock, then cancelled by the outlet;
    * a vial returned, restocked and taken off; an over-return refused.
  * **The bill and after:**
    * the hospital account with the Medicine line;
    * the final bill paid, after which issues, returns and indents are refused;
    * the discharge.
  * **Books and prints:**
    * GL closings: the stay's medicine cleared; sales, discount and cost net of the return;
    * the ward medicine sheet, and the ward medicine and indoor bill prints.
* Ward medicine statement checked visually (Bangla names)
* Dev server restarted; readiness 200
