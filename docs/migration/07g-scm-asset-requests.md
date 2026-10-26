# Step 7g — Supply chain: asset service and discard requests, disposal journal, scrap sales

Status: **done** (2026-10-26). Previous: [step 7f](07f-scm-fixed-assets.md) · Next: step 7h (supply chain
reports).

## Where the old logic lives

CoxBazar `Features/SupplyChain`: warranty and maintenance (`SaveWarrantyMaintenanceIndentCommand`,
`ApproveWarrantyMaintenanceIndentCommand`, `SendAssetToMaintenanceCommand`, `ReceiveAssetFromMaintenanceCommand`),
asset discard (`SaveAssetDiscardIndentCommand`, `ApproveAssetDiscardIndentCommand`, `ServeAssetDiscardIndentCommand`,
`DiscardAssetCommand`, `SellDiscardedAssetCommand`), manual discard requisitions (`SaveManualDiscardRequisitionCommand`
and its approvals) and the print `PrintDiscardSoldInvoiceDocument`. Each had its own approval setting table.

## Approval ladders

One record type, `scm/asset-approval-levels` (`flow` = `service`, `discard` or `scrap_sale`, `levelOrder`, `name`,
`roleId`), replaces the three old approval setting tables. A document is decided level by level by a holder of
that level's role; whoever raised it cannot approve it (403 `self_approval`), anyone else gets 403 `not_approver`.
A flow with no levels cannot be raised (422 `no_approval_levels`). Every decision carries the document `version`
(409 `stale_*`). An approver may drop pieces (`rejectAssets`) and keep the rest; dropping all of them is 422
`nothing_approved` (reject instead). The decisions are kept as the document's history.

Each piece can be on one open request at a time (409 `asset_busy`) and must be in stock (422 `asset_state`).
A rejection, or a dropped piece, frees it.

## Service requests (`/scm/asset-service-requests`, `AS-<year>-<serial>`)

* Lines: piece, `warranty` or `maintenance`, problem, expected cost (warranty is always 0).
* The **last approval sends the pieces out**: status `out_for_service` and a gate pass of kind `maintenance`
  (`GP-<year>-<serial>`, from step 7e) to the party it was sent to. The old flow had a separate "send" step after
  approval.
* `POST :id/receive { version, assetIds, on }`: pieces back in stock; the request is closed when all are back.
* A piece out for service stays in the stock quantity and keeps being depreciated.

## Discard requests (`/scm/asset-discard-requests`, `AD-<year>-<serial>`)

The **last approval writes the pieces off** on the decision date `on`, in one transaction:

1. Stock out of each piece from where it is (movement kind `discard`, expired lots included).
2. Depreciation closed to the disposal date: what was due, plus the current period by days, in a run of kind
   `disposal` with its voucher **Dr `depreciation_expense` / Cr `accumulated_depreciation`**. Disposal runs are
   never the "latest run" that can be reversed.
3. The disposal journal: **Dr `accumulated_depreciation`** (what the pieces carry), **Dr `asset_disposal_loss`**
   (the book value), **Cr inventory** at cost (the item type's GL account, otherwise the `store_inventory` role).
4. Pieces `discarded`, with their book value on the request.

`POST :id/sell { version, soldTo, on, amounts[] }` — once, not before the discard date: invoice number
`DIS-<year>-<serial>`, pieces `sold`, and **Dr `cash_in_hand` / Cr `asset_disposal_gain`** for the total.

The old discard approved, then "served", then discarded in separate screens, posted nothing to accounts and left
depreciation running.

## Scrap sales (`/scm/scrap-sales`, `SS-<year>-<serial>`)

Old "manual discard requisition": free-text lines (description, unit, quantity, rate) for scrap that is not a
registered asset, totals to the paisa. The last approval gives the invoice number (same `DIS` series) and posts
**Dr `cash_in_hand` / Cr `scrap_sale_income`**. No stock is touched.

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
| `POST .../:id/decision { version, decision, remarks, rejectAssets, on }` | the level's role, not the raiser |
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
| `SellDiscardedAssetCommand` | `POST /scm/asset-discard-requests/:id/sell` |
| `SaveManualDiscardRequisitionCommand` and its approvals | `/scm/scrap-sales` |
| `PrintDiscardSoldInvoiceDocument` | report `scm.disposal-invoice` |
| `GetWarrantyMaintenanceDashboardQuery`, `GetAssetMaintenancesQuery` | step 7h reports |

## Open questions

1. Should receiving pieces back from service need its own approval (old `RequestWarrantyMaintenanceReceive`)?
2. Should the maintenance cost be posted to accounts (expense / payable) when the pieces come back, and with
   what actual amount?
3. Should a piece out for service leave the store's stock quantity, or stop being depreciated?
4. Should the sale of written-off pieces go through its own approval, and to a party ledger instead of cash?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* Migration `0022_scm_asset_requests`: 8 tables, `depreciation_runs.kind`, movement kind `discard`
* `npm test`: 265 passed — new `test/unit/supply-chain/asset-requests.spec.ts` (ladder, dropped pieces, receive
  back closing the request, scrap totals) and disposal charges by days in `depreciation.spec.ts`
* `npm run test:int`: 16 passed (migration count 23, new tables)
* `npm run test:e2e`: 94 passed — new `test/e2e/scm-asset-requests.e2e-spec.ts` (service request with gate pass,
  busy piece refused, inbox, wrong approver 403, receive back; discard with book values, disposal run and
  journal, accumulated depreciation closed, loss posted, stock reduced; sale with `DIS` invoice and cash; scrap
  sale with invoice and income; both invoices rendered as PDF)
* Disposal invoice checked visually (discard sale and scrap sale, Bangla buyer name, amount in words)
* Dev server restarted with the new routes mapped; readiness 200
