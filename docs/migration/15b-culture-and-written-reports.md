# Step 15b — Laboratory: culture and sensitivity, written reports (histopathology)

Status: **done** (2026-10-31). Previous: [step 15a](15a-operation-theatre.md) · Screens:
[step 16b](16b-lab-screens.md) · Next: step 15c (inpatient care gaps).

The second gap the page-by-page check of the old UI found. Step 10c had left out culture reports and free-text reports
("come later"); 14b brought the old ones over as history only. Here they are entered, verified and printed.

## Where the old logic lives

CoxBazar, `Diag.*`:

| Old page | Tables | What it did |
|---|---|---|
| `/diagnostic/cs-report`, `/diagnosis/cs-report-dashboard` | `CSOthersValues`, `CSNoGrowthResults`, `CSGrowths` on a `PathologyReport` flagged `IsCSReport` | Microscopy (pus cells, epithelial cells, RBC, analyzer, note); growth or no growth, organisms A, B and C, growth type, colony count, incubation, media, message; an antibiogram of S, I or R per antibiotic against each organism, with the zone |
| `/diagnosis/CSAntibiotic`, `/diagnosis/microbiobacteria`, `/diagnosis/CSGrowthType`, `/diagnosis/CSMessase` | `CSAntibiotics`, `MicroBioBacterias`, `CSGrowthTypes`, `CSMessases` | Names only |
| `/diagnostic/pathology-descriptive-report-entry`, `…-finalization`, `…-published` | `PathologyDescriptiveReports` | An HTML text per invoice and test, a technologist and a pathologist named, "finalised" by a doctor (`SampleStatus` 6, then 7) |
| `/diagnosis/PathologyTemplate` | `PathologyTemplates` | Name, description, HTML |

**Faults of the old pages:**

* **No rule said which tests were cultures or written reports.** Any test could be given either report; the worklists
  listed every pathology test.
* The antibiogram's values were free text: anything typed was kept.
* The C/S report was saved in pieces (microscopy, culture, each antibiogram row) outside a transaction.
* A descriptive report had no lab number and no sample; it was keyed by the invoice number and the test.
* Templates were HTML from an editor, printed as they were.

## What it is here

**Each lab test has a report form** (`PUT /lab/tests/:testId/form`, `lab:manage`):

* `values`, the default: its parameters and ranges (10c);
* `culture`;
* `descriptive` (written text).

An imaging test is not the lab's (`not_lab_test`).

**Results go through the same steps whatever the form** (10c):

* collected on a sample with its lab number;
* entered by the lab (`lab:result`);
* verified by someone else (`lab:verify`, `same_person`);
* printed;
* handed over (held while the patient owes).

`GET /lab/results/:id` says which `form` to enter it in. Entering it in another form is refused (`wrong_form`).

**A culture** (`PUT /lab/results/:id/culture`):

* **Microscopy:** pus cells, epithelial cells, RBC, the analyzer and a note.
* **The culture:**
  * growth or no growth;
  * the growth type;
  * colony count, incubation, media;
  * a closing message (picked from the standard ones or written).
* **On a growth:** one to three organisms in order, and the antibiogram:
  * one row per antibiotic, with its zone;
  * the result against each organism: S, I, R or nothing;
  * an antibiotic tested against none is left out;
  * an antibiotic named twice, or a result count that differs from the organisms, is refused.
* **No growth** has no organisms and no antibiogram.
* Organisms, antibiotics and the growth type are picked from the masters by id. Their names are copied, so renaming a
  master later does not change a report already made.

**A written report** (`PUT /lab/results/:id/text`):

* The text as written, line breaks kept, up to 20,000 characters.
* It is usually started from a template.
* It is plain text, so nothing typed is run as HTML on the print.

**The lab report** (`laboratory.lab-report`, the same print as 10c) shows each test in its form:

* values with ranges and H / L;
* a culture:
  * the microscopy and the culture;
  * the antibiogram with a column per organism;
  * the message;
  * the key S / I / R;
* a written report as written.

**Masters** (record endpoints; `lab:read` to see, `lab:manage` to change):

* `/lab/antibiotics`: name and class; ordered by class;
* `/lab/organisms`;
* `/lab/growth-types`;
* `/lab/culture-messages`;
* `/lab/report-templates`: name, description, text.

## Data migration

The old masters come over with `npm run etl`, as decided:

| Loader | Old | Here |
|---|---|---|
| `lab-antibiotics` | `Diag.CSAntibiotics` | `lab_antibiotics`; the class is set here |
| `lab-organisms` | `Diag.MicroBioBacterias` | `lab_organisms` |
| `lab-growth-types` | `Diag.CSGrowthTypes` | `lab_growth_types` |
| `lab-culture-messages` | `Diag.CSMessases` | `lab_culture_messages` (up to 500 characters) |
| `lab-report-templates` | `Diag.PathologyTemplates` | `lab_report_templates`: the HTML as text, a paragraph a line; a template with no text is left out (`no_text`) |

Deleted rows are left out. A name typed twice (any case) comes over once.

The old C/S and descriptive reports themselves stay history (13f, 14b).

## API

| Endpoint | Who | What |
|---|---|---|
| `GET` / `PUT /lab/tests/:testId/form` | `lab:read` / `lab:manage` | `values`, `culture` or `descriptive` |
| `PUT /lab/results/:id/culture` | `lab:result` | `version`, the microscopy, `growth`, `growthTypeId`, `organismIds`, colony count, incubation, media, message, `sensitivity` (`antibioticId`, `zone`, `results`), `comment` |
| `PUT /lab/results/:id/text` | `lab:result` | `version`, `narrative`, `comment` |
| `GET /lab/results/:id`, `GET /lab/samples/:id` | `lab:read` | Now with `form`, `culture` and `narrative` |
| `GET /lab/tests?q=` | `lab:read` | Lab tests by name or code (up to 20), with their form, for the screens |
| `GET /lab/orders/:number` | `lab:read` | A bill by its number (any case), with each lab department's tests and whether each is in work: what the collector collects |
| `/lab/antibiotics`, `/lab/organisms`, `/lab/growth-types`, `/lab/culture-messages`, `/lab/report-templates` | `lab:read` / `lab:manage` | The masters |

No new permissions.

## Decisions ("next" without answers: the recommendations)

1. **The old antibiotics, organisms, growth types, messages and templates come over** (ETL above), rather than being
   entered again.
2. **The report form belongs to the test**, not to each entry. The worklist then shows where each result is entered,
   and the faults above cannot happen.
3. **A culture and a written report are results like any other.** Same sample, lab number, verification, report and
   handing over. The old separate descriptive pages (entry, finalisation, published) become those steps.
4. **Up to three organisms**, as the old report allowed. The antibiogram is kept as a table (one row per antibiotic,
   a result per organism), so resistance can be counted later.
5. **Written reports are plain text.** Old templates lose their HTML formatting; headings stay as lines.
6. **The antibiotic's class is new**, to order the antibiogram. Old antibiotics come without one.

## Not done here

* **The lab screens:** done in [step 16b](16b-lab-screens.md).
* **An antibiogram summary** (resistance by organism over a period): the data is kept for it.
* **The lab test parameters of the old system** (`ReportParameters`, `AgeVariantNormalValue`) are not brought over by
  the ETL yet; they are set per test in 10c.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
* Migration `0060_lab_culture_and_written_reports`:
  * nine tables;
  * `lab_results.form` and `narrative`;
  * results entered before are marked `values`.
* The lab report with a culture (two organisms, zones, S / I / R) and a written report was checked in a screenshot.
* `npm test`: 445 tests passed. New: `test/unit/laboratory/culture.spec.ts` covers:
  * the antibiogram (one result per organism, untested antibiotics left out, S, I or R, no antibiotic twice);
  * growth and no growth;
  * written text kept with its line breaks;
  * a result entered in one form, then another, then verified.
* `npm run test:int`: 16 tests passed (migration count 61).
* `npm run test:e2e`: 170 tests passed. New: `test/e2e/laboratory-culture.e2e-spec.ts` covers:
  * **Masters:** kept by the lab manager only, each name once, antibiotics ordered by class.
  * **Forms:** set by the manager; refused for an imaging test.
  * **A culture:**
    * values refused for it (`wrong_form`);
    * an antibiogram not matching the organisms refused, and an organism not in the list;
    * entered with two organisms and two antibiotics, the names copied.
  * **A written report:** from a template, line breaks kept.
  * **Both:** verified by the pathologist, not by who entered them; closed once verified; printed.
  * **No growth:** refused with an organism, entered without.
  * **Lookups:** lab tests found with their form (not the X-ray); a bill found by its number in lower case, the lab's
    tests only, in work once collected; an unknown number 404.
  * **ETL** (`data-migration.e2e-spec.ts`): the masters and a template brought over (HTML as text, a name typed twice
    once, a blank template left out), and kept on a re-run.
* Dev server restarted; readiness 200.
