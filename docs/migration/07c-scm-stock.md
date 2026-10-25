# Step 7c — Supply chain: stock receive, lots, stock ledger, posting to accounts

Status: **done** (2026-10-26). Previous: [step 7b](07b-scm-purchase.md) · Next: step 7d (store operations).

## Where the old logic lives

The CoxBazar "Stock record" page (`AddEditStockReceivePage.razor.cs`) does the work: it loads the order's
pending lines, works out the amounts, saves the receive and its lines, finds or creates a lot per line, writes
`SupplierLedgers` rows, updates the order status, syncs the item's purchase price and, when integrated accounts
are on, posts a journal voucher. Stock itself is never stored: `FnGetBrandExtensionCurrentStock` and the
stock procedures add up receives, transfers, issues and returns each time.

## Model

| New | Old | Notes |
|---|---|---|
| `stock_receives`, `stock_receive_lines` | `StockReceives`, `StockReceiveDetails` | Number `SR-<year>-<serial>` (old `spGetNextIndentNo`). |
| `stock_lots` | `LotRecords` | One lot per **variant**, batch (ignoring case) and expiry date. The old lots were shared by every product with the same batch and expiry text, written in three date formats. |
| `stock_movements` | — | Every quantity into or out of a store (main store or sub-store), by lot, with its unit cost, date, kind and document. Stock is the sum. Steps 7d and later add transfers, issues and returns as further kinds. |
| `stock_openings` | `BrandExtensions.OpeningQty` / `OpeningDate` | Opening stock per store, lot and cost (`OS-<year>-<serial>`). |
| `grn_faults` | `GRNs`, `GRNFaultDescriptions` | Faults noted on items of a purchase order (not cancelled). As before, they do not change stock. |

## Stock receive

* Header: main store, supplier (active), optional purchase order (open or partly received, same supplier and
  main store; otherwise 422 `wrong_supplier`, `wrong_main_store`, `purchase_order_state`), receive date,
  supplier's invoice number and date, challan number, remarks. A supplier's invoice number and challan number
  are each used once (409 `supplier_invoice_taken`, `supplier_challan_taken`, ignoring case; the old check
  looked at the challan only when there was no invoice, across all suppliers).
* Lines: variant, quantity, rate, discount %, VAT %, AIT %, batch, expiry date, warranty note. An item may be on
  several lines in different lots.
* Amounts (old formula, now to the paisa): amount = rate × quantity; discount, VAT and AIT are each that
  share of the amount (VAT before the discount); total = amount − discount + VAT + AIT. The header adds them up.
* `draft` (edited and deleted freely) → `posted` (final). Posting:
  1. checks every item is active, has an expiry date where the item needs one (the old page checked only lines
     typed in by hand), and that no lot has expired by the receive date (422 `inactive_item`,
     `expiry_required`, `expired_lot`);
  2. adds the quantities to the purchase order, never beyond what is still to come (422
     `receive_exceeds_order`; the old page capped it only when a line was edited); the order becomes
     `partially_received` or `received`;
  3. posts the purchase to accounts (when the total is above zero), see below;
  4. puts each line into stock in its lot at unit cost = line total ÷ quantity (VAT and AIT included, as the
     old voucher did);
  5. sets each item's purchase price to the received rate (old `SyncBrandExtensionPurchasePrice`).
* A posted receive is not changed; goods going back are supplier returns (step 7d).

### Posting to accounts

One journal voucher (`JV`) per receive, source `scm` / receive id, dated the receive date:

| Debit | Credit |
|---|---|
| Each item type's inventory account (`items.type_gl_account_id`, old `ItemTypeId`), else the GL role `store_inventory` (old `StoreInventoryGeneralLedgerId`) — the lines' totals | The supplier's payable account (`suppliers.gl_account_id`), else the GL role `supplier_payable` (old `PayableToSupplierGeneralLedgerId`), on the supplier's **sub-ledger** — the receive total |

The voucher number is kept on the receive. The **supplier ledger** is the supplier's sub-ledger in accounts
(`GET /accounts/books/ledger?subLedgerId=`, step 6c): receives credit it, payment vouchers debit it, so
advances and payments need no separate SCM table. To post, accounts need an open fiscal year for the date,
journal type `JV`, and the two GL roles (or accounts on the items and suppliers); the supplier needs a
sub-ledger when the payable account is a control account.

`LedgerPosting` lines may now name an account by id as well as by code or role.

Old behaviour not carried over: the voucher was looked up by supplier id, so after a supplier's first receive
every later one took a broken update path; a new supplier sub-ledger was created on every receive; the paid
amount and AIT never reached the supplier ledger; the ledger balance ran within one receive only.

## Opening stock

`POST /scm/opening-stock` (`scm:manage`): a main store **or** a sub-store, date, note, lines (variant, quantity,
unit cost, batch, expiry; expiry required where the item needs one). It goes straight into stock; the
accounts' opening balances are entered in accounts.

## Purchase orders

`POST /scm/purchase-orders/:id/close` `{ version, reason }` (`scm:purchase`): stop waiting for the rest of a
partly received order (the old receive page checked for "Closed" statuses nothing ever wrote).

## Reading stock

| Endpoint (`scm:read`) | Returns |
|---|---|
| `GET /scm/stock?mainStoreId=` or `?subStoreId=` (`variantId`, `groupId`, `q`, `asOf`, `belowReorderOnly`, `includeEmpty`) | per item: quantity, value (each lot at its cost), reorder level and flag, lots with batch, expiry, quantity and value (earliest expiry first) |
| `GET /scm/stock/card?mainStoreId=\|subStoreId=&variantId=&from=&to=` | opening, each movement (date, document, kind, lot, in, out, running balance), totals, closing |
| `GET /scm/stock-receives` (`status`, `from`, `to`, `q` number / invoice / challan, `mainStoreId`, `supplierId`, paged), `GET /scm/stock-receives/:id` | receives with amounts and voucher number |

Writes: `POST /scm/stock-receives`, `PATCH :id`, `POST :id/post`, `DELETE :id?version=` (`scm:receive`);
`/scm/grn-faults` records (read `scm:read`, write `scm:receive`).

Reports: `scm.stock-receive` (goods received note with lots and total in words), `scm.stock` (stock statement,
optionally with lots, Excel too), `scm.stock-card`.

## Old → new routes

| Old | New |
|---|---|
| `SStockReceive` (add/edit, by dates / id), `SpGetSCMPurchaseDetailsByReceiveId` | `/scm/stock-receives` |
| `GetReceivedQtyByPoQuery`, `SetPurchaseOrderStatusCommand` | the order's `receivedQty` and status, kept by posting |
| `AddEditSCMStockRecieveDetail` lot lookup | `stock_lots`, found or created on posting |
| `AddEditSupplyChainSupplierLeger`, `GetStockReceivePaidAmountQuery` | the supplier's sub-ledger in accounts |
| `PurchaseOrderAdvance`, `MarkPoAdvanceAdjusted` | a payment voucher on the supplier's sub-ledger |
| `SP_SET_SupplyChain_Opening_Stock` | `POST /scm/opening-stock` |
| `GRN`, `GRNFaultDescription`, `SpGRNDetailWithPODetailByGRNId` | `/scm/grn-faults?purchaseOrderId=` |
| `SpGetBrandExtensionCurrentStock*`, `FnGetBrandExtensionCurrentStock`, `GetBrandExtensionRole` (ROL list) | `GET /scm/stock` (`belowReorderOnly`) |
| `SpGetSCMStockReport*`, `spGetItemStockReportDateWiseSummary` | report `scm.stock`, `GET /scm/stock/card`; the date-wise summary comes with the reports in 7f |
| SCM drafts (`SCMDraft`) | a draft receive |

## Open questions

1. Should AIT be withheld from the supplier (credited to a tax payable account) instead of added to the cost,
   as the old receive did?
2. Should a posted receive be reversible (stock out, voucher reversed) while nothing of it has moved on, or
   always go through a supplier return?
3. Stock value uses each lot's own cost. Is a moving average cost wanted for issues instead?
4. Is cash paid at receipt (the old "paid amount") still needed on the receive, or is a payment voucher enough?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* Migration `0018_scm_stock`: 6 tables
* `npm test`: 239 passed — new `test/unit/supply-chain/stock.spec.ts` (receive arithmetic to the paisa,
  header totals and trimmed numbers, same item in two lots, posting checks for inactive item, expired lot and
  missing expiry, quantities per item, voucher lines by item type and role with the supplier's sub-ledger,
  partial receipts up to the order, short close)
* `npm run test:int`: 16 passed (migration count 19, new tables)
* `npm run test:e2e`: 87 passed — new `test/e2e/scm-stock.e2e-spec.ts` (receive against an order with wrong
  supplier, missing expiry, posting with voucher number, order partly then fully received, item price synced,
  stock by lot with value and reorder flag, supplier sub-ledger and item-type inventory balances, over-receipt,
  duplicate invoice, same lot reused, posted receive not deleted, permissions; opening stock in a sub-store,
  one store only, expiry required, reorder list, GRN faults on and off the order, short close and late receive,
  stock card, bad period, unknown store; all three reports)
* Visual check of the goods received note (Bangla supplier name, lakh grouping, total in words) and the stock
  statement with lots; dev server restarted with the new routes mapped
