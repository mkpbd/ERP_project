# Step 10f — Blood bank: donors, donations, units, cross-match and issue

Status: **done** (2026-10-30). Previous: [step 10e](10e-lab-reagents.md) · Next: step 11 (EMR, Rx, nutrition,
patient portal sign-in).

What this step adds, in a new `blood-bank` module:

* **Component types**: packed cells, plasma, platelets and so on. Each has a code, shelf life, compatibility rule
  and rate.
* **Donors and donations.**
  * Donors are registered with their blood group.
  * A donation is a bag (`BB-` number). It is screened for HIV, HBsAg, HCV, syphilis and malaria.
  * The bag is split into **units** (`<bag>/<code>`). Units stay in quarantine until the bag is screened clear.
* **Requests for a patient.** A request is either for an admitted stay or on a diagnostic bill of the patient.
  * Units are cross-matched; a compatible unit is kept for the request.
  * A kept unit is then issued (`BI-` number).
* **The indoor bill gets a Blood head.** Blood issued to a stay is charged at the component's rate and appears on
  the hospital's final bill.

## Where the old logic lives

CoxBazar, `TransfusionMedicine`:

* **Entities** (`src/Core/Domain/Entities/TransfusionMedicine/`):
  * `BloodComponent`: name and rate.
  * `BCParameter`: parameters per component.
  * `BloodDonor`: tied to an indoor patient record, as a replacement donor.
  * `DonorContributionRecord`: bag, group, Rh and expiry, tied to a cross-matching record.
  * `CrossMatchingRecord` / `Result` / `Value`: the patient's group, specimen, component, doctor and technologist.
  * `SerologyRecord` / `Result`: screening of a specimen of an indoor patient.
* **Pages:**
  * `/bloodbank/blood-component`, `/bloodbank/bc-parameter`;
  * `/transfusionmedicine/blood-donor`;
  * `/transfusionmedicine/cross-mapping-manage`, `cross-matching-dashboard`, `cross-matching-result`;
  * `/transfusionmedicine/serology-record-dashboard`.
* **No stock and no issue.** The old system kept bags against a cross-matching record. It had no units, no stock
  and no issue record. Units, the stock and issues are new here.

## Decisions (step 10e's open questions; "next" without answers, so the recommendations)

1. **Scope.**
   * Donor register.
   * Donations with a bag number, split into components.
   * Screening of each donation.
   * Cross-match, issue to a patient, and expiry.
2. **Billing.**
   * **Admitted patient:** the blood goes on the indoor bill as a **Blood** charge, through a new contract
     (**`InpatientBlood`**), like ward medicine.
   * **Outpatient:** pays on a diagnostic bill. The request names that bill, and the issue charges nothing.

Other decisions:

* **The donor stands alone.** A donor is no longer tied to a patient's stay.
  * Rules: 18 to 65 years old; 50 to 600 ml.
  * After giving, the donor is deferred for 90 days.
  * After a reactive screen, the donor is deferred for good (`9999-12-31`).
* **The donation is screened, not the patient.** The five screens are kept on the donation.
  * Any positive screen discards the donation and all its units.
  * A clear screen releases its units from quarantine.
  * Units prepared after the screening start available.
* **Units.**
  * A unit keeps for the component's shelf days, counted from the day of donation.
  * A unit past that day is never kept for a request or issued.
  * A unit is discarded with a reason (`bb:manage`); an issued unit is never discarded.
* **Compatibility.**
  * **Red cells:** O goes to everyone and AB receives from everyone. Rh-negative patients get only Rh-negative cells.
  * **Plasma:** the other way round; AB plasma goes to everyone.
  * **`any`:** no group check.
* **Requests.**
  * The patient's group must be on their record. A patient record is read through a new hospital contract,
    **`PatientDirectory`**.
  * A request is for a stay (an admission of the same patient, still admitted) or for a diagnostic bill of the
    patient with a test still billed. Never both.
  * A cross-match tries a unit of the requested component and a group the patient may receive.
    * **Compatible:** the unit is kept for the request, up to the number of units asked for.
    * **Incompatible:** the result is only recorded.
* **Issue.**
  * Only a unit kept for the request is issued. The request is fulfilled once every unit is issued.
  * For a stay, the admission is locked. An issue is refused when the patient is out (`admission_state`) or the final
    bill is made (`bill_made`).
  * A stay's unit is charged at the component's rate:
    * the issue posts Dr `ipd_blood_unbilled`, Cr `blood_bank_income`;
    * the final bill credits `ipd_blood_unbilled` under the **Blood** head, with no service charge.
* **Cancelling a request** puts the units kept for it back into the stock.
* **Numbering is yearly:**
  * `DN-` donors;
  * `BB-` bags;
  * `BR-` requests;
  * `BI-` issues.

## API (`/api/v1/blood-bank`)

| Endpoint | Who | What |
|---|---|---|
| `GET` / `POST` / `PATCH` `component-types` | `bb:read` / `bb:manage` | Component types: name, code, shelf days, compatibility, rate |
| `GET donors`, `POST donors` | `bb:read` / `bb:collect` | Donors by group or name; register one |
| `POST donations`, `GET donations/:id` | `bb:collect` / `bb:read` | Take a bag from a donor; the donation with its screens and units |
| `POST donations/:id/screening` | `bb:collect` | The five screen results (with `version`) |
| `POST donations/:id/components` | `bb:collect` | Split into units of the given component types |
| `GET units` | `bb:read` | The stock by state, group, component or donation, soonest out of date first |
| `POST units/:id/discard` | `bb:manage` | Discard with a reason |
| `GET requests`, `GET requests/:id`, `POST requests` | `bb:read` / `bb:request` | Requests: a stay (`admissionId`) or a diagnostic bill (`billNumber`) |
| `POST requests/:id/crossmatch` | `bb:issue` | A unit tried: `compatible` keeps it, `incompatible` is only recorded |
| `POST requests/:id/issue` | `bb:issue` | Issue a unit kept for the request |
| `POST requests/:id/cancel` | `bb:request` | Cancel; kept units go back to the stock |

On the hospital side, the admission account and the final bill show a `blood` head.

## Reports

* **`blood-bank.stock`** (no parameters). For each component and group:
  * units in quarantine, available and reserved;
  * units going out of date within 7 days;
  * units out of date still on the shelf.

  PDF and Excel.
* **`blood-bank.issue-slip`** (`issueId`): sent to the ward with the bag. PDF. It shows:
  * the patient and their group;
  * the unit, bag, component, group and use-before day;
  * the cross-match;
  * the charge;
  * the issuer, with space for the receiver's signature.

## Not ported here

* **Component parameters (`BCParameter`)** and free cross-match values (`CrossMatchingValue`). A cross-match keeps
  only its result and method.
* **Donor questionnaire fields** (father's name, occupation, marital status, cabin).
* **Patient serology on the blood bank's pages.** Patient tests are lab tests (step 10c).
* **Blood returned to the bank after issue,** and transfusion reactions.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
  * The blood bank reads patients, admissions and diagnostic bills only through `PatientDirectory`,
    `InpatientRegister` and `DiagnosticOrders`.
  * The hospital reads blood charges only through `InpatientBlood`.
* Migration `0048_blood_bank`: 8 tables. The indoor bill line's `blood` head needs no change: the head is a text
  column.
* `npm test`: 362 passed.
  * New: `test/unit/blood-bank/blood.spec.ts` covers:
    * compatibility for red cells, plasma and `any`;
    * donor deferral and volume;
    * screening, including a reactive bag discarded;
    * the quarantine → kept → issued unit life, expiry and cancel;
    * a request is for a stay or a bill, and is fulfilled when all units are issued.
  * Also: the indoor bill's Blood line.
* `npm run test:int`: 16 passed (migration count 49, new tables).
* `npm run test:e2e`: 141 passed. New: `test/e2e/blood-bank.e2e-spec.ts` covers:
  * **Donations:**
    * a donor under 18 is refused;
    * the 90-day deferral;
    * the split and its unit numbers;
    * quarantine, then released by a clear screen;
    * a reactive bag discarded and its donor deferred for good.
  * **Request and issue:**
    * a request is for a stay or a bill, not both;
    * the wrong component is refused;
    * a unit is not issued before it is cross-matched;
    * the issue charges 1,500;
    * O plasma is refused to a B patient;
    * a cancel.
  * **Billing:**
    * the admission account shows the blood;
    * the final bill clears `ipd_blood_unbilled`;
    * income is 1,500.
  * **Reports:** the stock sheet, both PDFs and the indoor bill PDF.
  * **Discard:** a discard needs `bb:manage`.
  * **Request checks:** an unknown blood group, and another patient's admission.
* Dev server restarted; readiness 200.
