# Step 16c — Inpatient front desk screens (Angular)

Status: **done** (2026-10-31). Previous: [step 16b](16b-lab-screens.md) · API: steps 9e–9f (admissions, the stay's
account) and [15c](15c-inpatient-care.md) (corrections, reopening, visitor passes).

The inpatient front desk's screens in the Angular frontend (`D:\Pratices\ERP_Frontend`, `mkpbd/ERP_frontend`, commit
`aaa244b`). The nursing records of 15c (observation board and sheet, care and medicine charts) are the next UI
step.

## Old → new

| Old page (CoxBazar, Blazor) | New screen | Route |
|---|---|---|
| IPD patient list | **Admissions**: in, discharged or all; search by name, UHID or admission number | `/ipd` |
| Patient admission | **Admit a patient** dialog | on `/ipd` |
| Cabin status, house-keeping dashboard | **Bed board**: every bed by ward, who is in it, beds to make ready or out of order | `/ipd/beds` |
| Cabin transfer, assigned doctor transfer, admission edit, discharge, bring discharged patient to live, admission cancel | **A stay**: the actions on the stay | `/ipd/admissions/:id` |
| Service charges, advance payment and return, final billing, due collection | **Its account** tab | same |
| Visiting card | **Visitor passes** tab | same |

## The screens

**Admissions** (`ipd:read`):

* The list is searched by name, UHID or admission number (`q`, step 16a).
* **Admit patient** needs `ipd:admit`, plus `patient:read` and `opd:read` to choose the patient and the doctors.
* The admit dialog takes:
  * the patient, found on the server;
  * a free bed from the board;
  * the kind, the consultant and the referring doctor;
  * who pays: the patient's own client, the patient, or a corporate client;
  * the reason;
  * an advance.

**Bed board:**

* The counts of free, occupied, housekeeping and out-of-order beds.
* Each ward's beds, with the patient in each.
* `ipd:manage` makes a bed ready, or takes it out of order.

**A stay:**

* **Stay tab:**
  * the admission (kind, reason, referrer, who pays, discharge or cancellation);
  * its doctors over time;
  * its beds with rates and why each was taken.
* **Actions** (`ipd:admit`): move bed, discharge (type and note), correct the admission, change the consultant,
  other doctors (up to 10), print the admission form.
* **Actions** (`ipd:manage`): cancel the admission (a mistake), reopen a discharge.
* **Who pays** is locked in the correction while a final bill is in force. Reopening explains that a paid bill
  stands.
* **Account tab** (`ipd:bill` to change):
  * the totals, nights, advance held, and the balance or the bill's due;
  * the bill's lines;
  * **charges**, each with the doctor when the service carries a share; cancelled with a reason;
  * **money** in and out: advances, refunds of advance held;
  * **the final bill**, with a discount (empty: the client's own) and what is paid now;
  * dues collected; the bill cancelled with a reason; the bill printed.
* **Visitor passes tab:**
  * issued (`ipd:admit`), and printed at once;
  * reprinted, or handed back;
  * the limit's refusal is shown in the dialog.

Every change to the stay sends the version read; a conflict reloads the page.

## Decisions

1. **The account and the passes are tabs of the stay**, not pages of their own: the counter works one stay at a
   time.
2. **Dialogs share one submit helper**: the dialog cannot be closed while saving, and the backend's message is shown
   in it.
3. **A new pass prints at once**, as the old card was handed over when sold.

## Not done here

* **Nursing:**
  * the observation board and sheet;
  * the medicine and care orders with their charts;
  * the EMR notes and the discharge summary.
* **The IPD setup:**
  * wards, bed categories, beds;
  * the IPD policy, including the visitor pass limit.
* **Lists and reports:**
  * the IPD bills list across patients;
  * the census and register reports.

## Verification

* Frontend `npm run check` (typecheck, lint, architecture, format, unit tests, build): clean. 68 unit tests. New:
  `admission.store.spec.ts` covers:
  * the permissions offered;
  * the version sent with a change;
  * a reload after it and after a conflict.
* Frontend e2e (Playwright, mocked API): 31 passed (the live-backend test skipped). New: `e2e/ipd.spec.ts` covers:
  * **Admitting:** refused without patient, bed and consultant, then admitted with an advance.
  * **Correcting:** emergency, and the company pays.
  * **The account:** a service charged; the final bill made.
  * **Discharge and reopening:** discharged, then reopened.
  * **Passes:** two passes printed, the third refused, one handed back.
  * **The bed board:** a bed taken out of order.
  * **The list:** the admissions list.
  * **Accessibility:** no axe violations.
* The admit dialog, the account tab, the passes and the bed board were looked at in screenshots.
