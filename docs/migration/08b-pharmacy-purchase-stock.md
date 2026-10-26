# Step 8b — Pharmacy: purchase orders, stock receives, opening stock, outlet stock

Status: **done** (2026-10-26). Previous: [step 8a](08a-pharmacy-catalogue.md) · Next: [step 8c](08c-pharmacy-supplier-payments-returns.md) (supplier payments
and returns; it also answers the questions below: bonus units yes, sale price from the receive yes, no order approval).

## Where the old logic lives

CoxBazar `Features/Pharmacy`: `AddEditPurchaseOrderCommand` / `AddEditPurchaseOrderDetailCommand`,
`AddEditStockReceiveCommand`, `AddEditStockReceiveDetailCommand`, `AddEditLotRecordsCommand`,
`AddEditRceivePurchOrderCommand`, `Stocks/Commands/UpdateStockOnPurchaseCommand`,
`CheckStockEntryDuplicateChallanNoAndInvoiceNoCommand`; prints `PrintPurchaseOrderDocument`, `PrintOrderDocument`,
`PrintPharmacyStockReceiveDataDocument`.

What the old receive did, and what changes:

* The receive header, each line, the lot, the stock row and its "flow" were saved by **separate commands, each
  with its own commit**, called one after another by the page. A failure part way left a receive without stock or
  stock without a receive. Now the receive is a draft, and **posting** does everything in one transaction.
* A stock row was keyed by **product, expiry and outlet** only: a second receive with the same expiry but another
  batch or price was added to the first row and **kept the first receive's rates**. Now a **lot** is a product,
  batch, expiry and sale rate, and every movement carries its own unit cost.
* The pharmacy **posted nothing to accounts** and kept its own supplier ledger table. Now posting a receive posts
  **Dr `pharmacy_inventory` / Cr the supplier's payable** (its GL account, else the `supplier_payable` role) **on
  its party sub-ledger**, so the supplier ledger is the sub-ledger in accounts, as for the supply chain (step 7c).
  The suppliers are the supply chain's, read through a published `SupplierDirectory` contract.
* The product's purchase price became the last rate typed (kept: the posted purchase rate).

## Model

| New table | Old table | Notes |
|---|---|---|
| `pharmacy_purchase_orders`, `_lines` | `PurchaseOrders`, `PurchaseOrderDetails` | `PO-<year>-<serial>`; supplier, outlet, date, note; one line per product in whole units, with the quantity received. Status `open` → `partly_received` → `received`, or `closed` (partly received, with a reason) or `cancelled` (nothing received, with a reason). |
| `pharmacy_receives`, `_lines` | `StockReceives`, `StockReceiveDetails`, `RceivePurchOrders` | `GR-<year>-<serial>`; outlet, supplier, optional order, date, supplier invoice (unique per supplier, ignoring case) and its date (not after the receive), challan, remarks; lines with product, units, purchase rate per unit (4 decimals), sale rate per unit, discount % and VAT % of the amount, batch, expiry; amounts to the paisa. `draft` or `posted`, with the voucher number. |
| `pharmacy_lots` | `LotRecords` + lot columns of `Stocks` | Product, batch (case ignored), expiry (required), sale rate. |
| `pharmacy_movements` | `Stocks.AvailableStock` + `StockFlows` | The outlet movement ledger: outlet, product, lot, units (+ in, − out), unit cost, date, kind (`opening`, `receive` so far), document. **Stock is the sum.** |
| `pharmacy_openings` | — | `OP-<year>-<serial>`: opening stock entered for an outlet. |
| `pharmacy_sequences` | — | Document serials per kind and year. |

## Rules

* **Receive.** Draft, edit and delete a draft; post once (409 `stale_pharmacy_receive` on an old version, 422
  `pharmacy_receive_state` afterwards). Posting checks: active products (422 `inactive_product`), no lot expired by
  the receive date (422 `expired_lot`), the order is the same supplier and outlet (422 `order_mismatch`), still
  open or partly received (422 `purchase_order_state`) and **not received beyond what was ordered** (422
  `over_receipt`). One line per product, batch, expiry and sale rate (422 `duplicate_line`); whole units (422
  `invalid_quantity`).
* **Unit cost** of a lot movement = the line total (amount − discount + VAT) ÷ units, to 4 decimals.
* **Outlet access.** Receives are drafted, edited, posted and deleted only at an outlet the user works at
  (`pharmacy_outlet_users`, 403 `no_outlet_access`); `pharmacy:manage` overrides.
* **Opening stock** (`pharmacy:manage`): lines with units, unit cost, sale rate, batch and expiry (not expired by
  the opening date), into lots; not posted to accounts (the opening balances are entered there).
* **Stock** reads the ledger: per product its units, value at cost, value at the lots' sale rates, the outlet's
  reorder level and whether it is at or below it; lots by expiry. `belowReorderOnly` lists the products at or below
  their level, including those with nothing left. The **stock card** shows a product's movements at an outlet with
  the running balance.

## Endpoints (under `/api/v1/pharmacy`)

| Method and path | Permission |
|---|---|
| `GET purchase-orders` (`status`, `from`, `to`, `outletId`, `supplierId`, `q`, paged), `GET purchase-orders/:id` | `pharmacy:read` |
| `POST purchase-orders`, `PATCH purchase-orders/:id`, `POST purchase-orders/:id/cancel`, `POST purchase-orders/:id/close` | `pharmacy:purchase` |
| `GET receives` (`status`, `from`, `to`, `outletId`, `supplierId`, `q` number / invoice / challan, paged), `GET receives/:id` | `pharmacy:read` |
| `POST receives`, `PATCH receives/:id`, `POST receives/:id/post`, `DELETE receives/:id?version=` | `pharmacy:receive` + works at the outlet |
| `POST opening-stock` | `pharmacy:manage` |
| `GET stock?outletId=` (`productId`, `q`, `belowReorderOnly`, `asOf`), `GET stock/card?outletId=&productId=&from=&to=` | `pharmacy:read` |

## Reports

| Key | Old print | Contents |
|---|---|---|
| `pharmacy.purchase-order` | `PrintPurchaseOrderDocument` | Order header, products with ordered and received units, status and reason |
| `pharmacy.receive` | `PrintPharmacyStockReceiveDataDocument` | Receive header (invoice, challan, order, voucher), lines with batch, expiry, purchase and sale rate, discount, VAT, totals, amount in words (landscape) |
| `pharmacy.stock` | outlet current stock | Stock by product and lot, at cost and at sale rate, reorder flags; Excel too |

## Old → new routes

| Old | New |
|---|---|
| `AddEditPurchaseOrderCommand`, `AddEditPurchaseOrderDetailCommand`, `GetPurchaseOrderBy…`, `GetNewPurchaseOrderNoQuery` | `/pharmacy/purchase-orders` |
| `AddEditStockReceiveCommand`, `AddEditStockReceiveDetailCommand`, `AddEditLotRecordsCommand`, `AddEditRceivePurchOrderCommand`, `UpdateStockOnPurchaseCommand`, `GetPharmacyStockReceiveByDateQuery`, `GetStockReceiveDataByIdQuery` | `/pharmacy/receives` (draft → post) |
| `CheckStockEntryDuplicateChallanNoAndInvoiceNoCommand` | unique supplier invoice per supplier (409 `supplier_invoice_taken`) |
| `AddEditSupplierLegerCommand` (on receive) | the supplier's sub-ledger in accounts |
| `GetStockByOutletIdQuery`, `GetOutletBrandAndStockByOutletIdQuery`, `GetBrandAndStockWithRolListByOutletIdQuery` | `GET /pharmacy/stock` |
| `GetSpGetProductLedgerByDatesAndOutletQuery` | `GET /pharmacy/stock/card` |

## Plan for the rest of step 8 (revised)

| Step | Content |
|---|---|
| 8c | Supplier payments against receives (payment voucher on the supplier's sub-ledger, receipt) and supplier returns (out of stock, debit note, replacement) |
| 8d | Outlet indents and transfers between outlets, with acceptance |
| 8e | Counter sales: invoices, discount rules, loyal members, payments and dues, cancellations, expiry guard |
| 8f | Returns from patients, with the return window |
| 8g | Indoor patients (after step 9's admissions) |
| 8h | Physical inventory and stock audit |
| 8i | Reports |

## Open questions

1. Should a receive be allowed **free (bonus) units** at no cost, as many suppliers give? The old receive had none.
2. Should the sale rate of a product follow the latest receive (old `BrandExtension.SalePrice`), or stay as entered
   in the catalogue? Now the lot carries its own sale rate and the catalogue price is left alone.
3. Is a purchase order approval needed (the old one had none)?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean; architecture test passes (pharmacy reads
  suppliers through `SupplierDirectory`, not the supply chain tables)
* Migration `0025_pharmacy_purchase_stock`: 8 tables
* `npm test`: 274 passed — new `test/unit/pharmacy/purchase.spec.ts` (orders received up to what was ordered,
  closed or cancelled with a reason only when allowed, whole units, one line per product; receive arithmetic with
  4-decimal rates, same lot refused, other sale rate is another lot, expired and inactive refused, posted is
  final). It found that cancelling or closing with an empty reason left the order marked cancelled; fixed.
* `npm run test:int`: 16 passed (migration count 26, new tables)
* `npm run test:e2e`: 102 passed — new `test/e2e/pharmacy-purchase.e2e-spec.ts` (order and edit; receive refused at
  an outlet the user does not work at, without the permission, against another outlet's order; amounts 1,440 −
  27 + 18 = 1,431; nothing in stock until posted; voucher on inventory and the supplier ledger; stock at cost and
  sale rate; purchase price updated; order partly received; over-receipt refused; supplier invoice once per
  supplier; cancel refused, close accepted, closed order refuses receives; prints and stock in Excel; lots by
  batch ignoring case and by sale rate; expired lot refused; opening stock sharing the lot; stock card; products to
  reorder)
* Purchase order, receive and stock prints checked visually (Bangla product name)
* Dev server restarted; no duplicate Swagger schema names; readiness 200
