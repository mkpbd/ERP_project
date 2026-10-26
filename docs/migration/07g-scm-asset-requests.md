# Step 7g — Supply chain: asset service and discard requests, disposal journal, scrap sales

Status: **done** (2026-10-26). Previous: [step 7f](07f-scm-fixed-assets.md) · Next: [step 7h](07h-scm-stock-reports.md) (supply chain
reports).

## Where the old logic lives

CoxBazar `Features/SupplyChain`: warranty and maintenance (`SaveWarrantyMaintenanceIndentCommand`,
`ApproveWarrantyMaintenanceIndentCommand`, `SendAssetToMaintenanceCommand`, `ReceiveAssetFromMaintenanceCommand`),
asset discard (`SaveAssetDiscardIndentCommand`, `ApproveAssetDiscardIndentCommand`, `ServeAssetDiscardIndentCommand`,
`DiscardAssetCommand`, `SellDiscardedAssetCommand`), manual discard requisitions (`SaveManualDiscardRequisitionCommand`
and its approvals) and the print `PrintDiscardSoldInvoiceDocument`. Each had its own approval setting table.

## Approval ladders

One record type, `scm/asset-approval-levels` (`flow` = `service`, `discard`, `discard_sale` or `scrap_sale`,
`levelOrder`, `name`, `roleId`), replaces the three old approval setting tables. A document is decided level by level by a holder of
that level's role; whoever raised it cannot approve it (403 `self_approval`), anyone else gets 403 `not_approver`.
A flow with no levels cannot be raised (422 `no_approval_levels`). Every decision carries the document `version`
(409 `stale_*`). An approver may drop pieces (`rejectAssets`) and keep the rest; dropping all of them is 422
`nothing_approved` (reject instead). The decisions are kept, in order, as the document's history, each with its
`stage` (`request`, or `sale` for the sale of a discard request).

Each piece can be on one open request at a time (409 `asset_busy`) and must be in stock (422 `asset_state`).
A rejection, or a dropped piece, frees it.

## Service requests (`/scm/asset-service-requests`, `AS-<year>-<serial>`)

* Header: who it goes to (`sentTo`) and, when the vendor is a supplier, `supplierId` (its ledger is billed).
* Lines: piece, `warranty` or `maintenance`, problem, expected cost (warranty is always 0).
* The **last approval sends the pieces out of stock**: a stock movement `service_out` from where each piece is (its
  lot, at its cost), status `out_for_service`, and a gate pass of kind `maintenance` (`GP-<year>-<serial>`, from
  step 7e) to the party it was sent to. The old flow had a separate "send" step after approval. The piece keeps
  its place, so it comes back to the same store or department; transfers and issues do not move it while away.
* No voucher on the way out: the asset is still owned, so the inventory account keeps it and it **keeps being
  depreciated**. While pieces are out, the store's stock value is below the inventory account by their cost.
* `POST :id/receive { version, assetIds, costs[], on }`: pieces back into stock (`service_return`, same lot and
  cost). `costs` gives what each maintenance actually cost (the expected cost when left out; a warranty repair
  costs nothing, 422 `warranty_cost`). The total is booked **Dr `asset_maintenance_expense` / Cr the vendor's
  payable** (the supplier's GL account or the `supplier_payable` role, on its sub-ledger) or, without a supplier,
  **Cr `maintenance_payable`**. Each line keeps its actual cost and voucher number. The request is closed when all
  are back.

## Discard requests (`/scm/asset-discard-requests`, `AD-<year>-<serial>`)

The **last approval writes the pieces off** on the decision date `on`, in one transaction:

1. Stock out of each piece from where it is (movement kind `discard`, expired lots included).
2. Depreciation closed to the disposal date: what was due, plus the current period by days, in a run of kind
   `disposal` with its voucher **Dr `depreciation_expense` / Cr `accumulated_depreciation`**. Disposal runs are
   never the "latest run" that can be reversed.
3. The disposal journal: **Dr `accumulated_depreciation`** (what the pieces carry), **Dr `asset_disposal_loss`**
   (the book value), **Cr inventory** at cost (the item type's GL account, otherwise the `store_inventory` role).
4. Pieces `discarded`, with their book value on the request.

**The sale has its own ladder** (`discard_sale`):

* `POST :id/sell { version, soldTo, buyerSupplierId, on, amounts[] }` proposes it (not before the discard date):
  status `sale_pending`, waiting at the first `discard_sale` level. Whoever proposed it cannot approve it.
* `POST :id/decision` then decides the sale. A rejection puts the request back to `discarded` (the pieces stay
  written off) and the sale may be proposed again.
* The last level gives the invoice number `DIS-<year>-<serial>`, marks the pieces with an amount `sold`, and books
  **Dr the buyer's party ledger** (when `buyerSupplierId` is a supplier: its GL account or `supplier_payable`, on
  its sub-ledger) **or `cash_in_hand`**, **Cr `asset_disposal_gain`**.

The old discard approved, then "served", then discarded in separate screens, posted nothing to accounts and left
depreciation running.

## Scrap sales (`/scm/scrap-sales`, `SS-<year>-<serial>`)

Old "manual discard requisition": free-text lines (description, unit, quantity, rate) for scrap that is not a
registered asset, totals to the paisa. The last approval gives the invoice number (same `DIS` series) and posts
**Dr the buyer's party ledger (optional `buyerSupplierId`, as for a discard sale) or `cash_in_hand` / Cr
`scrap_sale_income`**. No stock is touched.

## Report

`scm.disposal-invoice` (`kind` = `discard` or `scrap_sale`, `id`): "Invoice of material disposed of and sold" —
invoice number, buyer, reference, lines, total and the amount in words (old `PrintDiscardSoldInvoiceDocument`).
422 `not_sold` before there is an invoice.

## Endpoints (under `/api/v1/scm`)

| Method and path | Permission |
|---|---|
| `GET {asset-service-requests,asset-discard-requests,scrap-sales}[/:id]` (`status`, paged) | `scm:read` |
| `GET .../inbox` — pending at a level of one of your roles | signed in |
| `POST asset-service-requests`, `POST asset-discard-requests`, `POST scrap-sales` | `scm:assets` |
| `POST .../:id/decision { version, decision, remarks, rejectAssets, on }` | the level's role, not the raiser (of a sale: not who proposed it) |
| `POST asset-service-requests/:id/receive`, `POST asset-discard-requests/:id/sell` | `scm:assets` |
| `scm/asset-approval-levels` (record type) | `scm:read` / `scm:manage` |

## Old → new routes

| Old | New |
|---|---|
| Warranty / maintenance / asset discard / manual discard approval settings | `scm/asset-approval-levels` by `flow` |
| `SaveWarrantyMaintenanceIndentCommand`, indents list, for-approval list | `POST`/`GET /scm/asset-service-requests`, `inbox` |
| `Approve…`/`Reject…WarrantyMaintenanceIndentCommand`, `SendAssetToMaintenanceCommand` | `POST :id/decision` (last level sends out with a gate pass) |
| `ReceiveAssetFromMaintenanceCommand`, `RequestWarrantyMaintenanceReceiveCommand` | `POST :id/receive` |
| `SaveAssetDiscardIndentCommand`, approve, reject, `ServeAssetDiscardIndentCommand`, `DiscardAssetCommand` | `POST /scm/asset-discard-requests`, `POST :id/decision` |
| `SellDiscardedAssetCommand` | `POST /scm/asset-discard-requests/:id/sell`, then `:id/decision` on the `discard_sale` ladder |
| `SaveManualDiscardRequisitionCommand` and its approvals | `/scm/scrap-sales` |
| `PrintDiscardSoldInvoiceDocument` | report `scm.disposal-invoice` |
| `GetWarrantyMaintenanceDashboardQuery`, `GetAssetMaintenancesQuery` | step 7h reports |

## Decisions taken

* Maintenance cost is booked when the pieces come back, at the actual cost, Dr expense / Cr the vendor's payable.
* A piece out for service leaves the store's stock and keeps being depreciated.
* The sale of written-off pieces is approved on its own ladder, and goes to the buyer's party ledger when the
  buyer is a supplier (scrap sales too).

## Open questions

1. Should receiving pieces back from service need its own approval (old `RequestWarrantyMaintenanceReceive`)?
2. Buyers who are not suppliers (individual scrap dealers) are cash sales; should there be a customer/party master
   for them, or does that wait for the billing party ledgers (step 9)?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* Migrations `0022_scm_asset_requests` (8 tables, `depreciation_runs.kind`, movement kind `discard`) and
  `0023_scm_asset_service_stock_and_sale_ladder` (movement kinds `service_out`/`service_return`, vendor and actual
  cost on service requests, `discard_sale` ladder, buyer party, decisions ordered with their stage — existing
  decisions numbered in date order)
* `npm test`: 267 passed — new `test/unit/supply-chain/asset-requests.spec.ts` (ladder, dropped pieces, receive
  back with actual or expected cost, warranty at no cost, sale ladder with rejection and a second offer, decision
  stages, scrap totals) and disposal charges by days in `depreciation.spec.ts`
* `npm run test:int`: 16 passed (migration count 24, new tables)
* `npm run test:e2e`: 94 passed — new `test/e2e/scm-asset-requests.e2e-spec.ts` (service request with gate pass,
  busy piece refused, inbox, wrong approver 403, stock out while away and back on receive, warranty cost refused,
  maintenance booked on the vendor's supplier ledger; discard with book values, disposal run and journal,
  accumulated depreciation closed, loss posted, stock reduced; sale proposed, refused by the wrong role, rejected,
  proposed again and approved with `DIS` invoice on the buyer's party ledger; scrap sale with invoice, cash and
  income; both invoices rendered as PDF)
* Disposal invoice checked visually (discard sale and scrap sale, Bangla buyer name, amount in words)
* Dev server restarted with the new routes mapped; readiness 200
