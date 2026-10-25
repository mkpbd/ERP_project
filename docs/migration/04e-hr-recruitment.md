# Step 4e — HR: recruitment and ID cards

Status: **done** (2026-10-25). Previous: [step 4d](04d-hr-attendance.md) · Next: step 5 (payroll).

This step finishes HR. The old recruitment feature was small (a circular number and title, and CV rows with
the file bytes inline), so it is ported as simple records plus a file store. The step also ports the last
two HR prints.

## Scope

| Old API | Outcome |
|---|---|
| `HR.JobCirculations` (`CirculationNo`, `CirculationTitle`) + `JobCirculationController` | Simple record `job_circulars`; the number is unique (case-insensitive). New optional fields: department, designation, vacancies, published/closing dates, description |
| `HR.JobCvs` (`Jcid`, `Applyfor`, `ApplicatName`, `ApplicatMobileNo`, `Status`) + `JobCvController` | Simple record `job_applications`; status is now a fixed list |
| `JobCvs.FileName`, `CvinPdf`, `CvinWord` (bytes inside the row) | `job_application_files`: up to 5 files per application, PDF or Word `.docx`, 5 MiB each, uploaded and downloaded separately |
| `Reports/IDCard` (`IDCardDocument`) | Report `hr.id-card` |
| `Reports/Kham` (`KhamDocument`, the salary envelope) | **Step 5**: it prints the month's salary amount, which belongs to payroll |
| `Reports/EmployeeLeaveApplication`, `EmployeeWiseLeaveStatement(Summary)` | Already ported in [step 4b](04b-hr-leave.md) (`hr.leave-applications`, `hr.leave-statement`) |
| `CVDocument` (a staff member's profile) | Already ported in [step 4a](04a-hr-staff-records.md) (`hr.employee-cv`) |

## Model and rules

* **Circular**: `circularNo` (1–50, unique ignoring case → 409 `circular_no_taken`), `title` (1–200), optional
  `departmentId`, `designationId`, `vacancies` (1–10,000), `publishedOn`, `closesOn` (not before
  `publishedOn`), `description`. A circular with applications cannot be deleted (409 `job_circular_in_use`).
* **Application**: `circularId`, `applicantName` (1–150), `mobileNo` (required by the API; digits, spaces,
  dashes, optional `+`), optional `email`, `appliedFor`, `remarks`, and `status`:
  `received` (default) → `shortlisted` → `interviewed` → `selected` / `rejected`, or `withdrawn`. Any status
  can be set by `PATCH` (the old system had no workflow either). The same mobile number can apply to a
  circular only once (409 `application_exists`).
* **CV files**: the bytes must really be a PDF or a Word `.docx` and match the `Content-Type`. Old binary
  `.doc` files and macro-enabled packages are refused. File names are cleaned the same way as staff
  documents. Up to 5 files per application (422 `too_many_files`); deleting an application deletes its files.
  Uploads and removals are audited under the application (`job_application.file_added` / `file_removed`).

## ID cards

`hr.id-card` takes either `staffIds` (1–200 people) or `departmentId` (all active staff of the department).
Each person gets a front and a back card (CR80, 54 × 85.6 mm), four people per A4 landscape sheet, with thin
cutting lines. Reports can now use a **bare** page (no letterhead, title or footer, 5 mm margins) for cards
and labels (`pdf: { engine: 'html', bare: true }`).

* Front: logo and organization name, photo (from the staff record), name, designation, department, ID
  (employee) number, signature line.
* Back: blood group, joining date, emergency contact (organization hotline and the official mobile number),
  return address, "property of" note.
* The old card hard-coded another hospital's address, phone and e-mail, and a signature image file. The new
  card takes the organization name, address, hotline and logo from the organization profile (step 2).

## Permissions

| Key | Allows |
|---|---|
| `recruitment:read` | List circulars and applicants, download CVs |
| `recruitment:manage` | Create, edit and delete circulars and applicants; upload and remove CVs |

Applicants' details are personal data, so unlike most masters, circulars are not open to every signed-in
user. ID cards are a report; who may print them is set per role in the report access list (step 3).

## Endpoints (under `/api/v1`)

| Method and path | Access |
|---|---|
| `GET/POST hr/recruitment/circulars?departmentId=&designationId=&from=&to=`, `GET/PATCH/DELETE …/:id` | read / manage |
| `GET/POST hr/recruitment/applications?circularId=&status=&mobileNo=`, `GET/PATCH/DELETE …/:id` | read / manage |
| `GET hr/recruitment/applications/:id/files` | read |
| `POST hr/recruitment/applications/:id/files?fileName=` (raw body, `application/pdf` or `.docx` type) | manage |
| `GET/DELETE hr/recruitment/applications/:id/files/:fileId` | read / manage |

Reports (`POST /reports/<key>/render`):

* `hr.job-applications` (`circularId`, optional `status`): applicants with status, CV count and status
  totals; PDF + Excel.
* `hr.id-card` (`staffIds` or `departmentId`): PDF.

## Old → new routes

| Old | New |
|---|---|
| `GET api/v1/JobCirculation` | `GET /hr/recruitment/circulars` |
| `POST api/v1/JobCirculation` (`Id = 0` creates, otherwise updates) | `POST /hr/recruitment/circulars`, `PATCH /hr/recruitment/circulars/:id` |
| `GET api/v1/JobCv` | `GET /hr/recruitment/applications` (file metadata via `…/:id/files`) |
| `POST api/v1/JobCv` (with `CvinPdf` / `CvinWord` bytes in JSON) | `POST`/`PATCH /hr/recruitment/applications[/:id]`, then `POST …/:id/files` per file |
| `POST api/v1/Reports/IDCard` (card data sent by the client) | `POST /reports/hr.id-card/render` (data loaded from the staff record) |
| `POST api/v1/Reports/Kham` | step 5 |

## Data migration notes (step 13)

* `JobCvs.CvinPdf` and `CvinWord` become up to two rows in `job_application_files`. Word files that are the
  old binary `.doc` format cannot be uploaded through the API; the ETL loads them as they are only if the
  `job_application_files_type_ck` check is widened, otherwise they are reported and skipped.
* Free-text `Status` values are mapped onto the fixed list; unknown values become `received` with the old
  text kept in `remarks`.
* Rows without a mobile number are allowed in the table (the column is nullable for them).

## Open questions

1. Should **selecting** an applicant create the staff record (hire) directly, carrying name and mobile over?
2. Should the ID card show a **signature image** (the old card used a fixed `Signature.png`)? It could be
   stored with the organization profile.
3. Should the card brand colour (the old green `#00A658`) come from the organization profile?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 188 passed — new `test/unit/hr/recruitment.spec.ts` (.docx recognised by its entries; xlsx, macro
  packages and binary .doc refused; content-type match; size limits)
* `npm run test:int`: 16 passed (migration set now 9)
* `npm run test:e2e`: 66 passed — new `test/e2e/recruitment.e2e-spec.ts` (circular number taken ignoring
  case, date order, permissions, duplicate applicant, status filter, circular in use, applicants report PDF +
  Excel; PDF and .docx upload with a Bangla file name, wrong bytes, wrong type, viewer cannot upload, unknown
  application, download bytes and header, five-file limit, audit, files removed with the application; ID
  cards by staff and by department, both/unknown refused)
* Visual check of the ID card sheet (Bangla names render); dev server migrated, restarted, all 14 recruitment
  routes mapped
