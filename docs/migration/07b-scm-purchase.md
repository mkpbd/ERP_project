# Step 7b — Supply chain: requisitions, comparative studies, purchase orders

Status: **done** (2026-10-26). Previous: [step 7a](07a-scm-masters.md) · Next: [step 7c](07c-scm-stock.md) (stock receive and stock
ledger).

## Where the old logic lives

The flow is in the CoxBazar Blazor pages (`Components/Pages/SupplyChain/...`); the handlers only save rows. In
the old system:

```
PR indent (shortfalls of store indents) → purchase requisition → approval rows per level
  → "Final" approved requisition → one purchase order (enforced by the screen only)
  → stock receive against the order number (partial), or without an order
comparative study and GRN: on their own, linked to nothing
```

Step 7 is re-planned around that: this step covers the documents before the goods arrive; step 7c covers
the receive with lots, the stock ledger, GRN faults and posting to accounts; PR indents come with store
indents in 7d.

| Step | Content |
|---|---|
| 7c | Stock receive (with or without an order, partial), lots and expiry, stock movement ledger, opening stock, GRN faults, posting to accounts and the supplier's sub-ledger, order status |
| 7d | Store indents and approval, PR indents, main → sub-store transfer, issues, department stock, returns, gate pass, drafts |
| 7e | Fixed assets |
| 7f | Reports |

## Numbering

`<kind>-<year>-<serial>`, a serial per kind and year: `PR-2026-00001`, `CS-2026-00001`, `PO-2026-00001`.
The old requisitions used `spGetNextIndentNo` (its source is in neither repository), the orders
`FKH<yy>9<serial>` worked out as the highest number + 1 without a lock, and study numbers were typed. Old
numbers are kept as they are by the data migration.

## Purchase requisitions

* Header: main store, optional sub-store, department and suggested supplier, date, payment term
  (cash / credit, old `IsCashPurchase` / `IsCreditPurchase`), note, terms. Lines: item variant (once each),
  requested quantity (up to 3 decimals), description.
* `draft` → `pending` (submit) → `approved` or `rejected`; `cancelled` from draft, pending, or approved while
  no order uses it (422 `requisition_ordered`). Only drafts are edited or deleted.
* **Approval levels** per main store (`/scm/purchase-approval-levels`: order, name, role; old
  `SCMPurchaseApprovalSettings` "Level1".."Final"). Levels are decided in ascending order; the highest one
  approves the requisition. Anyone holding the level's role decides (403 `not_approver` otherwise), but not
  on a requisition they raised (403 `self_approval`, new). Submitting without levels is 422
  `no_approval_levels`.
* An approver may lower quantities (0 drops a line), never above the request (422
  `approval_exceeds_request`); at least one line must stay. **Rejecting** needs a reason (new; the old screens
  had none).
* Every decision is kept: level, approve / reject, who, when, remarks (old `RequisitionApprovals`).
* `GET /scm/purchase-requisitions/inbox`: pending ones waiting for one of the caller's roles.

## Comparative studies

* Header: date, title, optional requisition (new; must be pending or approved), note. Quotes: supplier, a
  catalogue variant **or** a typed-in product (old `ManualBrandName`), quantity, unit price, VAT % and AIT %.
  VAT and AIT are on price × quantity, each rounded to the paisa, and added to the total (old formula; the old
  total itself was not rounded). A supplier quotes an item once.
* **Approval levels** (`/scm/cs-approval-levels`: order, name, approver staff, final flag; old
  `CSApprovalSettings` with `IsThisTheHighestLevelApproval`). Only the level's staff member decides. Each
  approver says which quotes stay in the running (old: the ticked lines); a final level, or the last one,
  approves the study and what is left wins. Rejecting needs a reason.
* `GET /scm/comparative-studies/inbox`: pending studies waiting for the caller.

## Purchase orders

* Header: supplier, main store, optional requisition and comparative study, order date, expected date (not
  before the order), terms, note. Lines: variant (once each), quantity, **rate kept on the order** (the old order
  showed the item's latest purchase price, which every receive changed), VAT %. Amount, VAT and total to the
  paisa.
* With a requisition: it must be approved, for the same main store, and **all its orders together stay within
  the approved quantities** (422 `order_exceeds_requisition`, `not_on_requisition`). A requisition may be split
  among suppliers (the old screen allowed one order). Orders of one requisition are serialized.
* With a study: it must be approved and the supplier must have won a quote (422 `study_not_approved`,
  `supplier_not_chosen`).
* `open` → (7c: `partially_received` → `received`, or `closed`); `cancelled` with a reason while nothing is
  received. Orders are edited only while nothing is received.

There is no order approval, as in the old system.

## Concurrency

Requisitions, studies and orders carry a `version`; edits and actions send it and get 409
`stale_requisition` / `stale_comparative_study` / `stale_purchase_order` when someone else changed the
document.

## Endpoints (under `/api/v1/scm`)

| Method and path | Permission |
|---|---|
| `GET purchase-requisitions` (`status`, `from`, `to`, `q` number, `mainStoreId`, `supplierId`, paged), `GET purchase-requisitions/:id` | `scm:read` |
| `POST purchase-requisitions`, `PATCH :id`, `POST :id/submit`, `POST :id/cancel`, `DELETE :id?version=` | `scm:purchase` |
| `POST purchase-requisitions/:id/decision` `{ version, decision: approve\|reject, remarks, quantities[{variantId, approvedQty}] }` | the level's role |
| `GET purchase-requisitions/inbox` | signed in |
| `GET comparative-studies` (`requisitionId` too), `GET :id` | `scm:read` |
| `POST comparative-studies`, `PATCH :id`, `POST :id/submit`, `DELETE :id?version=` | `scm:purchase` |
| `POST comparative-studies/:id/decision` `{ version, decision, remarks, keep[quote ids] }` | the level's staff |
| `GET comparative-studies/inbox` | signed in |
| `GET purchase-orders` (`requisitionId` too), `GET :id` | `scm:read` |
| `POST purchase-orders`, `PATCH :id`, `POST :id/cancel` `{ version, reason }` | `scm:purchase` |
| `purchase-approval-levels`, `cs-approval-levels` (records) | `scm:read` / `scm:manage` |

Reports: `scm.purchase-requisition`, `scm.comparative-study` (quotes side by side per item, lowest and chosen
marked; the old compare procedures mixed up items, see below), `scm.purchase-order` (with total in words).

## Old bugs not carried over

* Approval level order came from procedure result order without `ORDER BY`; updates of approval settings blanked
  the store.
* Approving a requisition or study rewrote lines and lost the description, manual product names and totals;
  manual product names were never saved.
* `SpGetComparativeStudiesCompareReport` filled every row with a supplier's price regardless of the item;
  `SpGetCSRecordByStaffId` ignored the end date.
* Order numbers could collide (max + 1, no lock); the order rate followed the item master.

## Old → new routes

| Old | New |
|---|---|
| `PurchaseRequisiontion` (add/edit, `GetPurchaseRequisiontionByDatesOrId`, detail by id) | `/scm/purchase-requisitions` |
| `PurchaseRequisiontionWithApprovalLevel` (inbox by role), review page | `GET /scm/purchase-requisitions/inbox`, `POST :id/decision` |
| `GetApprovedPurchaseRequisition` | `GET /scm/purchase-requisitions?status=approved` |
| `SCMPurchaseApprovalSetting` | `/scm/purchase-approval-levels` |
| `ComparativeStudy`, `ComparativeStudyDetail`, `GetComparativeStudyByDatesOrId` | `/scm/comparative-studies` |
| `SpGetCSRecordByStaffId`, CS review and approval page | `GET /scm/comparative-studies/inbox`, `POST :id/decision` |
| `CSApprovalSetting` | `/scm/cs-approval-levels` |
| `SpGetComparativeStudiesCompareReport*` | report `scm.comparative-study` |
| `SPurchaseOrder` (`GetSPurchaseOrderRecordByIdOrDate`, `...ByDates`, detail by order) | `/scm/purchase-orders` |
| `SCMGetNewPurchaseOrderNo` | numbers are given on create |
| `PurchaseOrderAdvance` (only read in the old code) | a payment voucher on the supplier's sub-ledger (step 7c) |
| `GRN`, `GRNFaultDescription`, `StockReceive`, `SupplierLedger` | step 7c |
| `PRIndent`, `PRSubmitted` | step 7d |

## Open questions

1. Should purchase orders need approval (e.g. above an amount)?
2. Should an approved requisition expire, or close automatically when all its quantity is ordered?
3. Can someone who holds the role of a later level approve two levels in a row?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* Migration `0017_scm_purchase_cycle`: 11 tables (two foreign keys named explicitly; PostgreSQL cuts names at
  63 characters). The shared record store now also matches shortened constraint names, which fixes the
  `<record>_not_found` code for four older long foreign keys (e.g. level-4 heads → sub-categories).
* `npm test`: 232 passed — new `test/unit/supply-chain/purchase.spec.ts` (numbering, level order and final
  level, requisition approval with lowered quantities, wrong level, over-request, rejection, bad lines; quote
  arithmetic to the paisa, keeping quotes, final level, quote rules; order allowance, cancellation, totals)
* `npm run test:int`: 16 passed (migration count 18, new tables)
* `npm run test:e2e`: 85 passed — new `test/e2e/scm-purchase.e2e-spec.ts` (two-level requisition approval with
  inbox, stale version, wrong approver, lowered quantities; self approval, rejection, no levels, unknown item,
  permissions; study with quotes and approval by staff; orders limited by the study winner and the approved
  quantities across suppliers, ordered quantities on the requisition, edit and cancel with versions; all three
  reports; shortened constraint name)
* Visual check of the comparative statement and the purchase order (Bangla supplier name, lakh grouping, total in
  words); dev server restarted with the new routes mapped
