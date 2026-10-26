# Step 8h — Pharmacy: reports

Status: **done** (2026-10-26). Previous: [step 8g](08g-pharmacy-stock-counts.md) · Next: step 9 (hospital;
indoor pharmacy patients follow as step 8i once admissions exist).

## Where the old logic lives

* **MIS report screen.** Most pharmacy reports ran through one screen: `Pages/Report/MISPharmacyReports.razor`.
  * The screen sent a 21-slot comma-separated filter to `DynamicReportController.GetPharmacyReport`.
  * That controller picked the stored procedure and RDLC layout from the `SuperAdmin.ReportAndSps` table (group
    `PHARMACY`).
  * About fifteen of those procedures exist only in the live database.
* **Product ledger:** `ProductLedgerPage` + `SpGetProductLedger` + `PrintProductLedgerDocument`.
* **Expiry lists:** `PrintExpireProductDocument` and `PrintUpCommingExpireProductDocument`.
* **Physical inventory report:** `PharmacyPhysicalInventoryReportPage` + `spGetPharmacyPhysicalInventoryReport`,
  with a PDF and an Excel export.

Every report here comes as PDF and Excel. Each needs `reports:read` and is assigned to roles like any other report.
The figures come from the movement ledger and the documents themselves. The old reports used nightly snapshots and
patch scripts instead.

## Reports

| Key | Old report | What it shows |
|---|---|---|
| `pharmacy.product-ledger` | Product Ledger | One product at an outlet over a period: the opening (the ledger before the period), every movement by lot with document, batch, expiry, in, out, running stock and value at cost, the closing, and the period by kind of movement. The closing is always what the ledger holds, so the old "stock flow adjustment" line is gone. |
| `pharmacy.stock-movement` | Pharmacy Current Stock Report, Formation Wise Stock Report | Per product over a period: opening; purchased (receives, opening stock, replacements), transferred in, returned by customers (returns and cancelled sales), count gain; sold, transferred out, returned to supplier, count loss (including write-offs); closing. Opening and closing at cost, grouped by `manufacturer` (default), `formation` or `generic`. |
| `pharmacy.expiry` | Expired products, upcoming expiry, MIS Expired Product Statement | Lots held (one outlet or all) that are expired or expire within `days` (default 90, up to 365) of today: expired, within 30 days, later. Days left, quantity, value at cost and at the lot's sale rate. |
| `pharmacy.physical-inventory` | Physical Inventory Report | Up to six applied counts side by side. For each: lots and products counted, the stock held at cost, then equal, over, short, written off and expired still on the shelf (lots, value, % of the stock held), the net deviation, and the lots most short (`top`, default 5). A count that is not applied is refused (422 `stock_count_state`). |
| `pharmacy.purchase-summary` | Pharmacy Purchase Summary, Purchase Summary Date Wise | Posted receives over a period per supplier: receives, amount, discount, VAT, total, paid against them by the end of the period, due, and goods sent back in the period. `detail` lists each receive with its invoice and challan. Filters: outlet, supplier. |
| `pharmacy.sales-summary` | Sale Report Summary Date Wise, Outlet / Supplier Wise Sale, Sale Summary With Profit, Product Wise Return Statement | Completed sales by `day` (default), `product`, `manufacturer` or `seller`: bills, units, gross, discount, net; units and value brought back in the period; net of returns; cost; margin and margin %. Unlike the old reports, **returns are taken off**. Margin % is shown only when net sales are positive. |
| `pharmacy.cash-counter` | Userwise Collection Summary, cash counter | Per user over a period, by cash, card and mobile wallet: taken on sales and on loyal member dues, less paid back on returns and on cancelled sales, giving **what each counter hands over**. Also sales value, discount, due given and due taken off by returns. Filters: outlet, user. |

## How the figures are taken

* **Dates:** a movement counts on its own date. A sale counts on the day it was sold, a return on the day it came
  back, a collection on the day it was collected. A cancelled sale is left out of the sales summary.
* **Cash counter:** each amount goes to whoever took or paid it. A sale goes to its seller, a cancellation to whoever
  cancelled it, a return to whoever took it back, and a collection to whoever collected it. A collection that settles
  sales of several outlets counts for each outlet by what it paid on that outlet's sales.
* **Cost:** units at the cost each lot left at. Returns take their cost back.
* **Paid against a receive:** the supplier payment lines on it dated up to the end of the period.

## Not ported

These old reports are left out:

* **Category Wise Stock Report:** outlet names were hard-coded into its columns.
* **Sales Basket:** bill value bands.
* **Patient Wise Product Sales:** comes with indoor patients (step 8i).
* **Corporate client reports:** there are no corporate clients in the new system yet.
* **Manual Stock Adjustment Report:** stock counts replace manual adjustments.

The pharmacy management dashboard comes with the dashboards of a later step.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* `npm test`: 299 passed
* `npm run test:int`: 16 passed
* `npm run test:e2e`: 116 passed. The new `test/e2e/pharmacy-reports.e2e-spec.ts` builds an April of one outlet:
  * opening stock with an expired lot;
  * a receive of 280 with 100 paid;
  * a cash sale, a card sale and a loyal member's sale with a due collected later;
  * a manager's sale cancelled the same day;
  * a return.

  Every figure is checked from the Excel output, and every PDF is rendered:
  * **Product ledger:** 10 → 92 by lot.
  * **Stock movement:** Napa 10 + 100 + 7 − 25 = 92 at 72.60; Seclo 48 at 192.00.
  * **Expiry:** the expired lot X and lot A expiring in 20 days; Seclo, expiring in 400 days, is not listed.
  * **Purchase summary:** 280 / 100 / 180.
  * **Sales by day:** 36.00 gross, 1.20 discount, 34.80 net, 24.00 cost on the 10th; a returns-only day with no
    margin %.
  * **Sales by product:** Napa 20.52 net of returns, 6.12 margin.
  * **Cash counter:** the seller hands over 20.52 in cash and 12.00 by card; the manager's cancelled sale nets to 0.
  * **Physical inventory:** a count with an expired lot written off (7.00, 2.65 %) and one short (1.60, 0.6 %), net
    −8.60.
* All seven reports checked visually
* Dev server restarted; readiness 200
