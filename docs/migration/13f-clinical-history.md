# Step 13f — Data migration: clinical history

Status: **done** (2026-10-31). Previous: [step 13e](13e-open-documents-dues.md) · Next: [step 13g](13g-cut-over-runbook.md).

```
ETL_SOURCE_URL=… npm run etl -- [--dry-run] [--only=lab-history,prescription-history]
```

The old system's clinical records come over **read-only, as they were written there**:

* every prescription, lab and imaging report, discharge certificate and inpatient note of the patients brought over
  in 13a;
* everything, not only recent years (medical records are kept).

No cut-over day is needed: it is history.

## Where they live

| Table | What |
|---|---|
| `clinical_history_records` | A record of a patient: its kind, title, old number, day, the text as written, and whether the patient may see it. The old table and row it came from is kept (`source`, unique) |
| `clinical_history_values` | A lab report's results, one per test: result, unit, reference range. They make a patient's results followable over time |

Migration `0058_clinical_history` adds the two tables.

## What comes over

| Old | Kind here | How |
|---|---|---|
| `Diag.PathologyReports` + `PathologyReportDetails` | lab report, **with values** | See the lab rules below |
| `Diag.PathologyDescriptiveReports` | lab report | The report text. The patient is the invoice's; reports finalised by a doctor are shown to the patient |
| `Diag.RadiologyReports` | imaging report | The same |
| `Rx.VisitHistories` (+ complaints, impressions, drugs, investigations, advice) | prescription | See the prescription rules below |
| `Hospital.DischargeCertificate` | discharge certificate | The certificate text of the stay; shown to the patient |
| `EMR.ConsultancyVisitNotes`, `EMR.ProcedureNotes` | note | Staff only, as notes are here |

**Lab reports:**

* The patient is the one whose invoice the lab number was collected for.
* The title names the tests, e.g. "Laboratory report: CBC".
* Every result row is kept with its unit and reference range. Rows with no result (headings) are dropped.
* Reports verified or delivered there are shown to the patient.

**Prescriptions** are written out as they read:

* complaints and how long;
* clinical impression;
* Rx (medicine, dose, duration);
* investigations;
* advice;
* notes;
* follow-up.

They are shown to the patient.

**Text.** The old editors kept HTML. It is read as text: paragraphs and line breaks become lines, list items get
bullets, table cells are set apart, tags, styles and entities go.

**Rejected:**

* no patient (the invoice or stay is not found);
* the patient was not brought over;
* no day;
* nothing written.

**Scanned files and images.** The old database kept none per patient (only staff signatures and member photos), so
there are none to bring.

## Reading them here

**Staff, with `emr:read`:**

* `GET /clinical/patients/:id/history` lists a patient's records, newest first; `?kind=` keeps one kind.
* `GET /clinical/history/:id` returns a record with its text and results.
* `GET /clinical/patients/:id/history/trend?test=Hemoglobin` returns a test's results over time, oldest first. A
  result that is a plain number comes with its value, ready for a chart. "Positive" or "<5" stay text.

**The report `clinical.history-record`** prints a record:

* the patient;
* the kind, the old number and the day;
* a note that it was brought over as written;
* the results table;
* the text.

**Patient portal.** Shared records are among the patient's documents ("… (old system)"), printed with the same report.
Records not finalised in the old system and inpatient notes are not shown.

## Decisions (step 13e's open questions; "next" without answers, so the recommendations)

1. **Prescriptions, lab and imaging reports, discharge certificates and EMR notes all come over**, read-only, as the
   patient's history.
2. **Everything**, not only recent years.
3. **Records are kept as written (text), except lab results**, which come as values too, so results can be followed
   over time.
4. **Files and images:** the old database has none per patient, so nothing is brought; no size limit was needed.
5. **The patient portal shows the history** under the same rule as new records: only what was finalised (verified,
   delivered or signed) there, never inpatient notes.

## Not done here

* **The other EMR notes:** ICU course, transfer and handover notes, treatment orders and doses, diet. They stay in the
  old database.
* **Old OPD prescriptions' doctors.** The old Rx visit did not record the doctor; the appointment did. The author is
  left empty.
* **Microbiology culture reports (`CS*`).** They come with their comments only, not the organism and antibiotic grid.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
* The new report was checked by a screenshot of its HTML (lab report with values and text).
* `npm test`: 431 passed. New: `test/unit/data-migration/history-records.spec.ts` covers:
  * old editors' HTML read as text (paragraphs, lists, tables, entities, styles dropped);
  * an Rx visit written out.
* `npm run test:int`: 16 passed (migration count 59, the two new tables).
* `npm run test:e2e`: 162 passed. `test/e2e/data-migration.e2e-spec.ts` adds history:
  * **What came over:** two lab reports (a third without a patient rejected), an X-ray report, a prescription, a
    discharge certificate and a note, listed newest first.
  * **As written:** the prescription written out; the X-ray and the certificate read from HTML.
  * **Trend:** haemoglobin followed over two reports; values kept with unit and reference; the empty heading row
    dropped.
  * **Portal:** the patient sees the four finalised records, not the undelivered report or the note; one printed.
  * **Re-run:** nothing written twice.
* Dev server restarted; readiness 200.
