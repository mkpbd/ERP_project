# Step 13e — Data migration: admitted patients and dues

Status: **done** (2026-10-30). Previous: [step 13d](13d-catalogues-stock.md) · Next: [step 13f](13f-clinical-history.md).

```
ETL_SOURCE_URL=… npm run etl -- --cut-over=2027-01-01 [--dry-run] [--only=open-admissions,doctor-payables]
```

**What carries over.** What was still open in the old system when it stopped:

* patients in their beds;
* what doctors were owed;
* what staff and canteen members owed.

Everything carries on here as if it had been entered here. Without `--cut-over`, only the masters come over (noted).

## What comes over

**Masters an admission needs**

| Old | New | How |
|---|---|---|
| `Marketing.CorporateClients` | corporate clients | By name; credit clients (`IsCredit`) are billed to the company. The old discount groups are not brought: set each client's discount here |
| `Hospital.CabinTypes` | bed categories | By name, with the admission fee; ICU, HDU, CCU, NICU… are intensive |
| `Hospital.Cabins` (+ `Floors`, `HDepartments`) | beds, in wards | See the beds rules below |

**Beds:**

* The old system had no ward. Each floor and department the cabins were on becomes one, e.g. "Medicine (3rd floor)".
* Bed codes are the cabin numbers (upper-cased), and each bed keeps its own daily rate.

### Admitted patients (`open-admissions`)

Old `Hospital.IPDPatientRecords` still `Admitted`, admitted before the cut-over, become **open admissions**.

**The admission:**

* The patient is found by UHID (13a).
* A new number, `IP-<year>-…`. The old admission number and remarks go in the reason.
* The admission time, the consultant, the referring doctor and the corporate client.
* The admission fee, kept for the bill.

**The bed history.** The old `IPDCabinAllocationRecords` become the stay's beds, end to end, at each bed's rate:

* each stay ends when the next begins (old release times were often missing or overlapped);
* a bed given back the moment it was taken is dropped;
* the last bed is the one the patient is in, marked occupied.

**Times.** The old system kept wall-clock times without a zone. They are read in the organisation's time zone
(`REPORT_TIME_ZONE`): 10:00 in the old system is 10:00 in Dhaka.

**Advances and refunds** (old `AdvancePayments`):

* Payments and refunds come with receipt numbers (`AR-`/`AF-`).
* They have no voucher: the money is already in the advance account of the opening balances (13b).

**Services given before the cut-over** (old `IPDServiceRecords`, amount and service charge):

* They come as **one charge**, under a service of their own: "Charges in the old system", in the group "Brought over",
  inactive so it is not picked by hand.
* The old system never posted these to its books (`IsPostedToAccount` was never set), so they are income when the
  final bill here is made, like any charge.

**Billed here at discharge.** The final bill charges the admission fee, every bed night of the stay (old ones too),
the round fee, the service charge and the brought-over charge, less the advance held. This is the bill the old system
would have made at discharge; it never posted it either.

**Rejected:**

* the patient was not brought over;
* already admitted here;
* a bed of the stay was not brought over;
* no bed;
* the bed is taken by another stay brought over.

### Doctors' payables (`doctor-payables`)

* Each doctor's balance in the old consultant ledger (`Account.ConsultantGlobalLedgers`): earned less paid.
* It becomes one opening entry in their ledger here, dated the day before the cut-over, document `OPENING-<cut-over>`.
* Doctors are then paid from it as from any share.

### Staff dues (`staff-dues`)

* What each person owed in the old staff ledger (`Payroll.StaffGlobalLedgers`).
* It becomes one opening due (or credit) here.
* The old service units are not kept on it.

### Canteen members and their dues (`canteen-members`, `canteen-dues`)

**Members** (old `Account.LoyalMembers`):

* matched by mobile number;
* a member without a mobile is rejected.

**Dues** (old `Account.LoyalMemberLedgers`):

* **What the opening due is.** Each member's due becomes an opening **sale of no items, owed in full**, at the first
  canteen outlet (`CS-…`, "Due in the old system").
* **Collecting it.** Their dues and collections carry on as for any sale.
* **Before the run.** A canteen outlet must exist; otherwise the dues are rejected with a note to set one up.
* **Members who had paid ahead** are noted and left out.

## Decisions (step 13d's open questions; "next" without answers, so the recommendations)

1. **Admitted patients come over as open admissions** with their bed history, advances, and the services so far as
   one charge. They are billed and discharged here.
2. **Unpaid bills (OPD, diagnostic, pharmacy and canteen credit to the stay, discharged patients' dues) and corporate
   dues are the party balances of 13b.**
   * Each patient's and company's sub-ledger balance came over in the opening voucher.
   * They are collected here with a receipt voucher against the sub-ledger.
   * Old bills themselves are not recreated: they stay in the old database.
3. **Canteen member and staff dues come over as opening entries** (above). Corporate dues are the 13b sub-ledgers,
   as in 2.
4. **Laboratory tests ordered but not reported are finished in the old system before the cut-over** (a freeze step in
   13g); none are brought.
5. **What is owed to doctors comes over as one opening entry each.**

Other decisions:

* **Consultant visits before the cut-over carry no doctor share here.**
  * The old system credited doctors when it made the final bill, so a stay still open had not paid their share.
  * The old IPD services did not record the doctor.
  * Add those shares by hand from the old records when the patient is billed. The report says so.
* **Medicine and canteen sales to a stay before the cut-over are not on the bill here.** The old system posted them to
  the patient's receivable as it went, so they came over in the patient's 13b sub-ledger and are collected with it.

## Not done here

* **Patients' and companies' bills as documents.** Covered by their 13b balances, see decision 2.
* **The old discount groups of corporate clients; pharmacy outlets' credit customers.**
* **Earlier admissions, OPD and diagnostic bills, payments.** They stay in the old database.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. No new migration.
* The ETL context now carries the organisation's time zone (`REPORT_TIME_ZONE`).
* `npm test`: 429 passed. New: `test/unit/data-migration/open-records.spec.ts` covers:
  * old wall-clock times read in Dhaka time;
  * bed rows laid end to end (overlaps, early allocation, a bed given back at once dropped);
  * advance kinds;
  * balances in paisa;
  * intensive care categories.
* `npm run test:int`: 16 passed.
* `npm run test:e2e`: 161 passed. `test/e2e/data-migration.e2e-spec.ts` adds open documents. A dry run and a real
  run with the same counts; a re-run writes nothing. It covers:
  * **Rejections:** an admission whose bed did not come over, one whose patient did not.
  * **The ward:** "Medicine (3rd floor)".
  * **The admission:**
    * `IP-2026-00001` at 10:00 Dhaka time;
    * an ICU night then the cabin, which is occupied;
    * the advance and the refund (`AR-`/`AF-`) without vouchers.
  * **Its account here:** 8,000 held; the admission fee, both beds at their rates and the 5,000 brought-over charge.
  * **Doctor:** owed 5,000.
  * **Staff:** a 500 due.
  * **Canteen:** a member's 1,000 due as `CS-2026-00001`; a member without a mobile rejected.
* Fixed on the way: `test/e2e/clinical-emr.e2e-spec.ts` failed in the first hour after midnight in Dhaka.
  * **Cause.** Its "minutes ago" times fell on the day before the admission's, which the EMR rightly refuses.
  * **Fix.** The helper now shortens them after midnight, keeping their order.
* Dev server restarted; readiness 200.
