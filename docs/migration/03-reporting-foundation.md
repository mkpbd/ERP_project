# Step 3 — Reporting foundation

Status: **done** (2026-10-25). Previous: [step 2](02-admin-masters-locations-settings.md) · Next: step 4 (HR).

This step builds the machinery that replaces the old report service. The ~500 individual reports are ported
with their modules (decision: "reports per module"), using the recipe at the end of this document.

## What the old system had

| Piece | Where | What it did |
|---|---|---|
| Report service | `src/Web/Report` (separate ASP.NET app) | One controller method per report: gather data via MediatR, set RDLC parameters, render, return the file base64-encoded inside `{ succeeded, data }` |
| RDLC templates | `Web/Report/wwwroot/Reports/**` — **259** `.rdlc` + 45 dataset `.xsd` | `ReportViewerCore` (`LocalReport.Render("pdf"/"excel")`) |
| Code-built PDFs | `Server.Api/PDF/**` (127 classes), `Web/Report/PDF/**` (120) | QuestPDF documents: receipts, invoices, labels, prescriptions |
| Excel | ClosedXML | Some exports |
| Barcodes | Neodynamic SDK | Labels, tokens |
| Dynamic reports | `DynamicReportController.GetReport/GetSCMReport/GetReportData` | Client sends base64 JSON with `SPName`, `CSV`, `FolderName`, `RdlcReportName`; the server **executes that stored procedure** and renders that file |
| Catalog | `SuperAdmin.ReportAndSps` (+ `ReportGroups`) | Report name, procedure name, group, RDLC folder/file, PDF vs RDLC |
| Permissions | `SuperAdmin.ReportPermissions` | Role → report; `SP_UserReportList` returns the user's reports (including procedure and file names) |
| Letterhead | every report | `Tenants[0]` (or the tenant id in the CSV): `Company`, `Address`, `HotLine`, `Image` (logo base64) |

## Security issues found in the old report service

From reading the code; **not tested against a running instance**. If the old system is live, these are urgent.

1. **No authentication at all.** `Web/Report/Program.cs` registers no authentication scheme, and its
   `BaseApiController` has no `[Authorize]` (unlike the main API's). Every report endpoint is anonymous.
2. **Any stored procedure can be executed by anyone.** `GET api/v1/DynamicReport/print/GetReportData?parameter=…`
   decodes a client JSON with `SPName` and runs it via Dapper (`CommandType.StoredProcedure`, 1200 s timeout),
   returning the result as JSON. The name is not checked against `ReportAndSps` or `ReportPermissions`. Combined
   with (1), an anonymous caller can read any data a procedure exposes (patients, finance) and run any procedure
   that modifies data.
3. **Client-chosen file paths.** `FolderName` and `RdlcReportName` from the client are concatenated into a disk
   path (`{WebRoot}\Reports\{FolderName}\{RdlcReportName}`) and opened.
4. **Errors are hidden**: the handlers catch every exception and return HTTP 200 with an empty body.

The new design makes all four impossible: reports are code (no procedure or file names cross the wire), every
endpoint requires authentication, running a report requires a grant, and failures are Problem Details.

## Decisions

| Topic | Decision |
|---|---|
| PDF engine (default) | **HTML + Handlebars → headless Chromium** (Playwright). Correct Bangla shaping (verified: conjuncts such as ক্ষ, ক্স), CSS layout, repeating table headers, page numbers. |
| PDF engine (small documents) | **pdfmake** for receipts/labels/short lists in Latin script — no browser. It cannot shape Bangla; use HTML for anything with Bangla. |
| Excel | **exceljs**: one sheet with a banner (organization, title, filters, who/when), typed columns (money, dates in the report time zone), frozen header, auto-filter. |
| Where reports live | In the module that owns the data (`<module>/infrastructure/reports/*.report.ts` + `.hbs`), registered in the shared `ReportRegistry`. |
| Who may run what | Role grants (`role_reports`, the old `ReportPermissions`) or the `reports:access-all` permission. |
| Auditing | Every run is audited (`report.rendered`, report key, format): reports are bulk data exports. |

Versions (pinned, each released ≥ 2 weeks before adoption): `playwright@1.64.0`, `pdfmake@0.3.11`,
`handlebars@4.7.10`, `exceljs@4.4.0`. `exceljs` pulls `uuid@<11.1.1` (GHSA-w5hq-g745-h8pq; exceljs only uses
`v4`, which is not affected); `package.json` overrides it to `uuid@11.1.1` — `npm audit --omit=dev` is clean.

## What was built

### Shared contracts (`src/shared/application/reports.ts`)

```ts
defineReport({
  key: 'location.districts',                   // <module>.<report>
  title: 'Districts by division',
  group: 'Location',                           // menu group (old GroupName)
  description: '…',
  params: z.strictObject({ divisionId: z.uuid().optional() }),
  load: (params, context) => /* Drizzle query */,
  describe: (params, rows) => 'All divisions', // filter line under the title
  pdf: { engine: 'html', template: fileURLToPath(new URL('./districts.hbs', import.meta.url)) },
  // or: pdf: { engine: 'pdfmake', document: (rows, context) => ({ content: [...] }) },
  xlsx: (rows) => ({ columns: [{ key: 'district', header: 'District' }, …], rows }),
});
```

`OrganizationProfile` (`src/shared/application/contracts/organization-profile.ts`) gives every report its
letterhead; the administration module implements it from the first tenant and its primary logo.

### Module `src/modules/reporting`

| Part | File |
|---|---|
| Catalog, grants, render command (validate params → load → render → audit) | `application/reporting.handlers.ts` |
| Who may run what | `application/report-access.service.ts` |
| Chromium renderer: one shared browser, launched on first use, `REPORT_RENDER_CONCURRENCY` pages at a time, **JavaScript off, every network request aborted**, 30 s timeout, footer "Printed by … on … / Page x of y" | `infrastructure/rendering/chromium-pdf.renderer.ts` |
| Handlebars engine (isolated instance, HTML-escaped by default, cached templates) and the letterhead layout | `infrastructure/rendering/template-engine.ts`, `templates/layout.hbs` |
| Template helpers: `date`, `datetime` (report time zone), `money` (lakh grouping, `1,23,456.50`), `integer`, `amountInWords` (port of the old `NumberToWords`: thousand/lakh/crore, "… Only."), `inc`, `eq` | `infrastructure/rendering/formatting.ts` |
| pdfmake renderer: Roboto fonts, letterhead, footer; **may read only its own font files and fetch nothing** (images must be `data:` URIs) | `infrastructure/rendering/pdfmake.renderer.ts` |
| Excel renderer | `infrastructure/rendering/xlsx.renderer.ts` |

### Table (migration `0003_reporting.sql`)

| Table | From | Notes |
|---|---|---|
| `role_reports` | `SuperAdmin.ReportPermissions` | `(role_id, report_key)`; FK to `roles` (cascade); key format checked. Grants for keys no longer in code are ignored and dropped on the next edit. |

`ReportAndSps` and `ReportGroups` have no table: the catalog is the code.

### Permissions

| Key | Allows |
|---|---|
| `reports:read` | See the whole catalog and each role's reports |
| `reports:assign` | Replace a role's reports — only reports the actor can run, unless they hold `reports:access-all` |
| `reports:access-all` | Run every report without a grant (the dev/bootstrapped super-admin has it) |

### Endpoints

| Method and path | Access | Purpose |
|---|---|---|
| `GET /api/v1/reports` | signed in | Reports you can run |
| `GET /api/v1/reports/catalog` | `reports:read` | All reports |
| `GET /api/v1/reports/:key` | runnable by you | Details + **JSON Schema of the parameters** (build the filter form from it) |
| `POST /api/v1/reports/:key/render` | runnable by you | Body `{ "format": "pdf" \| "xlsx", "params": { … } }` → the file (`Content-Disposition: attachment`) |
| `GET /api/v1/roles/:id/reports` | `reports:read` | A role's report keys |
| `PUT /api/v1/roles/:id/reports` | `reports:assign` | Replace a role's report keys |

Errors: unknown report 404 `report_not_found`; not granted 403 `report_not_granted`; wrong format 422
`report_format_unsupported`; invalid parameters 400 with `errors[].path` like `body.params.divisionId`.

### Configuration

| Variable | Default | Meaning |
|---|---|---|
| `REPORT_TIME_ZONE` | `Asia/Dhaka` | Dates on reports and in file names |
| `REPORT_RENDER_CONCURRENCY` | `2` | Parallel Chromium pages (each ~50–150 MB) |
| `CHROMIUM_EXECUTABLE_PATH` | — | Use a system Chromium instead of Playwright's |

Local development: `npx playwright install chromium-headless-shell` once. The Dockerfile installs Chromium
(`playwright install --with-deps chromium-headless-shell`) and `fonts-noto-core` (includes Noto Sans Bengali)
in the runtime image — **not built in this step** (Docker was not available); build it before relying on it.

### Reference reports

| Key | Engine | Shows |
|---|---|---|
| `location.districts` | HTML/Chromium + Excel | Bangla column (`name_bn`), filter by division |
| `admin.service-units` | pdfmake + Excel | Latin-only list, filter by department |

## Recipe: porting an old report (later steps)

1. Find the report in `ReportAndSps` (live DB) or the controller method in `Web/Report/Controllers/v1/Reports/*`
   / `Server.Api/Controllers/v1/Reports/*`.
2. **Data**: port the stored procedure (`database/StoredProcedures.sql`) or MediatR queries to a Drizzle query
   in `load()`. Parameters that came in the CSV string (`FromDate,ToDate,Year,Month,UserId,TenantId,…`) become
   named, typed fields in the Zod `params` schema.
3. **Layout**: RDLC → `.hbs` next to the report (tables use `class="report"`; the letterhead, title, filters and
   footer come from the layout). QuestPDF documents → pdfmake if Latin-only and small (receipts, labels),
   otherwise `.hbs`. RDLC "excel" renders → `xlsx()`.
4. Old RDLC parameters `Company/Address/HotLine/Image` → nothing to do (letterhead); `PrintedBy` → footer;
   `ReportName` → `title`; `FromDate/ToDate/Month/Year` → `describe()`; amount in words → `{{amountInWords total}}`.
5. Register in the module's `onModuleInit` (`this.reports.register(...)`), add a unit or e2e test that renders it.
6. The ETL (step 13) maps `ReportPermissions` rows to `role_reports` keys through a table
   `ReportAndSps.Id → report key` maintained in that step's document.

## Deferred

* **Barcodes / QR**: pdfmake has QR codes built in; 1D barcodes (Code 128 for sample labels) are added with the
  first report that needs them (Diagnosis, step 10), e.g. with `bwip-js` rendering SVG/PNG data URIs.
* Very large reports (tens of thousands of rows): streaming Excel and background generation with a download
  link, when a module needs it.
* The old `GetFinancialDashboard*` / management dashboards are data endpoints, not documents: step 6.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean; `npm audit --omit=dev`: 0 vulnerabilities
* `npm test`: 147 passed — new `test/unit/reporting/rendering.spec.ts` (amount in words, lakh money format,
  time zones, Handlebars escaping of `<img onerror>`, layout, pdfmake rendering and its file/URL refusal),
  `test/unit/reporting/handlers.spec.ts` (registry rules, file names, grants, parameter validation, audit,
  delegation)
* `npm run test:int`: 16 passed (migration set now 4)
* `npm run test:e2e`: 44 passed — new `test/e2e/reports.e2e-spec.ts` renders real PDFs through Chromium and
  pdfmake and an Excel file (read back with exceljs, Bangla text included), checks validation, 403/404 and grants
* Visual check: the HTML layout rendered in Chromium print mode with Bangla district names (correct shaping)
* Dev server restarted (template assets are copied to `dist`); `/reports`, PDF and Excel render work
