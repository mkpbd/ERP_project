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
| 8 | Pharmacy | Next | |
| 9 | Hospital (registration, billing, IPD), OPD, `UHIDUsesRecords`, consultant and IPD patient ledgers, due collection | Planned | |
| 10 | Diagnosis, RIS, ReAgentManagement, TransfusionMedicine, lab reports | Planned | |
| 11 | EMR, Rx, Nutrition, patient portal sign-in (`AnonymousUser` OTP flow) | Planned | |
| 12 | Marketing, Canteen, Others, ActivityLog | Planned | |
| 13 | Data migration (ETL) for all modules, cut-over plan | Later phase | |
