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
| Reports (RDLC) | Converted **with each module**. The rendering approach is decided in the step that first needs it (see the plan). |
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

Each step must finish with: typecheck, lint, format, unit + architecture tests, integration and e2e tests green,
a reviewed migration in `src/database/migrations`, and its document in this folder.

## Plan and status

Order follows dependencies: later modules reference earlier ones.

| Step | Scope (old feature folders) | Status | Document |
|---|---|---|---|
| 1 | Menus, page access; identity/role mapping | **Done** | [01-menus-and-page-access.md](01-menus-and-page-access.md) |
| 2 | Admin masters (Country, ServiceUnit, ServeType, Printer, DiscountCategory, PaymentMode/Channel, Editor*, page controls), Tenants, Location, SuperAdmin settings (AppSetting, AccountConfiguration) | Next | |
| 3 | Reporting foundation: replacement for RDLC (`Web/Report`, `ReportAndSp`, `ReportPermission`, `DynamicReportQuery`) | Planned | |
| 4 | HR (staff records, departments, designations), Attendance | Planned | |
| 5 | Payroll, PFBook, TDS/VAT/TAX | Planned | |
| 6 | Account (GL, vouchers) + SuperAdmin GL mappings | Planned | |
| 7 | SupplyChain (store, purchase, indents) | Planned | |
| 8 | Pharmacy | Planned | |
| 9 | Hospital (registration, billing, IPD), OPD | Planned | |
| 10 | Diagnosis, RIS, ReAgentManagement, TransfusionMedicine, lab reports | Planned | |
| 11 | EMR, Rx, Nutrition, patient portal sign-in (`AnonymousUser` OTP flow) | Planned | |
| 12 | Marketing, Canteen, Others, ActivityLog | Planned | |
| 13 | Data migration (ETL) for all modules, cut-over plan | Later phase | |
