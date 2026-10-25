# Step 4a — HR: organization structure and staff records

Status: **done** (2026-10-25). Previous: [step 3](03-reporting-foundation.md) · Next: step 4b (leave).

HR is the largest area so far (36 entities, ~164 feature files, 26 RDLC reports), so step 4 is split:

| Sub-step | Scope |
|---|---|
| **4a** (this) | HR divisions, departments, sub-departments, designations; staff records with education, emergency contacts, festivals, photo, documents; department incharges; government holidays; festivals; employee list / new employees / profile reports |
| 4b | Leave: types, policies (`LeavePolicies`, `IndividualEmployeeLeavePolicy/Eligible`), applications, multi-level approval (`LeaveApprovalSettings`, `LeaveApproveOnDifferentLevel`, `ApplicationPermission`), leave records, maternity leave, leave reports |
| 4c | Duty roster (`Roaster*`, `DutyRoasterSettings`, `DutyExchangeRecord`, `OverManageDutyRecord`), doctors' days off (`EMR.Holidays`), attendance (`AttendanceRecord`, `ManualAttendance*`, device logs `TimedAttendanceLogs`), attendance reports |
| 4d | Recruitment (`JobCirculation`, `JobCv`; staff `Jcid`/`Jcvid` links) and remaining HR reports |

## Scope of 4a

| Old API | Outcome |
|---|---|
| `HR.Divisions`, `HR.Departments`, `HR.SubDepartments`, `HR.Designations` + controllers | Simple records (`hr_divisions`, `hr_departments`, `hr_sub_departments`, `designations`) |
| `HR.Festivals`, `HR.GovtHolidays` | Simple records (`festivals`, `govt_holidays`) |
| `HR.StaffRecords` (61 columns), `StaffInformController` | `staff_records` + aggregate `StaffMember` with rules |
| `HR.EducationalQualifications`, `HR.EmergencyContacts`, `HR.StaffFestivalMappings` | Owned lists replaced as a whole: `staff_education`, `staff_emergency_contacts`, `staff_festivals` |
| `StaffRecords.ProficePicture` (bytes in the row) | `staff_photos`, binary upload |
| `HR.AttachedDocs`, `HR.DeptInchargeDocs` | `staff_documents` with a `category` (`general`, `incharge-appointment`) |
| `HR.DeptIncharges` | Simple record `department_incharges` (active = no release date) |
| HR reports `ActiveEmployee`, `InActiveEmployee`, `SeparatedEmployee`, `EmployeeListActiveInactive`, `DepartmentWiseEmployee` | **One** report `hr.employee-list` (status + department filters) |
| `NewEmployeeList` | `hr.new-employees` (date range); its salary column comes with Payroll (step 5) |
| `print-cv/{id}` (`PrintEmployeeCVQuery`) | `hr.employee-cv` |
| `StaffRecords.IsPFSettled` | Step 5 (PF book) |
| `StaffRecords.Jcid`, `Jcvid` | Step 4d (recruitment) |
| `EMR.Holidays` (a doctor's personal off days) | Step 4c (roster) |
| gRPC | No HR services in `Server.Grpc` |

## Staff record rules

| Rule | Where |
|---|---|
| Employee number required, unique (case-insensitive), 1–30 of letters, digits, `- / _ .` | domain + `staff_records_employee_no_uq` |
| The sub-department must belong to the department (old `ValidateSubDepartmentAsync`); sub-department is required | handler + domain (`assertSubDepartmentOf`), FK |
| Date of birth before joining; probation end and confirmation not before joining; real calendar dates | domain |
| Biometric enrollment number unique when set (attendance devices match on it) | `staff_records_biometric_uq` |
| One staff record per user account | `staff_records_user_uq` |
| Status: `active` ⇄ `inactive` (with a reason); `active`/`inactive` → `separated` (date ≥ joining, reason) — **final**, the record becomes read-only history | domain + `staff_records_separation_ck` |
| Text trimmed, blank optional text stored as `null`, email lower-cased | domain |
| Every change audited (`staff.hired`, `staff.updated` with field names, `staff.deactivated`, …) | `StaffChanges` |
| Photos PNG/JPEG/WebP ≤ 1 MiB; documents PDF/PNG/JPEG/WebP ≤ 5 MiB; bytes must match the declared type; file names stripped of paths, quotes and control characters | domain (`staff-file.ts`) + table checks |

The old API stored `IsInActive` and `IsSeparated` as two independent flags; the ETL maps
`IsSeparated → separated`, else `IsInActive → inactive`, else `active`, and `InActiveReasons → status_reason`,
`ResignationDate → separation_date`.

## Permissions

| Key | Allows |
|---|---|
| `hr:read` | List and read staff records, photos and documents (personal data) |
| `hr:manage` | Add/edit staff, status changes, lists, photo, documents; department incharges |
| `hr-masters:manage` | Change divisions, departments, sub-departments, designations, festivals, holidays |

Reading the masters needs only a signed-in user (dropdowns). A user whose account is linked to a staff record
(`userId`) can read **their own** record, photo and documents without `hr:read` (`GET /hr/staff/me`). Asking
for a record that does not exist without `hr:read` gives 403, not 404, so record ids cannot be probed.

## Endpoints

Masters (`GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` under `/api/v1`):

| Path | List filters |
|---|---|
| `hr/divisions` | — |
| `hr/departments` | `?divisionId=` |
| `hr/sub-departments` | `?departmentId=` |
| `hr/designations` | — |
| `hr/festivals` | — |
| `hr/govt-holidays` | `?from=&to=` (dates) |
| `hr/department-incharges` | `?departmentId=&staffId=` |

Staff:

| Method and path | Access |
|---|---|
| `GET /api/v1/hr/staff?search=&status=&departmentId=&designationId=&joinedFrom=&joinedTo=&page=&pageSize=` | `hr:read` |
| `POST /api/v1/hr/staff` | `hr:manage` |
| `GET /api/v1/hr/staff/me` | signed in (own linked record) |
| `GET /api/v1/hr/staff/:id` | `hr:read` or own |
| `PATCH /api/v1/hr/staff/:id` | `hr:manage` |
| `POST /api/v1/hr/staff/:id/deactivate` `{ reason }`, `/activate`, `/separate` `{ separationDate, reason }` | `hr:manage` |
| `PUT /api/v1/hr/staff/:id/education` `{ entries }`, `/emergency-contacts` `{ entries }`, `/festivals` `{ festivalIds }` | `hr:manage` |
| `GET` / `PUT` / `DELETE /api/v1/hr/staff/:id/photo` | read: `hr:read` or own; write: `hr:manage` |
| `POST /api/v1/hr/staff/:id/documents?fileName=&category=` (raw body) | `hr:manage` |
| `GET` / `DELETE /api/v1/hr/staff/:id/documents/:documentId` | read: `hr:read` or own; delete: `hr:manage` |

Reports (step 3 machinery; grant them to roles): `hr.employee-list` (`status`: active/inactive/separated/all,
`departmentId`), `hr.new-employees` (`from`, `to`, `departmentId`), `hr.employee-cv` (`staffId`).

## Field mapping (`HR.StaffRecords` → `staff_records`)

| Old | New |
|---|---|
| `EmployeeName`, `EmployeeNo` | `full_name`, `employee_no` |
| `FirstName`, `MiddleName`, `LastName`, `FatherName`, `MotherName` | same, snake_case |
| `DateofBirth`, `Sex`, `MaritalStatus`, `Religion`, `BloodGroup` | `date_of_birth`, `sex` (`male`/`female`/`other`), `marital_status`, `religion`, `blood_group` (`A+` … `O-`) |
| `Nationality` (int), `NationalityOther` | `nationality_country_id` (→ `countries`), `nationality_other` — **see open question 1** |
| `NationIdorPpno`, `TINNo` | `national_id_or_passport`, `tin_no` |
| `MobileNo`, `OfficialMobileNo`, `EmailId`, `GuardianContact` | `mobile_no`, `official_mobile_no`, `email`, `guardian_contact` |
| `PresentAddress`, `PermanentAddress` | same, snake_case |
| `DivisionId`, `DeptId`, `SubDeptId`, `DesignationId`, `JoiningDesignationId` | `division_id`, `department_id`, `sub_department_id`, `designation_id`, `joining_designation_id` (uuid FKs) |
| `JoiningDate`, `ProvableConfirmationdate`, `Confirmationdate` | `joining_date`, `probation_end_date`, `confirmation_date` (dates) |
| `EmployeeCategory` (int) | `employee_category` (small int code) — **see open question 2** |
| `EmployeeJobLocation`, `ServiceNature`, `SalaryStatus`, `PaymentMode`, `BankAccountNo` | `job_location`, `service_nature`, `salary_status`, `payment_mode`, `bank_account_no` |
| `BiometricEnrollmentNo` | `biometric_enrollment_no` (0 → null) |
| `IsHoD` | `is_head_of_department` |
| `WorkingTime`, `TimeofInterval`, `WeeklyHoliday`, `ShiftAndRelay`, `DescriptionOfChangeGroup` | `working_time`, `interval_time`, `weekly_holiday`, `shift_and_relay`, `change_group_description` (kept as text; 4c may structure them) |
| `BMDC`, `BNMC` | `medical_council_no`, `nursing_council_no` |
| `IsInActive`, `IsSeparated`, `InActiveReasons`, `ResignationDate` | `status`, `status_reason`, `separation_date` |
| `ProficePicture` | `staff_photos` |
| `Users.StaffRecordId` (on the user) | `staff_records.user_id` (on the staff record) |
| `TenantId`, `IsSynced` | dropped (see conventions) |

## Old → new routes

| Old | New |
|---|---|
| `GET api/v1/StaffInform`, `/Summary`, `/active/{flag}` | `GET /api/v1/hr/staff?status=…` |
| `GET api/v1/StaffInform/single/{id}` | `GET /api/v1/hr/staff/:id` |
| `POST api/v1/StaffInform` (create or update) | `POST /api/v1/hr/staff`, `PATCH /api/v1/hr/staff/:id`, status endpoints |
| `POST api/v1/StaffInform/GetByEmployeeNo` | `GET /api/v1/hr/staff?search=<employee no>` |
| `GET api/v1/StaffInform/print-cv/{id}` | `POST /api/v1/reports/hr.employee-cv/render` |
| `GET/POST api/v1/EducationalQualifications/{employeeId}` | in `GET /hr/staff/:id`; `PUT /hr/staff/:id/education` |
| `GET/POST api/v1/EmergencyContact/{employeeId}` | in `GET /hr/staff/:id`; `PUT /hr/staff/:id/emergency-contacts` |
| `GET/POST/DELETE api/v1/AttachedDocs` | `POST/GET/DELETE /hr/staff/:id/documents[/:documentId]` |
| `GET/POST/DELETE api/v1/DeptIncharges`, `DeptInchargeDocs` | `/hr/department-incharges`; docs as staff documents with `category=incharge-appointment` |
| `api/v1/Division`, `Department`, `SubDepartments`, `Designation` | `/hr/divisions`, `/hr/departments`, `/hr/sub-departments`, `/hr/designations` |
| `api/v1/Festivals`, `StaffFestivalMapping` | `/hr/festivals`; `PUT /hr/staff/:id/festivals` |
| `POST api/v1/GovtHoliday/List`, `POST/DELETE api/v1/GovtHoliday` | `GET /hr/govt-holidays?from=&to=`, `POST`, `PATCH /:id`, `DELETE /:id` |
| `GET api/v1/Report/print/ActiveEmployee` … `NewEmployeeList` | `POST /api/v1/reports/hr.employee-list/render`, `…/hr.new-employees/render` |

## Shared changes in this step

* `shared/domain/file-types.ts`: file sniffing (PNG, JPEG, WebP, PDF) shared by tenant logos and staff files.
* The raw upload parser accepts `application/pdf` too and allows up to 5 MiB; each handler enforces its own
  limit (logos and photos 1 MiB → 422; above 5 MiB → 413).
* `DrizzleRecordStore`: range filters (`from`/`to`) and CHECK violations → 422 `invalid_<record>`.
* `LocationDirectory` contract (location module) so HR can show a nationality without reading another
  module's table.

## Open questions (need the frontend or live data)

1. **`StaffRecords.Nationality` (int)** — assumed to be a `Countries.Id` (the country table carries a
   `Nationality` column). If it is another code list, the ETL maps it to `nationality_other` instead.
2. **`StaffRecords.EmployeeCategory` (int)** — the meaning of the codes is defined in the frontend; kept as a
   number until the list is known, then it becomes a lookup or an enum.

## Deferred

* Leave, roster, attendance, recruitment: 4b–4d.
* `StaffDirectory` contract for other modules (leave, payroll, doctors) — added with the first consumer (4b).
* Development: a new `.hbs` template added while `npm run start:dev` is running is copied to `dist` only after
  a restart.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 157 passed — new `test/unit/hr/staff-member.spec.ts` (normalization, date and identity rules,
  status transitions, final separation, sub-department check, file sniffing, file names)
* `npm run test:int`: 16 passed (migration set now 5)
* `npm run test:e2e`: 51 passed — new `test/e2e/hr.e2e-spec.ts` (holiday ranges and duplicates, CHECK → 422,
  hire/edit/deactivate/separate, duplicate employee number, sub-department mismatch, lists/photo/documents
  incl. a Bangla file name and a type mismatch, personal-data access incl. own record and id probing,
  search incl. `%`, all three reports)
* Visual check of the employee list and profile layouts; dev server: migrated, restarted, report rendered
