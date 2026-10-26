# Step 8d — Pharmacy: outlet indents and transfers

Status: **done** (2026-10-26). Previous: [step 8c](08c-pharmacy-supplier-payments-returns.md) · Next: step 8e
(counter sales).

## Where the old logic lives

CoxBazar `Features/Pharmacy`: `AddOutletIndentWithDetailsCommand`, `AddEditOutletIndentCommand` /
`…DetailCommand`, `ClaimOutletIndentStatusCommand`, `ProcessStockTransferCommand` (the sending side),
`ClaimOutletIndentAcceptCommand` and `ProcessAcceptOutletTransferCommand` (the receiving side, which wrote a stock
receive of type "OutletRequisition" and supplier ledger rows), `GetTransferIndentDetailsQuery`,
`GetCurrentStocksForIndent`; print `PrintStockTransferDocument`.

The old transfer and accept had been rewritten as single transactions with "claims" against double processing.
They still took the lots the page chose (no expiry rule) and wrote a supplier ledger row for a move between two
of the hospital's own outlets. Now:

* the sending outlet's lots are chosen **first expiring first, never an expired lot** (or the lot named), under a
  lock on the outlet's products, and the stock leaves at once;
* the stock is **in transit** until the receiving outlet accepts it into **the same lots at the same cost**, or
  rejects it back to the sender (with a reason);
* nothing is posted to accounts: both outlets are in the one pharmacy inventory account. The supplier ledger is
  not touched.
* The double-processing "claims" are the documents' versions and row locks.

## Outlet indents (`/pharmacy/outlet-indents`, `OI-<year>-<serial>`)

* Raised by someone working at the **requesting** outlet (`pharmacy:transfer`), to a **supplying** outlet (not
  itself, 422 `same_outlet`): date, urgent flag, note, one line per product in whole units.
* Its view shows, per line, what has been transferred and what the supplying outlet holds now (unexpired lots
  only; the old indent refused quantities above it, now it is information).
* Edited or cancelled (with a reason) by the requesting outlet while nothing was sent; closed (with a reason)
  when partly transferred, by either outlet. Status `open` → `partly_transferred` → `transferred`, or `closed` /
  `cancelled`.

## Transfers (`/pharmacy/transfers`, `TT-<year>-<serial>`)

* **Sent** by someone working at the sending outlet: to another outlet, against an indent or not (against an
  indent: its outlets, 422 `indent_mismatch`, and never beyond what was asked for, 422 `over_transfer`; a closed,
  cancelled or completed indent takes none, 422 `outlet_indent_state`). Lines: product, units and optionally a lot.
  Not enough unexpired stock is 422 `insufficient_stock`. Each lot part is a transfer line with its cost.
* **Decided** by someone working at the receiving outlet: `accept` (stock in, movement `transfer_in`) or `reject`
  with a reason (stock back to the sender, and the quantities given back to the indent). Once only (422
  `transfer_state`), not dated before the transfer.
* **Line by line** (old per-line accept): `accept` may name `rejectLines` (1-based) with a reason; those lines go
  back to the sender and to the indent, the rest come in; at least one line is kept (422 `nothing_accepted`).
* The stock card shows `transfer_out` and `transfer_in` movements; stock in transit is in neither outlet.

## Endpoints (under `/api/v1/pharmacy`)

| Method and path | Permission |
|---|---|
| `GET outlet-indents` (`requestingOutletId`, `supplyingOutletId`, `status`, paged; urgent first), `GET outlet-indents/:id` | `pharmacy:read` |
| `POST outlet-indents`, `PATCH outlet-indents/:id`, `POST outlet-indents/:id/cancel` | `pharmacy:transfer` + works at the requesting outlet |
| `POST outlet-indents/:id/close` | `pharmacy:transfer` + works at either outlet |
| `GET transfers` (`fromOutletId`, `toOutletId`, `status`, paged), `GET transfers/:id` | `pharmacy:read` |
| `POST transfers` | `pharmacy:transfer` + works at the sending outlet |
| `POST transfers/:id/decision` | `pharmacy:transfer` + works at the receiving outlet |

`pharmacy:manage` stands in for working at an outlet, as before.

## Report

`pharmacy.transfer` (old `PrintStockTransferDocument`): outlets, indent, state (in transit, accepted or rejected
with the date and reason), lines by lot with batch, expiry, units, unit cost and value.

## Old → new routes

| Old | New |
|---|---|
| `AddOutletIndentWithDetailsCommand`, `AddEditOutletIndentCommand`, `AddEditOutletIndentDetailCommand`, `GetOutletIndentsByDateQuery`, `GetSpOutletIndentDetaisByIndentIdQuery`, `GetDuplicateOutletIndentQuery` | `/pharmacy/outlet-indents` |
| `GetCurrentStocksForIndent`, `GetTransferIndentDetailsQuery` | `GET /pharmacy/outlet-indents/:id` (with `available`) |
| `ClaimOutletIndentStatusCommand`, `ProcessStockTransferCommand`, `AddEditStockTransferCommand`, `AddEditStockTransferDetailCommand` | `POST /pharmacy/transfers` |
| `ClaimOutletIndentAcceptCommand`, `ProcessAcceptOutletTransferCommand` | `POST /pharmacy/transfers/:id/decision` |
| `GetStockTransferRecordQuery`, `GetStockTransferDetailByTransferIdQuery`, `GetStockTransferIdByOutletIndentNoQuery` | `GET /pharmacy/transfers[/:id]` |

## Decisions taken

* Transfers are accepted line by line (added after the first version of this step; migration
  `0028_pharmacy_transfer_line_rejected`).
* An outlet returns stock to the central store with a transfer without an indent; no separate document.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0027_pharmacy_outlet_transfers`: 4 tables, movement kinds `transfer_out` and `transfer_in`
* `npm test`: 283 passed — new `test/unit/pharmacy/transfer.spec.ts` (first expiring first, expired lots left out,
  lot cost carried, named lot, shortage; indent transfers up to what was asked, rejected quantities given back,
  completed, closed only when partly transferred, edit and cancel only before anything was sent, not from itself;
  transfer accepted or rejected once, not before it was sent, rejection needs a reason)
* `npm run test:int`: 16 passed (migration count 28, new tables)
* `npm run test:e2e`: 106 passed — new `test/e2e/pharmacy-transfer.e2e-spec.ts` (indent with availability that
  leaves out the expired lot; send refused at an outlet the user does not work at; 150 sent as lot B 100 + lot C 50
  worth 130, in transit in neither outlet; over-transfer and shortage refused; accept refused at the sending
  outlet, accepted at the receiving one into the same lots at the same value; decided only once; a second transfer
  rejected without and with a reason, back in the store and given back to the indent; cancel refused, close
  accepted, closed indent takes no transfer; stock card; print; a transfer without an indent from a named lot,
  expired lot refused, in-transit list, same-outlet indent refused). It found that rejecting an accepted transfer
  without a reason reported the missing reason instead of the state; fixed.
* Transfer print checked visually (Bangla outlet name)
* Dev server restarted; readiness 200
