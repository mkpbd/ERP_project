# Step 7h — Supply chain: stock reports and registers

Status: **done** (2026-10-26). Previous: [step 7g](07g-scm-asset-requests.md) · Next: [step 7i](07i-scm-asset-reports.md) (asset reports).

Step 7h is split in two: the stock reports and registers here, the fixed-asset reports (register, depreciation
schedule, maintenance register, labels) in **7i**.

## Where the old logic lives

CoxBazar `Components/Pages/SupplyChain`: `DeptStockReportsPage` (tabs Summary, Movement, Valuation, Ledger,
Expiry & Batch, Low / Out of Stock, Issues, Returns, Consumption, Pending), the receive, issue and transfer
dashboards and `GatePassRegisterPage`. They were screens over separate queries per tab and store kind; the
prints were tables of whatever the grid showed.

Already covered by earlier steps: the stock statement with lots and below-reorder items (`scm.stock`, old Summary,
Valuation and Low / Out of Stock), the stock card (`scm.stock-card`, old Ledger) and every document print.

## New reports

All read the one stock ledger (`stock_movements`), so a main store, a sub-store and a department are reported the
same way. Every report has a PDF (HTML engine, Bangla-safe) and an Excel layout.

| Key | Title | Parameters | What it shows |
|---|---|---|---|
| `scm.stock-movement` | Stock movement summary | one place, `from`, `to`, `groupId?` | Per item: opening stock before `from`, what came in and went out in the period, closing stock, each in quantity and value; totals; and the period by kind of movement (receive, issue, transfer, consumption, return, adjustment, write-off, service…) and direction. Landscape. |
| `scm.expiry` | Expiring stock | place (optional: every place), `asOf` (default today in the organisation's time zone), `withinDays` (0–3650, default 90), `includeExpired` (default yes) | Lots in stock expiring by `asOf + withinDays`, earliest first, with place, batch, days left (expired marked), quantity and value; the value already expired and the total. |
| `scm.movement-register` | Stock document register | place (optional), `kind?`, `from`, `to` | One line per stock document and place: date, number, kind, place, items, quantity in / out, value in / out. A transfer shows twice without a place filter: out of one place, into the other. Replaces the receive, issue and transfer dashboards' prints. |
| `scm.gate-pass-register` | Gate pass register | `kind?`, `from`, `to` | Every gate pass: number, date, kind, party, reference (supplier return, service request…), note. |

A period with its start after its end is 422 `invalid_period`; the stock movement summary needs exactly one place
(422 `invalid_store`).

Who may run a report is granted per role in the reporting module, as for every report.

## Not ported (open questions)

1. "Pending" tab (indents and requests not yet issued): the inboxes and lists filtered by status already show
   them. Is a print needed?
2. "Consumption", "Issues", "Returns" tabs: the document register filtered by kind gives the documents; is an
   item-by-item consumption analysis per department (e.g. monthly consumption per item) wanted?
3. "Auto consumption" dashboard depends on the pharmacy and billing link (steps 8 and 9).

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 267 passed; `npm run test:int`: 16 passed
* `npm run test:e2e`: 97 passed — new `test/e2e/scm-stock-reports.e2e-spec.ts` reads the Excel output of each
  report: opening 29 / out 6 / closing 23 (2,720 → 2,120) for the main store, in and out again through the ward,
  one place required; expired lot −10 days, expired lots left out on request, lots by expiry across places and in
  one department; five register lines for an opening, a transfer and an issue, transfers only, the gate pass and
  an empty kind filter. Each report also renders as PDF.
* All four PDFs checked visually (Bangla item and party names, landscape movement summary)
* Dev server restarted; readiness 200
