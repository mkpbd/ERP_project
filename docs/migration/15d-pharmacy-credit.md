# Step 15d — Pharmacy credit to corporate clients and staff

Status: **done** (2026-10-31). Previous: [step 15c](15c-inpatient-care.md) · Screens before it:
[step 16d](16d-nursing-screens.md) · Next: [step 15e](15e-dashboards.md) (dashboards).

The fourth gap of the page-by-page check: the old counter sold medicine on credit to a company or a staff member, and
the new pharmacy left a due only for a loyal member.

## Where the old logic lives

CoxBazar:

| Old page | Tables | What it did |
|---|---|---|
| `/pharmacy/sale` (`AddEditPharmacySalePage`) | `Pharmacy.Invoices.CorporateClientId`, `.StaffRecordId`, `.DueAmount` | A due allowed only with a staff member, a loyal member or a company chosen; the due written to that one's ledger |
| (same page) | `CorporateClientLedgers` | "Pharmacy OPD Sale Due with Corporate Client", debit the due |
| (same page) | `Payroll.StaffGlobalLedgers` | "Pharmacy OPD Sale Due with Employee", debit the due |
| `/pharmacy/corporate-client-due-collection` (+ dashboard) | `CorporateClientLedgers` | A company's payment against its pharmacy dues |
| `/pharmacy/employee-due-dashboard` | `Payroll.StaffGlobalLedgers` | What each staff member owes |
| canteen due collection (staff) | `Payroll.StaffGlobalLedgers` | A staff member's payment, credit on the ledger |

**Faults of the old pages:**

* **No credit limit at the pharmacy.** A company's dues grew with no check.
* **Ledger and books apart.** The ledgers were written by the page after the invoice. A failure in between left
  an invoice with no ledger entry.
* **Cancelling or returning left the ledger alone.** The staff ledger still showed a due for medicine that came
  back.
* **No recovery from salary.** Payroll read the staff ledger and recovered dues by hand.

## What it is here

### Selling on credit (`pharmacy:sell`)

`POST /pharmacy/sales` takes `corporateClientId` or `staffId` beside `loyalMemberId`.

* **One debtor.**
  * A sale names at most one of the three (`one_debtor`).
  * A sale with a due must name one (`due_needs_debtor`, was `due_needs_member`).
  * A sale paid in full may still name a company or a staff member, for the record.
* **A company:**
  * must exist and be active (`inactive_client`);
  * takes a due only on credit (`cash_client`);
  * takes it only within its limit (`credit_limit`). The limit counts what the company owes in all: its unpaid
    OPD, indoor and diagnostic bills and its pharmacy credit sales.
  * The company is locked while the limit is checked, so two counters cannot both fill it.
* **A staff member:**
  * must be active to buy on credit (`inactive_staff`);
  * their due goes onto their staff ledger (payroll's `staff_dues`, the old `StaffGlobalLedgers`) as a debit,
    "Medicine sale SI-…".
* **The voucher.** The due is booked to its debtor's receivable:

  | Debtor | GL role |
  |---|---|
  | loyal member | `pharmacy_receivable` |
  | company | `corporate_receivable` (the hospital's) |
  | staff | `staff_receivable` (the hospital's) |

  A company owes one receivable whichever desk sold to it.
* **Cancelling and returns** credit the same receivable. For a staff sale they also credit the staff ledger:
  * the whole due when cancelled;
  * the due taken down by a return.

  A return's refund goes to the ledger, not back in cash.
* **Lists and receipts.**
  * Sales are listed by `corporateClientId` or `staffId`.
  * A sale shows the company's or the staff member's name.
  * The sale receipt prints "On credit to …" or "Staff: …".

### The hospital's limit

The OPD, diagnostic and admission limit checks now count the pharmacy's credit sales too. The pharmacy publishes
what companies owe it (`PharmacyCredit`). The hospital publishes its corporate clients and what each owes in all
(`CorporateAccounts`).

### Collecting at the pharmacy counter (`pharmacy:sell`)

* **A company:** `POST /pharmacy/corporate-clients/:id/collections` (`collectedOn`, `amount`, `method`,
  `reference`).
  * The payment goes to its pharmacy credit sales, oldest first, never above them (`overpayment`).
  * Dr cash (card, wallet) / Cr `corporate_receivable`.
  * Its hospital bills are collected at the hospital's counter, as before.
* **A staff member:** `POST /pharmacy/staff/:id/collections`.
  * The payment goes against their staff ledger: every unit's credit and dues from the old system, never above
    what they owe.
  * Dr cash / Cr `staff_receivable`, and a credit on the ledger, "Paid at the pharmacy DC-…".
  * Someone who has left may still pay.
* **The receipt.** Each payment has a `DC-` receipt number, in the same series as loyal member payments. The
  `pharmacy.due-receipt` print (80 mm) shows:
  * the payer;
  * the sales it settled, or "Against the staff ledger";
  * the amount and the way paid;
  * the voucher.
* **The views:**
  * `GET /pharmacy/corporate-clients/:id/dues`: the limit, what the company owes in all, its pharmacy due, and the
    sales still owing, oldest first.
  * `GET /pharmacy/staff/:id/dues`: the staff ledger's balance and the latest 50 pharmacy credit sales.

### Recovering from salary (`payroll:manage`)

`POST /payroll/staff-dues/recover` with `{ year, month }`.

* **What is taken.** For each person who owes on the staff ledger:
  * at most the net pay the month's sheet gives them now;
  * added to their other deduction for the month ("Staff dues recovered");
  * credited on the ledger, "Recovered from the salary of 2026-04", dated the month's last day.
* **When.** Before the sheet is committed (`salary_sheet_committed`). Approve the sheet again afterwards.
* **Leftovers.** Someone with no pay that month keeps their due for the next month. Running it again takes only
  what fell due since.
* **The result.** It lists everyone who owed, with what was recovered (0 for those not paid), and the total.

## Decisions ("next" without answers: the recommendations)

1. **Corporate credit respects the client's credit limit**, one limit across the hospital and the pharmacy. A cash
   client takes no credit.
2. **Staff credit becomes a staff due** on payroll's staff ledger, the same ledger the old dues came over to in
   13e. It is recovered from salary, or paid at the counter.
3. **Dues are collected at the pharmacy counter with a receipt.**
   * A company pays against its pharmacy sales there.
   * A staff member pays against their whole ledger.
4. **The books.**
   * The pharmacy uses the hospital's `corporate_receivable` and `staff_receivable` roles, so each company or
     staff member owes in one place.
   * Payroll posts no vouchers, so the recovery from salary does not post either. The month's salary journal
     credits `staff_receivable` with the recovery total, which the endpoint returns.
5. **Recovery is capped at the net pay.** The old sheet floored net pay at 0, so a larger deduction would have been
   lost.
6. **The company's discount is not applied at the pharmacy.** The products' own discount rules apply as for anyone.
   The old pharmacy did not give the corporate discount either.

## Not done here

* **The pharmacy screens.** The counter, the dues and collections.
* **Dues lists across companies or staff**, and their prints. The old dashboards are covered by the views above,
  one company or person at a time.
* **Undoing a salary recovery.** Payroll edits the month's deduction and the staff ledger by hand.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
* Migration `0062_pharmacy_credit`:
  * a sale's company and staff member, with one debtor at most, and one when there is a due;
  * a payment by a member, a company or a staff member (exactly one).
* The due receipt (a company's and a staff member's) was checked in screenshots.
* `npm test`: 454 tests passed. `sale.spec.ts` covers one debtor, the due needing one, and the receivable by
  debtor.
* `npm run test:int`: 16 tests passed (migration count 63).
* `npm run test:e2e`: 176 tests passed. `pharmacy-sale` now expects `due_needs_debtor`. New `pharmacy-credit`:
  * **A company:**
    * sold to on credit up to its limit; refused over it;
    * part paid exactly to the limit;
    * a cash client refused a due; two debtors refused; a due with none refused;
    * the hospital refusing an OPD bill to the same company while the pharmacy fills its limit;
    * 600 collected oldest first, too much refused, the books;
    * the receipts printed;
    * the hospital billing again once there is room.
  * **A staff member:**
    * dues on the ledger;
    * a return and a cancellation taken off;
    * the view; too much refused; 100 paid; the receipt.
  * **Recovery:**
    * refused to the counter;
    * up to the net pay, none for someone not paid;
    * the sheet's net pay 0;
    * a second run takes nothing;
    * refused once the sheet is committed.
* Dev server restarted; readiness 200.
