# Step 14b — Data migration gaps: culture reports and the rest of the inpatient notes

Status: **done** (2026-10-31). Previous: [step 14a](14a-access-and-discounts.md).

Step 13f left out microbiology culture reports and some of the inpatient notes. This step brings them over too, with
the same loaders, so a fresh run brings the whole clinical history:

```
ETL_SOURCE_URL=… npm run etl -- [--dry-run] [--only=lab-history,note-history]
```

## Culture reports (`lab-history`)

The old culture and sensitivity report was a pathology report with extra tables. They now come with the lab report:

| Old (`Diag.*`) | Here |
|---|---|
| `CSNoGrowthResults` (+ `CSGrowthTypes`, `MicroBioBacterias` A/B/C, `CSMessases`) | The report text: the growth, the organisms isolated, colony count, incubation, culture media, the message |
| `CSOthersValues` | The report text: microscopy (pus cells, epithelial cells, RBC) and its note |
| `CSGrowths` (+ `CSAntibiotics`) | One value per antibiotic, see below |

**One value per antibiotic:**

* The result is given against each organism. The old `ValueA`, `ValueB` and `ValueC` were for the culture's
  organisms A, B and C: "E. coli: S · Klebsiella: I".
* The zone diameter is kept as the reference ("Zone 22").

The report prints with its results table as any old lab report, and shows in the patient portal under the same rule
(verified or delivered there).

## The rest of the inpatient notes (`note-history`)

Besides consultant visit and procedure notes (13f), these come over as staff-only notes:

| Old (`EMR.*`) | Here |
|---|---|
| `ICUCourses` | "ICU course": the day's course |
| `TransferNotesEMR` | "Transfer note (department)": the note |
| `NurseToNursePatientHandOverRecords` | "Nurse handover": who handed over to whom, when, and whether it was acknowledged. The old record held only that; the names are the users' own |
| `HandOverSheets` | "Handover sheet": the form written out one field a line ("Blood pressure: 120/80", "On oxygen: yes", "Diet › Type: Soft"). Empty fields are left out; a sheet that is not JSON is read as text |

**Handover sheets.** They are matched to stays like the other notes. A sheet whose patient is not a stay is not
read.

## Decisions ("next" without answers)

1. **Culture reports are finished, not new records.** They extend the lab report they belong to: the text carries
   the culture, the values carry the sensitivity grid.
2. **The sensitivity grid is kept as values (one per antibiotic), not as a table of its own.** Nothing here
   calculates on sensitivities. Lab results here keep values in one form, and the print shows them as a table.
3. **Handover records and sheets come as notes,** like every other inpatient note from the old system: read-only,
   for staff.

## Not done here

* **Treatment orders and doses, diet and other EMR orders** (`TreatmentOrderArchive*`, `ColonscopyEMROrder` …). They
  were orders for stays long discharged; the stays still open at the cut-over are ordered here.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. No new migration.
* `npm test`: 436 passed. `test/unit/data-migration/history-records.spec.ts` adds:
  * cultures with and without growth;
  * microscopy;
  * sensitivity rows against the organisms (empty ones dropped);
  * handover forms written out;
  * text that is not JSON.
* `npm run test:int`: 16 passed.
* `npm run test:e2e`: 164 passed. `test/e2e/data-migration.e2e-spec.ts` adds:
  * **A urine culture:** the growth, two organisms, colony count, incubation, media, the message and microscopy as
    text; Ampicillin and Ciprofloxacin against both organisms with the zone; shown to the patient.
  * **The notes:** an ICU course, a transfer note named by its department, a nurse handover, and a handover sheet's
    form written out.
* Dev server restarted; readiness 200.
