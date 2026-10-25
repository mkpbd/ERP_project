# ERP Backend

NestJS 12 modular monolith with Clean Architecture, CQRS (`@nestjs/cqrs`), PostgreSQL + Drizzle ORM,
Zod validation, JWT + rotating refresh tokens, and RBAC with fine-grained permissions.

Design and security rationale: [docs/architecture.md](docs/architecture.md).

## Requirements

* Node.js 24 LTS, npm 11
* PostgreSQL 16+ (developed and tested on 18)
* Optional: Docker + Docker Compose for the bundled dev stack

## Setup

```bash
npm ci
npx playwright install chromium-headless-shell   # once: Chromium for PDF reports
cp .env.example .env          # then edit: DATABASE_URL, TEST_DATABASE_URL, JWT_SIGNING_KEYS, ...
npm run db:migrate            # apply migrations (use a schema-owner role)
npm run start:dev             # http://localhost:3000/api/docs
```

Generate a signing secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

The app refuses to start with an invalid environment and lists the offending variables (never their values).

### Docker

```bash
docker compose up --build
```

Starts PostgreSQL (host port 55432) with separate owner/app roles, Mailpit (UI on :8025), a one-shot
`migrate` service, then the API on :3000.

## Database

| Command | Purpose |
|---|---|
| `npm run db:generate -- --name <change>` | Generate a migration from schema changes in `src/modules/*/infrastructure/persistence/*.schema.ts`. **Review the SQL before committing.** |
| `npm run db:migrate` | Apply pending migrations (dev, via tsx). Uses `MIGRATION_DATABASE_URL` if set, else `DATABASE_URL`. |
| `npm run db:migrate:prod` | Same, from the compiled build (`dist/cli/migrate.js`). |
| `npm run db:seed:dev` | Builds, then seeds development users/roles. Refuses to run in production. |
| `npm run admin:bootstrap` | Idempotently creates the first super-admin from `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` (run `npm run build` first). |

Migrations never run automatically on startup. Destructive changes need a reviewed, explicit migration.

Development seed accounts (after `npm run db:seed:dev`):

| Email | Password | Role |
|---|---|---|
| admin@example.com | Dev-Root-Passw0rd! | super-admin |
| auditor@example.com | DevUser-Passw0rd! | auditor (users:read, audit:read) |
| manager@example.com | DevUser-Passw0rd! | user-manager |
| member@example.com | DevUser-Passw0rd! | none |

## Quality checks

| Command | What runs |
|---|---|
| `npm run typecheck` | `tsc --noEmit`, strict mode |
| `npm run lint` | ESLint (type-checked rules + layer boundary rules) |
| `npm run format:check` | Prettier |
| `npm test` | Unit + architecture tests (no database needed) |
| `npm run test:int` | Integration tests against `TEST_DATABASE_URL` |
| `npm run test:e2e` | HTTP end-to-end tests against `TEST_DATABASE_URL` |
| `npm run test:all` | Everything |
| `npm run audit:deps` | `npm audit` for runtime dependencies |

**Integration and e2e tests drop and recreate the `public` schema of `TEST_DATABASE_URL`.** The test
setup refuses any database whose name does not contain `test`. Never point it at shared data.

## API overview

All routes are under `/api/v1`. Authentication is required unless marked public.

| Route | Access |
|---|---|
| `POST /auth/register` | public, rate-limited; disabled with `REGISTRATION_ENABLED=false` |
| `POST /auth/login`, `/auth/refresh` | public, rate-limited |
| `POST /auth/forgot-password`, `/auth/reset-password`, `/auth/verify-email`, `/auth/resend-verification` | public, rate-limited |
| `POST /auth/logout`, `/auth/logout-all`, `/auth/change-password` | authenticated |
| `GET /auth/sessions`, `DELETE /auth/sessions/:sessionId` | authenticated, own sessions only |
| `GET/PATCH /users/me` | authenticated |
| `GET /users` | `users:read` |
| `POST /users` | `users:create` |
| `GET/PATCH /users/:id` | self, or `users:read` / `users:update` |
| `POST /users/:id/deactivate`, `/activate` | `users:deactivate` |
| `DELETE /users/:id/sessions` | `sessions:revoke` |
| `GET /users/:id/roles`, `/users/:id/permissions` | self, or `permissions:read` |
| `POST /users/:id/roles`, `DELETE /users/:id/roles/:roleId` | `permissions:assign` + must hold every permission of the role |
| `GET /roles`, `/roles/:id`, `/roles/:id/permissions` | `roles:read` |
| `POST /roles` | `roles:create` (+ `permissions:assign` when granting) |
| `PATCH /roles/:id` / `DELETE /roles/:id` | `roles:update` / `roles:delete` |
| `POST /roles/:id/permissions`, `DELETE /roles/:id/permissions/:permission` | `permissions:assign` + must hold the permissions |
| `GET /permissions` | `permissions:read` |
| `GET /audit-logs` | `audit:read` |
| `GET /menus`, `/menus/:id` | `menus:read` |
| `POST /menus`, `PATCH/DELETE /menus/:id` | `menus:manage` |
| `GET /menus/me`, `/menus/resolve?path=` | authenticated, own navigation only |
| `GET /roles/:id/menus` / `PUT /roles/:id/menus` | `menus:read` / `menus:assign` + may only grant menus you can use |
| `/locations/{countries,divisions,districts}` | read: authenticated; write: `locations:manage` |
| `/admin/{departments,service-units,serve-types,discount-categories,printers,payment-modes,payment-channels,editor-shortcuts}`, `/admin/page-controls/{ipd-admission,investigation-entry}` | read: authenticated; write: `masters:manage` |
| `/admin/tenants`, `/admin/tenants/:id/logos/:slot` | read: authenticated; write: `tenants:manage` |
| `/admin/settings/{general,editor-margins}` | `GET`: authenticated; `PATCH`: `settings:manage` |
| `GET /reports`, `GET /reports/:key`, `POST /reports/:key/render` | authenticated; the report must be granted to one of your roles (or `reports:access-all`) |
| `GET /reports/catalog`, `GET /roles/:id/reports` / `PUT /roles/:id/reports` | `reports:read` / `reports:assign` + may only grant reports you can run |
| `/hr/{divisions,departments,sub-departments,designations,festivals,govt-holidays}` | read: authenticated; write: `hr-masters:manage` |
| `/hr/department-incharges` | read: authenticated; write: `hr:manage` |
| `GET /hr/staff`, `GET /hr/staff/:id[/photo,/documents/:documentId]` | `hr:read`, or your own linked record (`GET /hr/staff/me`) |
| `POST/PATCH /hr/staff…` (status, lists, photo, documents) | `hr:manage` |
| `POST /hr/leave/applications`, `GET …/mine`, `…/awaiting-me`, `GET /hr/leave/balance` | yourself (linked staff record) or a delegate; `leave:manage` for anyone |
| `POST /hr/leave/applications/:id/{approve,reject}` | the current level's approver, or `leave:approve-any`; never your own |
| `/hr/leave/{policies,approval-levels,delegates,records}`, `GET /hr/leave/applications` | `leave:read` / `leave:manage` |
| `GET /hr/roster/month`, `/hr/roster/me`, `/hr/roster/{shift-types,duty-exchanges,extra-duties}` | authenticated |
| `PUT /hr/roster/entries`, writes to shift types / duty exchanges / extra duties | `roster:manage` |
| `GET /hr/attendance/me`, own `GET /hr/attendance/staff/:id[/punches]` | authenticated |
| `GET /hr/attendance/daily`, anyone's `GET /hr/attendance/staff/:id[/punches]` | `attendance:read` |
| `POST/PATCH /hr/attendance/manual`, submit / cancel | `attendance:enter` |
| `POST /hr/attendance/manual/:id/{approve,reject}`, cancelling an approved entry | `attendance:approve` |
| `POST /hr/attendance/punches` (device integration) | `attendance:ingest` |
| `GET /hr/recruitment/{circulars,applications}[/:id]`, CV downloads | `recruitment:read` |
| writes to circulars / applications, CV upload and removal | `recruitment:manage` |
| `GET /health/live`, `/health/ready` | public |

Errors are RFC 9457 Problem Details:

```json
{
  "type": "urn:problem-type:validation_failed",
  "title": "Bad Request",
  "status": 400,
  "code": "validation_failed",
  "detail": "Request validation failed",
  "instance": "/api/v1/auth/register",
  "errors": [{ "path": "body", "message": "Unrecognized key: \"role\"" }],
  "requestId": "…",
  "correlationId": "…"
}
```

### Client token handling

* **Browsers**: call `/auth/login` normally. The refresh token is set as an HttpOnly cookie; read the
  `erp_csrf` cookie and send it as `X-CSRF-Token` when calling `/auth/refresh`. Keep the access
  token in memory only.
* **Mobile / server clients**: send `X-Refresh-Token-Delivery: body` on login and refresh, store the
  refresh token in the OS keystore, and post it as `{ "refreshToken": "…" }` to `/auth/refresh`.
* A refresh token works once. Replaying a used one signs that device out.

## Configuration

Every key is documented in [.env.example](.env.example). Production requires `MAIL_TRANSPORT=smtp`
and `COOKIE_SECURE=true` (enforced at startup); set `SWAGGER_ENABLED=false` unless the docs should be public.
