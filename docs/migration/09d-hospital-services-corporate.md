# Step 9d — Hospital: OPD and emergency services, corporate clients, staff billing

Status: **done** (2026-10-27). Previous: [step 9c](09c-hospital-opd-billing.md) · Next: [step 9e](09e-hospital-admissions.md)
(admissions, beds and discharge).

## Where the old logic lives

CoxBazar:

* **Service master:** `Hospital.ServiceExecutingHeads` with one `ServiceExecutingHeadRates` row each, and the
  `ServiceGroups` / `SubGroups` / `SubSubGroups` tree (`/hospital/service-executing`).
* **Emergency billing:** the OPD Emergency page (`/opd/Emergency`, `OPDEmergencyService.razor.cs`), with
  `OPD.PatientRecordOPDServices`, `ServiceDetails`, `OPDServiceLedger` and the 40 % `ConsultantGlobalLedgers` rows.
* **Corporate clients:** `Marketing.CorporateClients` (`/marketing/corporate-client`).
* **Staff:** staff were billed by Employee No (`EmployeeId` with UHID 0).

What this step fixes or replaces:

* **Saving.** The emergency page saved its parts one by one, and the lines and ledgers never got a tenant.
* **Doctor's share.** It was 40 % in the code and never taken back on a cancellation.
* **Rate.** The rate could be raised above the master rate.
* **Corporate clients:**
  * a corporate patient's company was kept only as text in a ledger description, with no client on the bill;
  * there was no OPD collection screen for companies;
  * clients had no credit limit.
* **Staff.** Staff got a UHID that was thrown away.

## Masters (record endpoints, `opd:read` to see, `opd:manage` to change)

| Path | What |
|---|---|
| `/hospital/service-groups` | The service group tree (a group may have a parent) |
| `/hospital/services` | Code (unique, any case), name (unique in its group), group, **rate**, **`sharePercent`** (the share of the doctor who gives it; empty = none), billed at the OPD and/or on the ward, active |
| `/hospital/corporate-clients` | Name, contact, address, **cash or credit**, an optional **credit limit**, a **discount %** for their people, active |

## Bills (the 9c bill, extended)

**Lines.** A line is now a **consultation** (doctor, visit type) or a **service**:

* The service must be active and billed at the OPD (422 `not_billable`).
* Give the quantity (1–1000).
* The rate is the service's and cannot be changed; a discount lowers the bill instead.
* A service with a share needs the doctor who gave it (422 `doctor_needed`). The share goes to that doctor's ledger.
* A bill with a service is numbered **`OS-`**; consultations only stay **`OC-`**.

**Income.** Consultations go to `opd_consultation_income` and services to **`opd_service_income`**, on billing and on
cancellation.

**Who owes the due** (`corporateClientId` or `staffId`, not both — 422 `invalid_payer`):

* **The patient:** `opd_receivable`.
* **A credit client** (active):
  * The bill's due goes to **`corporate_receivable`**.
  * The client's **discount %** is given unless another discount is asked for, with the reason "Corporate: name".
  * It is not held to the counter's limit.
  * A bill that would take what the client owes **over its credit limit** is refused (422 `credit_limit`).
* **A cash client:** the bill is paid in full at the counter (422 `payment_needed`).
* **A staff member:** looked up through HR's `StaffDirectory`; active staff only (422 `inactive_staff`). The due goes
  to **`staff_receivable`**, to be deducted from salary in a later step.

**Collections and cancellation** credit or reverse the receivable of whoever owes the bill.

**Corporate collection** (`POST /hospital/corporate-clients/:id/collections`, `opd:bill`):

* What the company pays settles its bills **oldest first**.
* One `OR-` receipt and one voucher (Dr the receipt account / Cr `corporate_receivable`).
* More than it owes is refused.
* The answer lists each bill settled and how much.

**Filters.** `GET /hospital/opd-bills` gains `corporateClientId` and `staffId`. Bill views show the client.

**Visit suggestion.** The follow-up suggestion counts consultations only: a service the doctor gave is not a visit to
them.

## Reports

* `hospital.opd-receipt` now lists services (quantity × rate, given by) and who the bill is to (the client, or the
  staff member with employee number).
* `hospital.corporate-statement` covers a client over a period:
  * what it owed before and after;
  * each bill with what was paid at the counter and what was charged to the client;
  * each payment with its receipt and bill.

  PDF and Excel.
* `hospital.service-income` (old ServiceHeadWiseIncomeReport / EmergencyReportServiceWise) shows, per service and
  group, the units and fees billed, those cancelled on their cancel date, and the net. PDF and Excel.
* `hospital.doctor-consultations` counts consultations only. Doctors' shares of services are in its share columns.

## Not ported here

These are left out:

* **Second share model.** The emergency procedure-weight split (`EmergencyDepartmentProcedureCharge`, hospital /
  emergency / doctor / nurse) and `ServiceIncomeShares` both feed reports only. The doctor's share is per service
  here.
* **VAT, service charge and poor fund.** These master flags were never applied in the old system.
* **Rx procedure indents.** Pre-filling a bill from the Rx module's suggestions comes with the Rx step.
* **"Edit service by".** Correcting the doctor on a billed line means cancelling and billing again.

## Decisions taken (after the first version of this step)

* No second share model: the per-service doctor's share is enough; the old procedure-weight split is not ported.
* A wrong doctor on a billed line is corrected by cancelling and billing again; there is no "edit service by".
* A patient may carry a default corporate client, put on their bills (added with step 9e).
* The staff receivable is recovered by a monthly payroll deduction, in a payroll step after 9f.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0038_hospital_services_corporate`:
  * 3 tables;
  * the bill's client and staff member;
  * service lines with quantity and rate (existing lines get the rate of their fee).
* `npm test`: 318 passed. `test/unit/hospital/opd-bill.spec.ts` covers:
  * services by quantity, with a share only where the service carries one;
  * gross by kind;
  * a share without the doctor refused;
  * quantity limits;
  * a consultation without its visit type refused;
  * who owes the due;
  * a cash client paying in full.
* `npm run test:int`: 16 passed (migration count 39, new tables)
* `npm run test:e2e`: 125 passed. The new `test/e2e/hospital-services.e2e-spec.ts` covers:
  * **Refusals:** a ward-only and an inactive service refused; a shared service without its doctor refused.
  * **A service bill:**
    * `OS-` numbered, 3 dressings and 2 nebulisations;
    * Kamal's 100 share;
    * service income, doctor fee, payable and cash.
  * **A mixed bill:** each part to its own income.
  * **Cancellation** takes the service income and the share back.
  * **The service income sheet** shows units and fees billed, cancelled and net.
  * **Corporate:**
    * Acme's 10 % given with its reason, 675.45 owed by Acme;
    * a second bill refused over Acme's 1,000 limit;
    * a cash client refused unless paid in full;
    * Acme pays 500, then 581.80 settling both bills oldest first on one receipt;
    * the corporate receivable back to 0;
    * the statement.
  * **Staff:**
    * a bill to a client and a staff member at once refused;
    * a nurse's bill owed by her (staff receivable 150.50);
    * the receipt.
* Receipt, corporate statement and service income checked visually (Bangla names)
* Dev server restarted; readiness 200
