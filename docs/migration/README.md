# HealthCare ERP → NestJS migration

Port of the .NET HealthCare ERP API (`D:\EMSLWebMKP\FouadAlKhateeb_API_V5`) into this NestJS modular monolith,
one module at a time. Each step has its own document in this folder.

## Decisions

| Topic | Decision |
|---|---|
| Target | This repository: NestJS 12, Clean Architecture per module, CQRS, Drizzle, Zod. Same rules as [../architecture.md](../architecture.md). |
| Database | PostgreSQL. SQL Server schemas (`Admin`, `Menu`, `Identity`, …) become plain tables in `public`, snake_case. |
| API contract | **New design**, not wire-compatible. `/api/v1/...` REST routes, plain JSON bodies, RFC 9457 errors, JWT + rotating refresh token. The old `{ succeeded, messages, data }` envelope and the per-user `x-api-key` header are gone. Every step document has an old → new route table for the frontend. |
| Data | Schema and code first. SQL Server → PostgreSQL data copy (ETL) is a **later phase**; each step records the column mapping it will need. |
| Reports (RDLC, QuestPDF) | Converted **with each module** using the step 3 recipe: HTML + Chromium by default (Bangla-safe), pdfmake for small Latin-only receipts/labels, exceljs for spreadsheets. |
| gRPC (`Server.Grpc`, 41 protos) | Converted **with each module**, if a consumer still needs it; otherwise dropped and noted. |

## Conventions for every step

| Old API | New API |
|---|---|
| `AuditableEntity<TId>` (`Id`, `CreatedBy/On`, `LastModifiedBy/On`) | `id uuid`, `created_at`, `updated_at`. Who changed what goes to `audit_logs` (one row per change, in the same transaction). |
| `int` ids | `uuid` ids. The ETL keeps a mapping table per entity. GUID ids are kept as they are. |
| `Guid.Empty` / `0` meaning "none" | `null` |
| `IsDeleted` soft delete | Hard delete where nothing depends on the row. Clinical and financial records are never deleted; they get a status (cancelled/voided). Decided per module. |
| `IsSynced` | Dropped (offline sync is not part of the new API). Revisit if a sync client still exists. |
| `TenantId` (stamped `1`, query filters commented out) | Not ported yet: the old system was single-tenant in practice. Tenant profile data (name, logo, address for report headers) is ported in step 2. |
| MediatR `IRequest` + handler | `Command<T>` / `Query<T>` + `@CommandHandler` / `@QueryHandler` |
| AutoMapper profiles | Explicit mapping in read repositories (column projections) |
| Stored procedures / Dapper (`IServiceManager.*Service`) | Read repositories with Drizzle queries. Complex reports may use raw SQL inside infrastructure. |
| `[Authorize(Policy = "ApiKeyPolicy")]` (any signed-in user) | Default-deny authentication + a module permission (`pharmacy:read`, `pharmacy:manage`, …) via `@RequirePermissions` and `AccessControl.authorize()` in the handler. |
| `[MenuAccess("/page")]` | `@MenuAccess('/page')` (step 1). Use it where the old API did, on top of the permission. |
| `Result.FailAsync("message")` with HTTP 200 | Throw `DomainError` (422), `NotFoundError` (404), `ConflictError` (409), `ForbiddenError` (403) |
| `api/v1/[controller]` routes | Business modules are prefixed: `/api/v1/admin/...`, `/api/v1/locations/...`, `/api/v1/hr/...`, `/api/v1/pharmacy/...` (old names collide, e.g. Admin vs. HR `Departments`). Platform routes (`/auth`, `/users`, `/roles`, `/menus`) stay unprefixed. |
| One "AddEdit" `POST` (create when `Id` is empty) | `POST` creates, `PATCH /:id` edits the fields sent |
| Plain master tables (command + query + response + profile + controller each) | A `RecordType` + `createRecordController()` (step 2). Only tables with behaviour get aggregates and handlers. |

Each step must finish with: typecheck, lint, format, unit + architecture tests, integration and e2e tests green,
a reviewed migration in `src/database/migrations`, and its document in this folder.

## Plan and status

Order follows dependencies: later modules reference earlier ones.

| Step | Scope (old feature folders) | Status | Document |
|---|---|---|---|
| 1 | Menus, page access; identity/role mapping | **Done** | [01-menus-and-page-access.md](01-menus-and-page-access.md) |
| 2 | Admin masters (departments, service units, serve types, printers, discount categories, payment modes/channels, editor shortcuts, page controls), tenants + logos, locations, settings (AppSettings, EditorMargins); shared simple-record toolkit | **Done** | [02-admin-masters-locations-settings.md](02-admin-masters-locations-settings.md) |
| 3 | Reporting foundation: Chromium HTML→PDF + pdfmake + exceljs, report catalog in code, role grants, audited runs (replaces `Web/Report`, `ReportAndSps`, `ReportPermissions`, dynamic SP reports) | **Done** | [03-reporting-foundation.md](03-reporting-foundation.md) |
| 4a | HR: organization structure, staff records (education, contacts, festivals, photo, documents), department incharges, holidays, festivals, employee reports | **Done** | [04a-hr-staff-records.md](04a-hr-staff-records.md) |
| 4b | HR: leave types, policies, applications, multi-level approval, balances, recorded leave, leave reports | **Done** | [04b-hr-leave.md](04b-hr-leave.md) |
| 4c | HR: shift types, monthly duty roster with days off, duty exchanges, extra duties, roster report | **Done** | [04c-hr-roster.md](04c-hr-roster.md) |
| 4d | HR: attendance — device punch ingestion, manual attendance with approval, daily status, attendance reports | **Done** | [04d-hr-attendance.md](04d-hr-attendance.md) |
| 4e | HR: recruitment (job circulars, applicants, CV files), staff ID cards | **Done** | [04e-hr-recruitment.md](04e-hr-recruitment.md) |
| 5a | Payroll: salary policies, salary structure, yearly increments | **Done** | [05a-payroll-salaries.md](05a-payroll-salaries.md) |
| 5b | Payroll: monthly salary (overtime, deductions, arrears, allowances, stop/start), salary sheet, approval, payment, payslip, bank/cash statements, salary envelope `Kham` | **Done** | [05b-payroll-salary-sheet.md](05b-payroll-salary-sheet.md) |
| 5c | Payroll: festival bonus, leave encashment, PF ledger, staff dues | **Done** | [05c-payroll-bonus-ledgers.md](05c-payroll-bonus-ledgers.md) |
| 5d | Payroll: income tax (tax years and slabs, monthly deductions, certificates) | **Done** | [05d-payroll-income-tax.md](05d-payroll-income-tax.md) |
| 6a | Accounts: chart of accounts, statement heads, accounting masters | **Done** | [06a-accounts-chart.md](06a-accounts-chart.md) |
| 6b | Accounts: vouchers (double entry, numbering, attachments, reversal), GL posting, account configuration | **Done** | [06b-accounts-vouchers.md](06b-accounts-vouchers.md) |
| 6c | Accounts: ledger, sub-ledger, cash/bank book, day book, trial balance, profit and loss, balance sheet, receipts and payments | **Done** | [06c-accounts-books.md](06c-accounts-books.md) |
| 6d | Accounts: PF book (book dimension, member sub-ledgers), PF deposits and fixed deposits, PF interest distribution and settlement, TDS rules; party ledgers moved to steps 7 and 9 | **Done** | [06d-accounts-pf-book.md](06d-accounts-pf-book.md) |
| 7a | Supply chain: stores, store departments and access, item catalogue, suppliers | **Done** | [07a-scm-masters.md](07a-scm-masters.md) |
| 7b | Supply chain: purchase requisitions and approval levels, comparative studies, purchase orders | **Done** | [07b-scm-purchase.md](07b-scm-purchase.md) |
| 7c | Supply chain: stock receive, lots, stock ledger, opening stock, GRN faults, posting to accounts, supplier ledger | **Done** | [07c-scm-stock.md](07c-scm-stock.md) |
| 7d | Supply chain: store indents and approval, store requests, issues, transfers (FEFO by lot) | **Done** | [07d-scm-store-operations.md](07d-scm-store-operations.md) |
| 7e | Supply chain: department stock (consumption, returns, counts), supplier returns with debit notes, gate passes | **Done** | [07e-scm-department-returns.md](07e-scm-department-returns.md) |
| 7f | Supply chain: fixed asset register, straight-line depreciation runs with vouchers | **Done** | [07f-scm-fixed-assets.md](07f-scm-fixed-assets.md) |
| 7g | Supply chain: asset service and discard requests with approval ladders, disposal depreciation and journal, sale of written-off pieces, scrap sales, disposal invoice | **Done** | [07g-scm-asset-requests.md](07g-scm-asset-requests.md) |
| 7h | Supply chain: stock movement summary, expiring stock, stock document register, gate pass register | **Done** | [07h-scm-stock-reports.md](07h-scm-stock-reports.md) |
| 7i | Supply chain: fixed asset register, depreciation schedule, maintenance register, Code 39 asset stickers and labels | **Done** | [07i-scm-asset-reports.md](07i-scm-asset-reports.md) |
| 8a | Pharmacy: medicine catalogue (generics, formations, strengths, units, manufacturers, brands, products), outlets, outlet users, reorder levels, price list | **Done** | [08a-pharmacy-catalogue.md](08a-pharmacy-catalogue.md) |
| 8b | Pharmacy: purchase orders, stock receives by lot with posting to the supplier ledger, opening stock, outlet movement ledger, stock and stock card | **Done** | [08b-pharmacy-purchase-stock.md](08b-pharmacy-purchase-stock.md) |
| 8c | Pharmacy: supplier payments over receives, supplier returns settled by replacements; bonus units and sale price on receives | **Done** | [08c-pharmacy-supplier-payments-returns.md](08c-pharmacy-supplier-payments-returns.md) |
| 8d | Pharmacy: outlet indents, transfers between outlets (first expiring first, in transit until accepted or rejected) | **Done** | [08d-pharmacy-outlet-transfers.md](08d-pharmacy-outlet-transfers.md) |
| 8e | Pharmacy: counter sales with discount rules, loyal members, dues and collections, cancellations, receipt | **Done** | [08e-pharmacy-counter-sales.md](08e-pharmacy-counter-sales.md) |
| 8f | Pharmacy: returns from customers within the return period (refund off the due first, then cash), return receipt | **Done** | [08f-pharmacy-returns.md](08f-pharmacy-returns.md) |
| 8g | Pharmacy: physical inventory — stock counts lot by lot, applied against the ledger as of the count date, count sheet and result | **Done** | [08g-pharmacy-stock-counts.md](08g-pharmacy-stock-counts.md) |
| 8h | Pharmacy: reports — product ledger, stock movement, expiry, physical inventory summary, purchase and sales summaries, cash counter | **Done** | [08h-pharmacy-reports.md](08h-pharmacy-reports.md) |
| 8i | Pharmacy: ward indents, medicine sent to the wards for admitted patients and sent back, charged to the indoor bill; ward medicine statement | **Done** | [08i-pharmacy-ward-medicine.md](08i-pharmacy-ward-medicine.md) |
| 9a | Hospital: patient registration with UHID, duplicate check, age or birth date, photo, patient card with barcode, registration register | **Done** | [09a-hospital-patient-registration.md](09a-hospital-patient-registration.md) |
| 9b | Hospital: doctors, specialities, chamber schedules and days off, appointments by serial, doctor board, appointment list and slip | **Done** | [09b-hospital-doctors-appointments.md](09b-hospital-doctors-appointments.md) |
| 9c | Hospital: OPD consultation billing with the doctor's share, discount limit, accounts posting, due collection, cancel and refund, `UHIDUsesRecords`, receipt and collection reports | **Done** | [09c-hospital-opd-billing.md](09c-hospital-opd-billing.md) |
| 9d | Hospital: OPD and emergency services (service master with doctor share), corporate clients (credit limit, discount, collections, statement), staff billing, service income | **Done** | [09d-hospital-services-corporate.md](09d-hospital-services-corporate.md) |
| 9e | Hospital: wards, bed categories and beds, admissions (one at a time, locked beds), bed transfers through housekeeping, consultant history, discharge types, census, register, occupancy | **Done** | [09e-hospital-admissions.md](09e-hospital-admissions.md) |
| 9f | Hospital: the indoor bill: services and consultant visits charged on the wards, advances and refunds, the final bill (bed nights, admission and round fees, service charge, discount), discharge clearance, due collection, bill / receipt / collection prints | **Done** | [09f-hospital-indoor-bill.md](09f-hospital-indoor-bill.md) |
| 9g | Hospital: paying doctors their shares (OPD and indoor), corporate collections across OPD and indoor bills with the credit limit at admission, doctor ledger and payables, patient statement, dues, discounts, income by head, UHID merge | **Done** | [09g-hospital-statements.md](09g-hospital-statements.md) |
| 10a | Diagnostics: departments, tests, packages, diagnostic policy; diagnostic bills (report times, discount on what may be discounted, referral commission, test cancellation with refund, dues, corporate collection); receipt, referral commission, income by department | **Done** | [10a-diagnostic-billing.md](10a-diagnostic-billing.md) |
| 10b | Diagnostics: tests of admitted patients on the indoor bill (with the service charge); diagnostic bills in the dues, discounts, patient statement, income by head and corporate statement; diagnostic collection by user | **Done** | [10b-diagnostic-indoor-statements.md](10b-diagnostic-indoor-statements.md) |
| 10c | Lab: sample collection and lab numbers, result entry against parameters with reference ranges, pathologist verification, report printing and delivery | Next | |
| 10d | Radiology (RIS) reports, radiologists' reporting fees | Planned | |
| 10e | Reagent management (consumption per test) and transfusion medicine (donors, components, cross-matching) | Planned | |
| 11 | EMR, Rx, Nutrition, patient portal sign-in (`AnonymousUser` OTP flow) | Planned | |
| 12 | Marketing, Canteen, Others, ActivityLog | Planned | |
| 13 | Data migration (ETL) for all modules, cut-over plan | Later phase | |
