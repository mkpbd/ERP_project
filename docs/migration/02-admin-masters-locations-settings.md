# Step 2 — Admin masters, locations, tenants, settings

Status: **done** (2026-10-25). Previous: [step 1](01-menus-and-page-access.md) · Next: step 3 (reporting foundation).

## Scope

| Old API | Outcome |
|---|---|
| `Domain/Entities/Admin/*`, `Application/Features/Admin/*`, `Controllers/v1/AdminControllers/*` | Ported to the new `administration` module (except the rows below) |
| `Domain/Entities/Location/*`, `Application/Features/Location/*`, `Controllers/v1/LocationController/*`, `Admin.Countries` | Ported to the new `location` module |
| `SuperAdmin.AppSettings`, `Admin.EditorMargins` (single-row tables) | Settings documents in `administration` |
| `Admin.UHIDUsesRecords` | **Moved to step 9 (Hospital)**: it records patient UHID use per invoice — a transaction, not master data |
| `SuperAdmin.AccountConfigurations`, GL ↔ service mappings | **Moved to step 6 (Account)** |
| `SuperAdmin.ReportAndSp`, `ReportGroup`, `ReportPermission`, `Admin/Queries/DynamicReportQuery`, `GetAllReportQuery` | **Step 3** (reporting foundation) |
| `GetFinancialDashboardDataByTenantIdQuery`, `GetManagementDashboardDataByDatesQuery` | **Step 6 / dashboards** — they read Account and billing data |
| Reports (RDLC) | None in this scope |
| gRPC | No Admin/Location services in `Server.Grpc`; nothing to port |

## New building block: simple records

The old API had a command, a query, a response class, an AutoMapper profile and a controller per master
table. Most were identical except for field names. Here a master table is declared once and served by
shared, generic code (see [architecture.md](../architecture.md#simple-records-master-data)):

| Piece | File |
|---|---|
| `RecordType` (name, read/manage permission, store) + `RecordTypeRegistry` | `src/shared/application/records.ts` |
| Generic create/update/delete/list/get handlers: authorize, transaction, audit `<name>.created/updated/deleted` | `src/shared/application/record.handlers.ts` |
| `DrizzleRecordStore`: CRUD over one table; unique / foreign-key / restrict violations → 409 / 404 | `src/shared/infrastructure/persistence/drizzle-record-store.ts` |
| `createRecordController()`: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` with Zod DTOs and OpenAPI | `src/shared/presentation/record-controller.ts` |

Adding a master table in a later step = table in the module schema + one `RecordType` entry + DTOs + one
`createRecordController({...})` call. Tables with real behaviour still get their own aggregate and handlers.

## Tables (migration `0002_admin_masters_locations.sql`)

| Table | From | Notes |
|---|---|---|
| `countries` | `Admin.Countries` | `CountryName` → `name`; unique name and short code (case-insensitive) |
| `divisions` | `Location.Divisions` | Unique name |
| `districts` | `Location.Districts` | `BnName` → `name_bn`; unique name per division; FK `division_id` (restrict) |
| `admin_departments` | `Admin.Departments` | Billing/service departments, not HR departments (HR has its own table in step 4) |
| `service_units` | `Admin.ServiceUnits` | Unique name per department; FK restrict |
| `serve_types` | `Admin.ServeTypes` | Unique name |
| `discount_categories` | `Admin.DiscountCategories` | `DiscountInParcent` (float) → `discount_percent numeric(5,2)`, 0–100 |
| `printers` | `Admin.Printers` | `PrinterName` → `name` |
| `payment_modes`, `payment_channels` | `Admin.PaymentModes`, `Admin.PaymentChannels` | The old API had no endpoints for them (rows were edited in the database); now regular masters |
| `editor_shortcuts` | `Admin.EditorShorkeys` (sic) | Unique code |
| `ipd_admission_page_controls`, `investigation_entry_page_controls` | same names in `Admin` | Unique `control_id` |
| `tenants` | `Admin.Tenants` | `Name2` → `name_alt`, `HotLine` → `hotline`, `BranchId` (it pointed to a District) → `district_id` |
| `tenant_logos` | `Tenants.Logo`, `Tenants.Logo2` | Separate table: `(tenant_id, slot)` with `slot` `primary`/`secondary`, PNG/JPEG/WebP only, ≤ 1 MiB |
| `settings` | `SuperAdmin.AppSettings`, `Admin.EditorMargins` | `key` → JSON document (`general`, `editor-margins`) |

All ids are `uuid`; old `int` ids get a mapping in the ETL (step 13). Old rows with duplicate names would
violate the new unique indexes — the ETL must report them for cleanup.

## Permissions

| Key | Allows |
|---|---|
| `locations:manage` | Change countries, divisions, districts |
| `masters:manage` | Change admin masters (departments … page controls) |
| `tenants:manage` | Change tenants and upload/remove their logos |
| `settings:manage` | Change settings documents |

Reading any of these needs only a signed-in user: they are dropdown data, report headers and UI settings,
as in the old API (`ApiKeyPolicy` = any signed-in user).

## Endpoints

Each master has `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` under `/api/v1`:

| Path | List filter |
|---|---|
| `locations/countries` | — |
| `locations/divisions` | — |
| `locations/districts` | `?divisionId=` |
| `admin/departments` | — |
| `admin/service-units` | `?departmentId=` |
| `admin/serve-types` | — |
| `admin/discount-categories` | `?departmentId=` |
| `admin/printers` | — |
| `admin/payment-modes` | — |
| `admin/payment-channels` | `?paymentModeId=` |
| `admin/editor-shortcuts` | — |
| `admin/page-controls/ipd-admission` | — |
| `admin/page-controls/investigation-entry` | — |
| `admin/tenants` | — |

Plus:

| Method and path | Access |
|---|---|
| `GET /api/v1/admin/tenants/:id/logos/:slot` | signed in; returns the image bytes with their content type |
| `PUT /api/v1/admin/tenants/:id/logos/:slot` | `tenants:manage`; raw body with `Content-Type: image/png`, `image/jpeg` or `image/webp` |
| `DELETE /api/v1/admin/tenants/:id/logos/:slot` | `tenants:manage` |
| `GET` / `PATCH /api/v1/admin/settings/general` | signed in / `settings:manage` |
| `GET` / `PATCH /api/v1/admin/settings/editor-margins` | signed in / `settings:manage` |

Errors: duplicate → 409 `<thing>_taken`; unknown referenced id → 404 `<referenced>_not_found`;
deleting something still referenced → 409 `<record>_in_use`; unknown body fields → 400.

## Settings field mapping

| Old `AppSettings` | New `general` |
|---|---|
| `JSPrintManagerURL` | `jsPrintManagerUrl` (URL or null) |
| `DailyFoodBillInWard`, `DailyFoodBillInOthers` | `dailyFoodBillInWard`, `dailyFoodBillInOthers` |
| `VisitingCardRate` | `visitingCardRate` |
| `VATRegNo` | `vatRegistrationNo` |
| `IPDServiceCharge` | `ipdServiceChargePercent` (0–100) |
| `IsAutoInvestigationInvoiceAfterIndent` | `autoInvestigationInvoiceAfterIndent` |
| `IsTubeAndNeedleWillbeAutoAdded` | `autoAddTubeAndNeedle` |
| `MenuBackGroudColor` | `menuBackgroundColor` (hex colour) |
| `SampleDispatchDelayInMinute` | `sampleDispatchDelayMinutes` |
| `IsAppointSerialAuto` | `autoAppointmentSerial` |
| `WillTecnlogistSignatureAddOnReport` | `addTechnologistSignatureOnReport` |
| `IsIntegratedAccountsEnabled` | `integratedAccountsEnabled` |
| `IsStockEntryGTotalDisabled` | `stockEntryGrandTotalDisabled` |

`EditorMargins.MLeft/MRight/MTop/MBottom` → `editor-margins.left/right/top/bottom` (CSS lengths such as `10mm`).

A settings read returns defaults overlaid with the saved values, so fields added later need no data
migration. `PATCH` changes only the fields sent.

## Old → new routes

| Old | New |
|---|---|
| `GET/POST api/v1/Country` | `GET/POST /api/v1/locations/countries`, edit with `PATCH /:id` |
| `GET api/v1/LocDivision` | `GET /api/v1/locations/divisions` (now also writable) |
| `GET/POST api/v1/District` | `GET/POST /api/v1/locations/districts`, `PATCH /:id`, `DELETE /:id` |
| `GET/POST api/v1/AdminDepartments` | `/api/v1/admin/departments` |
| `GET/POST/DELETE api/v1/ServiceUnits` | `/api/v1/admin/service-units` |
| `GET/POST/DELETE api/v1/ServeType` | `/api/v1/admin/serve-types` |
| `GET/POST/DELETE api/v1/DiscountCategory` | `/api/v1/admin/discount-categories` |
| `GET/POST/DELETE api/v1/Printers` | `/api/v1/admin/printers` |
| `GET api/v1/Editor/GetEditorShortkey`, `POST .../SaveEditorShortkey`, `DELETE .../DeleteShortKey/{id}` | `/api/v1/admin/editor-shortcuts` |
| `GET api/v1/Editor/GetMargin`, `POST .../SaveMargin` | `GET/PATCH /api/v1/admin/settings/editor-margins` |
| `GET/POST/DELETE api/v1/IPDAdmissionpageControl` | `/api/v1/admin/page-controls/ipd-admission` |
| `GET/POST/DELETE api/v1/InvestigationEntryPageControl` | `/api/v1/admin/page-controls/investigation-entry` |
| `GET/POST/DELETE api/v1/Tenants`, `GET api/v1/Tenants/{id}` | `/api/v1/admin/tenants`; logos via `/:id/logos/:slot` instead of `Logo`/`Logo2` byte arrays in JSON |
| `POST api/v1/Tenants/GetFinancialDashboardByTenantId` | Step 6 |
| `GET/POST/DELETE api/v1/AppSetting` | `GET/PATCH /api/v1/admin/settings/general` (there is one document; nothing to delete) |
| `POST api/v1/UHIDUsesRecords` | Step 9 |

"Add or edit" endpoints (`POST` with `Id = 0` / `Guid.Empty` to create) are split into `POST` (create) and
`PATCH /:id` (edit only the fields sent).

## Behaviour changes from the old API

| Old | New | Why |
|---|---|---|
| Names were not unique | Unique (case-insensitive) where the name identifies the row | Duplicates broke dropdowns and reports |
| Edits ignored `null` (`request.X ?? existing.X`) | `PATCH` sets what is sent, including `null` for optional fields | Explicit partial update |
| List responses embedded `DeptName` | Only `departmentId`; load departments separately | One generic shape per record; lists are small |
| Deleting a used row failed with a database error | 409 `<record>_in_use` | Clear error |
| Tenant logos as base64 in JSON | Separate binary upload/download; bytes must really be PNG/JPEG/WebP; SVG refused | The JSON body limit is 100 kB; SVG can carry script |
| `TenantService` hard-coded tenant 1 | Tenants are plain records; no per-request tenant | The old system was single-tenant in practice (filters commented out) |
| Masters had no audit trail | Every change is in `audit_logs` (`<record>.created/updated/deleted`) | |

## Fixes to shared code found in this step

* **`ON DELETE RESTRICT` reported as 500.** PostgreSQL raises it as `23001`, not `23503`;
  `foreignKeyViolationConstraint` now recognises both.
* **Oversized or malformed request bodies returned 500** (also before this step, for JSON over 100 kB).
  Body-parser errors now become Problem Details 413 `payload_too_large` / 400 `bad_request`.
* Step 1's `test/unit/navigation/handlers.spec.ts` was missing an `override` (caught by `tsc`, not by vitest).

## Deferred

* Countries, divisions, districts and payment modes have no seed data in the old code (`SeedData.sql` is
  empty); they come from the live database in the ETL (step 13).
* Who uses `printers`, `serve_types`, page controls: the consuming modules (Hospital, Diagnosis) reference
  these tables in their steps.
* A per-request "current tenant" and tenant-scoped data — only if a multi-tenant deployment is needed.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 132 passed — new `test/unit/shared/records.spec.ts` (generic handlers, registry),
  `test/unit/administration/domain.spec.ts` (logo sniffing and limits, settings merge)
* `npm run test:int`: 16 passed (migration set now 3)
* `npm run test:e2e`: 40 passed — new `test/e2e/admin-masters.e2e-spec.ts` (location CRUD + filters +
  409/404 mapping, department links, read vs. manage permission, tenant logos incl. type mismatch and
  413, settings merge and validation, body-parser errors, OpenAPI paths)
* Dev database migrated; dev server serves `/admin/settings/general`, `/locations/divisions`,
  `/admin/service-units`
