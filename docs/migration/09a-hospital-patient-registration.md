# Step 9a — Hospital: patient registration and UHID

Status: **done** (2026-10-26). Previous: [step 8h](08h-pharmacy-reports.md) · Next: step 9b (doctors and OPD
consultations).

Step 9 is split up. The plan below is tentative:

* **9a** registration and UHID;
* **9b** doctors and OPD consultations (with `UHIDUsesRecords`);
* **9c** hospital service billing and collections;
* **9d** admissions, beds and discharge;
* **9e** the indoor bill, patient ledgers and due collection.

The pharmacy's indoor patients (step 8i) follow 9d.

## Where the old logic lives

* **Entity:** CoxBazar `Domain/Entities/Hospital/RegRecord.cs` (`Hospital.RegRecords`).
* **Create and edit:** `Features/Hospital/Commands/AddEdit/AddEditRegRecordCommand`.
* **UHID number:** `GetUniqueNumberQuery`, which runs `Admin.spGetNextInvoiceNo` with the patient registration
  service unit.
* **Searches:** `GetRegRecordByRegNoIdQuery`, `GetRegRecordByMobileNoQuery`, `GetRegRecordByRegDatesQuery`.
* **Photo:** `AddEditMemberPictureCommand` (`Hospital.MemberPictures`).
* **Card:** `PatientIDCardDocument`.
* **Pages:** `Hospital/PatientRegistration/AddEditPatientPage` and `NewRegistration`.

What the old registration did, and what changes:

* **Data:** the old record was one flat row of text columns. The lookups were copied in as text.
* **Checks:** they were all on the page. A mobile like `abc` was accepted, and the same mobile and name could be
  registered twice without a warning. Now the server checks everything.
* **UHID numbers:** the UHID came from a counter shared with invoices, before the record was saved. A failed save
  used up a number. Now the number is taken in the same transaction as the record.
* **Edits:** an edit kept some old values when a field came back empty, and overwrote others. Now an edit replaces
  every detail at once.
* **Delete:** a hard delete existed but was switched off. Now a record is taken out of use instead, so a UHID is
  never lost or reused.

## UHID

* **Format:** a two-digit year and the year's serial, e.g. **26000001**, like the old numbers (26137390). The serial
  restarts each year and the year keeps numbers unique. The year has room for 999,999 patients.
* **Counter:** `hospital_sequences`, incremented under the row lock of an upsert. Five counters registering at once
  get five different numbers; the e2e test checks this.
* **Prefix:** the database keeps the bare number. The prefix comes from the general setting `uhidPrefix` (the old
  `InvPrefix`, e.g. `FKH`, 1–6 capital letters, through `OrganizationProfile.patientIdPrefix`). Views carry it as
  `uhidLabel` (`FKH26000001`), as do the card, the barcode and the register.
* **Search accepts prefixes:** a UHID typed with a prefix is found by searches and by `GET uhid/:uhid`.

## The patient record (`hospital_patients`)

* **Name:** an optional title and the full name (1–150 characters, spaces collapsed).
* **Personal:** sex (`male`, `female`, `other`); blood group; marital status; religion; occupation; father's,
  mother's and spouse's names.
* **Age:** a date of birth, **or an age** in years, months and days. An age works out the date of birth on the
  registration date, marked `birthEstimated`. Days carry into months and months into years, as on the old page.
  Every view shows the age today.
  * A birth date in the future is refused.
  * A patient is at most 130 years old.
* **Mobile:** a Bangladesh mobile number. `+880` / `880`, spaces and dashes are dropped. Anything else is 422
  `invalid_mobile`. A newborn or an emergency patient may have none when the contact person's mobile is given;
  with neither, 422 `mobile_needed`. Searches by mobile also look at contact mobiles.
* **Email:** optional.
* **ID document:** `nid`, `passport`, `driving_licence` or `birth_certificate`, with its number.
  * Both are given, or neither.
  * An NID has 10, 13 or 17 digits.
  * Numbers are kept in upper case.
  * Only one active patient may hold a document (409 `duplicate_id_document`).
* **Address:** the old free-text parts (care of, house, road, village, post office, area or thana) and a **district**
  from the location masters, checked and named through the published
  `LocationDirectory` (which gained `districtNames`).
* **Contact person** (the old "CP" columns): name, relation, mobile and address.
* **Flags:** a special alert, printed on the card, and `confidential`.
* **Registration:** registered on (today, in the organization's time zone) and registered by.
* **Not ported here:**
  * the old patient-app columns (plain-text password, OTP) come with the patient portal of step 11;
  * corporate client and referring doctor come with billing and doctors.

## Rules

* **Possible duplicates.** A patient is not registered when an active patient reached on the same phone (their own
  mobile, or else the contact's, against either of the other's) has the same name or date of birth. The refusal is 409 `possible_duplicate` and names the UHIDs. `allowDuplicate: true` registers
  anyway, when the counter has made sure it is someone else (for example a child on a parent's mobile). The audit
  log records that choice. `GET matches` lets the page check before it submits.
* **Changes** replace all the details by `version` (409 `stale_patient`). The UHID never changes.
* **Taking a record out of use** (`patient:manage`) needs a reason (registered twice, made by mistake).
  * Searches leave such records out unless `status=inactive` or `all` is asked for.
  * The record cannot be changed until it is put back in use.
  * Putting it back checks its ID document again.
* **Photo:** PNG, JPEG or WebP, up to 1 MiB, the bytes checked against the type.
* **Audit:** every action goes to the audit log as `hospital.patient_*`.

## Endpoints (under `/api/v1/hospital/patients`)

| Method and path | Permission |
|---|---|
| `GET /` (`q` = UHID, mobile or part of a name; `from`, `to`; `status`; paged), `GET /matches`, `GET /uhid/:uhid`, `GET /:id`, `GET /:id/photo` | `patient:read` |
| `POST /` (register), `PUT /:id` (change), `PUT /:id/photo`, `DELETE /:id/photo` | `patient:register` |
| `POST /:id/deactivate`, `POST /:id/reactivate` | `patient:manage` |

## Reports

* `hospital.patient-card` — an ID-card-size card (85.6 × 54 mm). It shows the organization, the name (Bangla
  works), sex, age, blood group, date of birth, mobile, the special alert, the photo and the **UHID as a Code 39
  barcode** for counter scanners, plus a **QR code** of the UHID, name, sex, date of birth and phone, as the old
  card had. The QR code is drawn with the `qrcode` package.
* `hospital.patient-register` — patients registered over a period: UHID, name, sex, age, mobile, district and
  status, with counts by sex. PDF and Excel.

## Decisions taken (after the first version of this step; migration `0035_hospital_patient_contact_phone`)

* The UHID is printed with the organization's prefix from the general settings.
* The card has a QR code as well as the barcode.
* The patient's own mobile is optional when the contact person's is given.
* Merging two UHIDs of the same person comes with step 9e, once visits and bills exist; until then the duplicate is
  taken out of use.
* Registration stays free, as in the old system.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migrations `0034_hospital_patients` (3 tables) and `0035_hospital_patient_contact_phone`
* `npm test`: 306 passed. The new `test/unit/hospital/patient.spec.ts` covers:
  * UHID format and parsing;
  * mobile numbers;
  * age in years, months and days, and the birth date from an age, including month ends and carries;
  * a date of birth or an age, never both;
  * the future and 130-year limits;
  * ID documents;
  * the patient life cycle.
* `npm run test:int`: 16 passed (migration count 36, new tables)
* `npm run test:e2e`: 119 passed. The new `test/e2e/hospital-patients.e2e-spec.ts` covers:
  * registration refused without the permission;
  * UHIDs 1 and 2;
  * a duplicate refused, named in the refusal, and found by `matches`;
  * a child registered by age on the same mobile with `allowDuplicate`;
  * five registrations at once with distinct UHIDs;
  * a bad mobile, an unknown district and a second holder of an NID refused;
  * lookup by `FKH`-prefixed UHID;
  * search by UHID, mobile and name;
  * the period list;
  * a change by version and a stale one refused;
  * deactivation refused to a clerk, then done by a manager: hidden from search and locked against changes, then
    reactivated;
  * photo upload, view and removal;
  * the card PDF and the register Excel;
  * the prefix setting shown as `uhidLabel`;
  * a newborn registered on the contact mobile, refused with neither, found by it, and refused again as a duplicate.
* Card and register checked visually (Bangla name, barcode, photo, alert)
* Dev server restarted; readiness 200
