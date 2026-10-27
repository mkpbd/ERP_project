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
| `GET /payroll/salaries/me` | authenticated (own) |
| `GET /payroll/salaries`, anyone's salary, `GET /payroll/increments[/candidates]` | `payroll:read` |
| salary policies / review cycles (write), `PUT/PATCH /payroll/salaries/:staffId`, increments apply / commit / reverse | `payroll:manage` |
| `GET /payroll/salary-sheets/:y/:m/payslips/me` | authenticated (own) |
| monthly inputs (`/payroll/{overtimes,deductions,punishments,arrears,allowance-payments,salary-payments,salary-stops}`) read, salary sheet preview / saved, anyone's payslip | `payroll:read` |
| monthly inputs (write; frozen once the month is committed), salary sheet approve / commit | `payroll:manage` |
| `GET /payroll/statements/{pf,dues}`, `GET /payroll/pf/settlement` (own) | authenticated |
| festival bonuses and their sheets, leave encashments, PF ledger, staff dues, anyone's statements and PF settlement, PF interest preview | `payroll:read` |
| the same (write), bonus approve / commit / reverse, encashment save / remove, `POST /payroll/pf/interest` | `payroll:manage` |
| `GET /payroll/tax-years`, own `GET /payroll/tax-certificates/:taxYearId` | authenticated |
| `GET /payroll/income-tax/:y/:m`, anyone's certificate | `payroll:read` |
| tax years (write), income tax compute / hand entries | `payroll:manage` |
| `GET /accounts/chart`, accounting masters, PF deposits / fixed deposits, TDS rules (read) | `accounts:read` |
| accounting masters (write) | `accounts:manage` |
| `GET /accounts/vouchers[/:id]` | `accounts:read` |
| draft vouchers and attachments | `vouchers:write` |
| post / reverse vouchers | `vouchers:post` |
| `GET /accounts/books/*`, `GET /accounts/statements/*` | `accounts:read` |
| `GET /scm/*` (stores, store access, item catalogue, suppliers) | `scm:read` |
| the same (write), purchase and comparative study approval levels | `scm:manage` |
| `GET /scm/{purchase-requisitions,comparative-studies,purchase-orders}[/:id]` | `scm:read` |
| raise, edit, submit, cancel requisitions, studies and orders; close part-received orders | `scm:purchase` |
| `GET /scm/stock`, `/scm/stock/card`, `/scm/stock-receives[/:id]`, GRN faults (read) | `scm:read` |
| stock receives (draft, edit, post, delete), GRN faults (write) | `scm:receive` |
| `POST /scm/opening-stock` | `scm:manage` |
| `GET /scm/{store-indents,store-requests,store-issues,stock-transfers}[/:id]`, indent shortfall | `scm:read` |
| store indents (draft, edit, submit, cancel), store requests | `scm:indent` (+ department access) |
| `POST /scm/store-indents/:id/decision` | the indent approval level's role |
| `POST /scm/store-indents/:id/acknowledge` | the person who raised the indent |
| issues, transfers, accepting transfers, receiving department returns, gate passes | `scm:issue` (+ store access) |
| department consumption, returns and counts | `scm:department` (+ department access) |
| approving or rejecting department counts | `scm:adjust` (not the counter) |
| supplier returns (draft, send, settle) | `scm:receive` |
| `GET /scm/fixed-assets[/:id]`, `GET /scm/depreciation-runs[/:id]` | `scm:read` |
| describe pieces, configure depreciation, preview, post and reverse runs | `scm:assets` |
| `GET /scm/{asset-service-requests,asset-discard-requests,scrap-sales}[/:id]` | `scm:read` |
| raise service and discard requests and scrap sales, receive from service, sell written-off pieces | `scm:assets` |
| `POST /scm/{asset-service-requests,asset-discard-requests,scrap-sales}/:id/decision` | the asset approval level's role (not the raiser) |
| `GET /pharmacy/*` (catalogue, outlets, outlet users, reorder levels) | `pharmacy:read` |
| set up the medicine catalogue, outlets, outlet users and reorder levels; opening stock | `pharmacy:manage` |
| medicine purchase orders (raise, edit, cancel, close) | `pharmacy:purchase` |
| medicine receives (draft, edit, post, delete) and supplier returns (draft, send, settle, close) | `pharmacy:receive` + works at the outlet (or `pharmacy:manage`) |
| supplier payments | `pharmacy:payment` |
| outlet indents (raise, edit, cancel, close) and transfers (send, accept, reject) | `pharmacy:transfer` + works at the outlet concerned |
| counter sales and returns; collecting loyal member dues | `pharmacy:sell` (+ works at the outlet for sales and returns) |
| ward indents for admitted patients (raise, cancel); seeing ward indents and issues | `pharmacy:ward` (or `pharmacy:read` to see) |
| medicine sent to a ward and sent back; cancelling a ward indent at the outlet | `pharmacy:sell` + works at the outlet |
| return periods | `pharmacy:manage` |
| stock counts (open, count, add a lot found, cancel) | `pharmacy:count` + works at the outlet |
| applying a stock count (someone other than who opened it) | `pharmacy:manage` |
| discount policy and product discounts, loyal members, cancelling sales (sellers: their own the same day) | `pharmacy:manage` |
| `GET /hospital/patients/*` (search, view, matches, photo) | `patient:read` |
| registering patients, changing their details and photos | `patient:register` |
| taking a patient record out of use and back; merging a duplicate into the record kept | `patient:manage` |
| `GET` doctors, specialities, schedules, days off, appointments and the doctor board | `opd:read` |
| doctors, specialities, chamber schedules and days off | `opd:manage` |
| booking appointments; arrival, no-show, cancellation, attaching the patient | `opd:book` |
| OPD consultation bills, due collections, cancelling a bill on its own day | `opd:bill` |
| a consultation discount above the counter's limit | `opd:discount` |
| the OPD policy (follow-up days, default doctor share, counter discount limit); cancelling a bill later | `opd:manage` |
| service groups, services (rate, doctor share) and corporate clients (cash or credit, limit, discount) | `opd:manage` |
| a corporate client's payment against its OPD and indoor bills (oldest first) | `opd:bill` |
| paying a doctor their shares | `doctor:pay` |
| `GET` diagnostic departments, tests, packages, the diagnostic policy and diagnostic bills | `diag:read` |
| diagnostic departments, tests, packages and their tests, the diagnostic policy; cancelling tests after the bill's day | `diag:manage` |
| diagnostic bills (an admitted patient's charged to the stay), collecting their dues, cancelling tests on the bill's day | `diag:bill` |
| a diagnostic discount above the counter's limit | `diag:discount` |
| `GET` a doctor's ledger (shares earned, taken back, paid) | `opd:read` |
| `GET` admissions, the bed board, wards, bed categories and beds | `ipd:read` |
| admitting (with an advance), moving beds, changing doctors, discharging on the day of the final bill; making a bed ready | `ipd:admit` |
| wards, bed categories and beds; cancelling an admission; taking a bed out of order | `ipd:manage` |
| `GET` an admission's account (the bill so far), indoor bills and the indoor policy | `ipd:read` |
| charging services and consultant visits on the wards, advances and refunds, the final bill, collecting its due, cancelling it on its own day | `ipd:bill` |
| a final bill discount above the counter's limit | `ipd:discount` |
| the indoor policy (round fee, service charge, counter discount limit); cancelling a final bill later; discharging a patient who still owes | `ipd:manage` |
| `POST /scm/purchase-requisitions/:id/decision` | the approval level's role |
| `POST /scm/comparative-studies/:id/decision` | the approval level's staff member |
| `GET /scm/{purchase-requisitions,comparative-studies,asset-service-requests,asset-discard-requests,scrap-sales}/inbox` | signed in |
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
