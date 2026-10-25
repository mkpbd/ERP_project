# Architecture and security decisions

## Shape: modular monolith, Clean Architecture inside each module

One deployable NestJS process. Business capabilities live in `src/modules/*`; each module owns its
domain, use cases, persistence and HTTP surface.

```text
src/
├── main.ts / app.module.ts      composition root (the only place that wires modules together)
├── bootstrap/configure-app.ts   HTTP pipeline shared by main.ts and the e2e tests
├── cli/                         migrate, bootstrap-admin, seed-dev (compiled with the app)
├── config/                      Zod-validated environment → typed AppConfig
├── database/                    pg pool, Drizzle instance, AsyncLocalStorage transactions, migrations
├── shared/
│   ├── domain/                  AggregateRoot, AppError hierarchy (no framework imports)
│   ├── application/             ports (TransactionManager, Clock, AuditTrail, NotificationQueue),
│   │                            cross-module contracts (AccessControl, UserDirectory), pagination
│   ├── infrastructure/          RequestContext (ALS), pg error helpers
│   └── presentation/            decorators, Zod DTO + validation pipe, Problem Details filter
└── modules/
    ├── identity/        users, credentials, sessions, refresh/reset/verification tokens
    ├── access-control/  roles, permissions, assignments, the authorization policy
    ├── audit/           audit trail writer + query API
    ├── notifications/   transactional outbox + mail transports
    ├── navigation/      menu tree, role menu grants, page-level access (@MenuAccess)
    ├── location/        countries, divisions, districts (simple records)
    ├── administration/  admin masters, tenants + logos, settings documents, OrganizationProfile
    ├── reporting/       report catalog, role grants, PDF (Chromium / pdfmake) and Excel rendering
    └── health/          liveness/readiness
```

Each business module is split into:

| Layer | Contains | May depend on |
|---|---|---|
| `domain/` | aggregates (`User`, `Role`, `Session`), value objects, invariants, domain events, repository interfaces | own domain, `shared/domain` — **nothing else, no npm packages** |
| `application/` | commands/queries + handlers, application services, ports, read-model interfaces | domain, shared application ports/contracts, `@nestjs/cqrs`/`@nestjs/common` for DI decorators |
| `infrastructure/` | Drizzle schemas & repositories, argon2, JWT (jose), outbox, SMTP | everything inward |
| `presentation/` | controllers, Zod DTOs, guards | application commands/queries, shared presentation |

### Deviation from the suggested layout

The brief suggested separate `users`, `roles` and `permissions` modules. They were merged into
`identity` (users + authentication share the `User` aggregate) and `access-control` (roles,
permissions and assignments form one consistency boundary). Splitting them would have forced two
modules to share one aggregate or one table, which breaks the ownership rule. `notifications` was
added to own the outbox.

### Module communication

Modules never import each other. Cross-module needs go through abstract contracts in
`shared/application/contracts`, implemented by the owning module and provided globally:

* `AccessControl` (access-control) — profile lookup, `authorize()`, last-super-admin guard, admin bootstrap.
* `UserDirectory` (identity) — read-only user summaries for other modules.

The one sanctioned exception: a module's Drizzle schema (`*.schema.ts`) may reference another module's
tables for foreign keys (`access-control` → `users`, `navigation` → `roles`, `users`). All modules live in
one database, and FK integrity is worth more than the purity. Nothing else may cross module lines.

The HealthCare ERP port adds modules step by step; see [migration/README.md](migration/README.md).

### Enforcement

* `test/architecture/boundaries.spec.ts` parses every import in `src/` and fails on: domain importing
  anything outside its domain, application importing infrastructure/presentation/Drizzle/pg,
  presentation importing repositories/DB, module-to-module imports, the shared kernel importing a
  module, Drizzle outside infrastructure, and controllers injecting anything but the buses.
* ESLint `no-restricted-imports` repeats the domain/application rules at edit time.

## CQRS and the mediator

`@nestjs/cqrs` is the mediator. Controllers only call `CommandBus.execute` / `QueryBus.execute`.
Commands extend `Command<TResult>` and queries `Query<TResult>`, so results are typed end to end.

* **Commands** mutate state inside an explicit `TransactionManager.run()` unit of work and record
  an audit entry in the same transaction.
* **Queries** use dedicated read repositories with column projections (`UserReadRepository`,
  `AccessReadRepository`, `AuditLogReadRepository`) — never the aggregates, never secret columns.
* **Domain events** are collected on aggregates and published on the `EventBus` **after commit**.
  The in-process bus is not durable; nothing that must survive a crash relies on it. Current uses:
  permission-cache invalidation and security-alert logging (lockout, refresh-token reuse).
* **Durable side effects** (emails) use the transactional outbox: rows are written in the business
  transaction; `OutboxDispatcher` polls with `FOR UPDATE SKIP LOCKED`, delivers at-least-once with
  exponential backoff, and scrubs the payload (which may contain a single-use link) after delivery.

### Simple records (master data)

Lookup tables with no behaviour beyond validation and constraints (departments, districts, payment
modes, …) do not get an aggregate, commands and handlers each. A module declares a `RecordType`
(name, read permission or `null` for any signed-in user, manage permission, store) and registers it in
the shared `RecordTypeRegistry` on module init. Generic handlers in `shared/application/record.handlers.ts`
authorize, run the write in a transaction and audit `<name>.created|updated|deleted`.
`DrizzleRecordStore` maps unique violations to 409, missing references to 404 and deleting a referenced
row (`23503`/`23001`) to 409 `<name>_in_use`. `createRecordController()` builds the
`GET / GET :id / POST / PATCH :id / DELETE :id` controller from Zod DTOs; it applies the same parameter
metadata a hand-written controller would, so validation and OpenAPI work unchanged. As soon as a table
needs rules of its own, it gets a regular aggregate and handlers.

### Reports

A report is code in the module that owns its data: `defineReport({ key, params: zodSchema, load, pdf, xlsx })`,
registered in the shared `ReportRegistry`. The reporting module checks the grant (`role_reports` or
`reports:access-all`), validates the parameters with the report's schema, loads, renders and audits
`report.rendered`. HTML layouts render in a shared headless Chromium with JavaScript disabled and all network
requests aborted; pdfmake may read only its bundled fonts. Templates are Handlebars (escaped by default).
The letterhead comes from the `OrganizationProfile` contract. See
[migration/03-reporting-foundation.md](migration/03-reporting-foundation.md).

### Transactions

`DrizzleTransactionManager` stores the open transaction in `AsyncLocalStorage`; repositories ask
`DbContext.db` for the current executor, so they join the ambient transaction without passing it
around. Nested `run()` calls join the outer transaction. `lock(name)` takes a
`pg_advisory_xact_lock`, used to serialize super-admin changes, admin bootstrap and catalog sync.
Row-level `SELECT … FOR UPDATE` protects aggregate updates; `users.version` adds optimistic
concurrency.

## Authentication

| Concern | Decision |
|---|---|
| Password hashing | argon2id, m=19 MiB, t=2, p=1 (OWASP baseline). Hashes are upgraded on login when parameters change. |
| Password policy | 12–128 code points, must not contain the email/local part/username, not trivially repetitive (NIST 800-63B style; no composition rules). |
| Access token | HS256 JWT, 15 min default, `typ: at+jwt`, claims `sub`, `sid`, `iss`, `aud`, `iat`, `exp`, `jti`. No personal data. |
| Key rotation | `JWT_SIGNING_KEYS=kid:secret,...`; first key signs, all verify, chosen by `kid`. |
| Server-side revocation | Every request checks the session (`sid`) is unrevoked, unexpired and its user active — one indexed join. Logout, logout-all, password change/reset and deactivation take effect immediately, not at token expiry. |
| Refresh token | 256-bit random opaque token; only its SHA-256 is stored. Rotated on every use with an atomic conditional `UPDATE … WHERE used_at IS NULL`. |
| Reuse detection | Presenting an already-used refresh token revokes the whole session (token family), audits `auth.refresh_token_reuse` and raises a security alert. Two truly simultaneous refreshes with the same token are treated the same way (strict policy). |
| Browser transport | Refresh token in `HttpOnly; SameSite=Strict; Path=/api/v1/auth` cookie (`__Secure-` prefixed when `COOKIE_SECURE`). Refreshing via cookie requires the double-submit CSRF token (`erp_csrf` cookie echoed in `X-CSRF-Token`). |
| Non-browser transport | Send `X-Refresh-Token-Delivery: body`; the refresh token is returned in JSON and must be sent back in the request body. Store it in the platform keystore (iOS Keychain / Android Keystore), never in plain preferences or logs. |
| Enumeration resistance | Login: unknown, locked and wrong-password attempts return the same 401 body and do the same argon2 work. Register / forgot-password / resend-verification always return the same 202; an existing account owner gets an "account exists" email instead. |
| Lockout | After `LOGIN_MAX_FAILED_ATTEMPTS` wrong passwords the account is locked for `LOGIN_LOCKOUT_SECONDS` (row-locked update, so parallel guesses cannot race the counter). Plus per-IP rate limiting. |
| Email links | Tokens travel in the URL fragment (`/reset-password#token=…`), which browsers never send to servers, proxies or `Referer`. Reset and verification tokens are single-use and expire. |
| MFA | Extension point only: `users.mfa_enabled` exists and login refuses such accounts with `mfa_required`. No second-factor flow is implemented. |

## Authorization

* **Default deny for authentication**: `AuthenticationGuard` is global; only `@Public()` routes skip it.
* **Route permissions**: `@RequirePermissions('users:read')` / `@Roles(...)`, enforced by the global
  `AuthorizationGuard`. Denials are audited (`authz.denied`).
* **Page access**: `@MenuAccess('/page')`, enforced by the global `MenuAccessGuard` after the permission
  check: the page's menu must be active and held by one of the caller's roles (`menus:access-all` skips the
  grant, never the active check). See [migration/01-menus-and-page-access.md](migration/01-menus-and-page-access.md).
* **Use-case permissions**: handlers call `AccessControl.authorize()` again, so use cases are safe
  even when invoked outside HTTP (CLI, future jobs).
* **Resource level**: `authorize(userId, { permissions, ownerId })` — owners may act on their own
  resources (profile, own permissions); others need the permission. Another user's session is
  reported as 404 to avoid disclosing it.
* **Explicit grants only**: the policy has no wildcard and no role-name bypass. `super-admin` is a
  system role that is *explicitly granted every catalog permission* by the catalog sync, and is
  immutable through the API.
* **Privilege escalation**: assigning or revoking a role, creating a role with permissions,
  granting/revoking role permissions and deleting a role all require the actor to hold every
  permission involved (`assertCanDelegate`). These checks bypass the profile cache.
* **Last super-admin**: demotion or deactivation that would leave no active super-admin is
  refused, under an advisory lock so concurrent requests cannot both succeed (integration-tested).
* **Permission catalog**: defined in code (`permission-catalog.ts`), synced idempotently at startup;
  stale permissions are not deleted automatically.
* **Cache**: authorization profiles are cached per process for `PERMISSION_CACHE_TTL` seconds and
  invalidated by events when assignments change. **With several instances, other instances see a
  change only after the TTL.** Set `PERMISSION_CACHE_TTL=0` or add a shared invalidation channel
  (e.g. Redis pub/sub) before scaling out.
* **Tenancy**: the system is single-tenant. A tenant/facility column, tenant-scoped repository
  queries and membership checks in `AccessControl` are required before multi-tenant use.

## HTTP, validation and errors

* URI versioning: `/api/v1/...`. Swagger UI at `/api/docs`, JSON at `/api/docs/openapi.json`.
* Every body/query/param is a Zod DTO (`createZodDto`). Bodies use `z.strictObject`, so unknown
  fields are rejected (mass-assignment protection). Query strings ignore unknown keys.
* OpenAPI component schemas are generated from the same Zod schemas (`z.toJSONSchema`, OpenAPI 3.0
  target), so docs cannot drift from validation.
* Domain rules (password policy, email format) live in the domain only; DTOs enforce transport
  bounds. Database constraints are the final integrity boundary (lower-case email, status enum,
  hash formats, names).
* Errors are RFC 9457 Problem Details (`application/problem+json`) with a stable `code`,
  `requestId` and `correlationId`. 5xx responses never include internal messages.

## Operations

* **Logging**: Pino via `nestjs-pino`, JSON, request id + correlation id on every line; the
  `Authorization`, `Cookie`, `Set-Cookie` and `X-CSRF-Token` headers and any `password`/`token`
  fields are redacted; query strings are not logged.
* **Request context**: `X-Request-Id` / `X-Correlation-Id` are accepted if well-formed, otherwise
  generated, echoed in responses and stored on audit rows.
* **Security headers**: Helmet defaults; explicit CORS allowlist with credentials; 100 kB JSON limit;
  `x-powered-by` off; `trust proxy` only when `TRUST_PROXY=true`.
* **Rate limiting**: `@nestjs/throttler`, per-IP; a stricter bucket (`AUTH_RATE_LIMIT_LIMIT`) for
  credential and token routes. Storage is in-memory — use a shared store before scaling out.
* **Database roles**: run migrations as a schema owner and the app as a DML-only role
  (`docker/postgres/init-roles.sql`; verified locally — the app works and cannot run DDL).
* **Shutdown**: shutdown hooks close the pg pool and stop the outbox poller.
* **Not included (by decision)**: BullMQ/Redis (no workload needs a queue yet; the outbox covers
  email), OpenTelemetry (no collector in scope; add `@opentelemetry/sdk-node` in `main.ts` when one exists).

## Regulated deployments

Healthcare or similar deployments need tenant/facility isolation, read-access auditing (today only
security-relevant changes and denials are audited), data retention policies and a review against
the applicable regulations. These technical controls alone do not constitute compliance.
