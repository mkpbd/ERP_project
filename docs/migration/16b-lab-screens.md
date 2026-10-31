# Step 16b — Laboratory screens (Angular)

Status: **done** (2026-10-31). Previous: [step 16a](16a-ot-screens.md) · API:
[step 15b](15b-culture-and-written-reports.md) and [10c](10c-laboratory.md).

The laboratory's screens in the Angular frontend (`D:\Pratices\ERP_Frontend`, `mkpbd/ERP_frontend`, commit
`7d7fe17`). They cover the lab's day: collecting, taking in, entering in each form, verifying, printing and handing
over. The culture and the written report of 15b are in them.

## Old → new

| Old page (CoxBazar, Blazor) | New screen | Route |
|---|---|---|
| Sample collection (invoice search, lab numbers) | **Collect a sample**: the bill by its number, each lab department's tests, collected in one go | dialog on `/lab` and `/lab/samples` |
| Lab acknowledgement | **Sample**: take in, reject with a reason, print the report, hand over | `/lab/samples/:id` |
| Pathology result entry and finalisation lists | **Lab worklist**: to enter, to verify, verified, all; by collection period | `/lab` |
| Pathology result entry, C/S report, descriptive report entry | **Result**: entered in its test's form, then verified or taken back | `/lab/results/:id` |
| C/S masters, pathology templates; which tests get which report | **Lab setup**: report form per test, antibiotics, organisms, growth types, culture messages, report templates | `/lab/setup` |

## The screens

**Lab worklist** (`lab:read`):

* Tests to enter, to verify, verified, or all, with the test, patient, lab number, collection time and status.
* **Collect sample** (`lab:collect`).

**Collecting:**

* The bill is found by its number, in any case.
* Its lab departments are listed, each with its tests; those collected already are marked.
* **Collect** makes one sample with a lab number for the department's waiting tests, then opens it.

**A sample:**

* **Take in** (`lab:result`), and **reject** with a reason: its tests not yet verified are collected again.
* **Print report** once something is verified.
* **Hand over** to whom: the backend holds it while the patient owes.
* Its tests with their status, each opening its result.

**A result**, in its test's form:

* **Values:** the template's parameters with the patient's ranges; flags are shown once saved.
* **Culture:**
  * the microscopy;
  * growth or no growth and its type;
  * up to three organisms (searchable);
  * colony count, incubation, media;
  * the message, picked from the standard ones or written.
* **The antibiogram** has a column per organism:
  * add one antibiotic, or all active ones in their class order;
  * a result is clicked through S, I, R and blank, or typed (S, I, R, Delete);
  * an empty organism slot closes up with its column;
  * untested rows are left out.
* **Written report:**
  * start from a template: its text fills an empty report, or is added at the end;
  * written as plain text, its line breaks kept.
* **Verify** and **take back verification** (`lab:verify`). The backend refuses who entered it (`same_person`).
* Once verified it is shown read only.

**Lab setup** (`lab:read`; `lab:manage` to change):

* **Report forms:** find a lab test, choose values, culture and sensitivity, or written report.
* The masters: antibiotics (with their class), organisms, growth types, culture messages, report templates.

## Shared pieces

* The OT's master table and dialog became `shared/components/master-table.ts` and `master-dialog.ts`, over a shared
  `RecordsApi` for any record endpoint. Each master names its endpoint and its manage permission
  (`shared/models/record-master.ts`). The OT setup and the lab setup both use them.
* The OT's reason dialog became `shared/components/reason-dialog.ts`, with a label: "Reason", or "Collected by" for
  handing over.
* `permissions.ts` gains the `lab:*` keys; the sidebar's Hospital section gains Lab worklist, Lab samples and Lab setup.

## Decisions

1. **One result page for the three forms.** The form comes from the backend (`form` on the result), so the screen
   cannot offer the wrong one.
2. **The antibiogram is a grid of buttons.** S, I and R are typed, not picked from lists: a technologist enters
   dozens a day.
3. **Masters are generic.** A new master is a definition (endpoint, fields, permission), not a new component.

## Not done here

* **The test parameters editor** (10c's parameters and normal ranges per test): a screen of its own, next with the
  diagnostics screens.
* **Imaging studies** (10d) and **reagents** (10e) have no screens yet.

## Verification

* Frontend `npm run check` (typecheck, lint, architecture, format, unit tests, build): clean. 66 unit tests. New:
  `culture-form.spec.ts` covers:
  * the form starts from what was entered (three slots);
  * an empty organism slot closes up with its column;
  * no growth sends no organisms and no antibiogram;
  * what is missing is said before saving.
* Frontend e2e (Playwright, mocked API): 28 passed (one live-backend test skipped). New: `e2e/lab.spec.ts` covers:
  * **Collecting:** an unknown bill number; the bill found in lower case; collected; taken in.
  * **A culture:** refused without an organism; two organisms; all antibiotics added; results clicked and typed; saved
    with the right request; verified; read only.
  * **The report:** printed and handed over.
  * **A written report:** from the template, added to, saved.
  * **Values:** entered; the worklist by status.
  * **Setup:** a test's form set; an antibiotic added.
  * **Accessibility:** no violations on the worklist (axe).
* The OT e2e tests still pass with the shared master table and reason dialog.
* Collect dialog, culture entry, verified culture and written report entry were looked at in screenshots.
