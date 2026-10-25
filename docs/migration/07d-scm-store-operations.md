# Step 7d — Supply chain: store indents, requests, issues, transfers

Status: **done** (2026-10-26). Previous: [step 7c](07c-scm-stock.md) · Next: step 7e (department stock, supplier
returns, gate pass).

## Where the old logic lives

The CoxBazar store pages and, for the newest flows, commands added between 2026-10-19 and 10-25
(`TransferStockWithDetailsCommand`, `IssueStockToDepartmentCommand`, the department stock folder). Some
flows exist twice: the original page code that wrote rows in separate commits without stock checks or lots, and
the hardened commands with locks, FEFO and stock checks. This step follows the hardened behaviour and fixes what
both got wrong.

```
main store ──transfer (serving a PR indent)──▶ sub-store ──issue (serving a store indent)──▶ department
sub-store ──return──▶ main store          sub-store ──transfer (pending → accepted)──▶ sub-store
store indent shortfall ─▶ PR indent ─▶ transfer from the main store, or a purchase requisition
```

Step 7 is planned again: department stock (consumption, returns, adjustments), supplier returns with
replacements and gate passes come in **7e**; fixed assets in **7f**; reports in **7g**.

## Moving stock

Every issue and transfer takes stock out of the source store **by lot**: first expiring first, lots expired on
the document date left out, undated lots last; or from a lot the user names. The source store's variants are
locked for the transaction (in a fixed order), and nothing is taken that is not there (422
`insufficient_stock`). The lots taken travel with their cost into the receiving store; the issue or transfer
shows them (`parts`, `value`). Old behaviour not carried over:

* the original issue, sub-to-main return and store-to-store transfer took no lot and created negative "no lot"
  stock; the old stock procedures then subtracted an item's whole out-quantity from every lot;
* nothing stopped negative stock (readers showed it as zero);
* the main → sub automatic lot choice used expired lots, and the store-to-store accept recorded the quantity
  sent instead of the quantity accepted and posted a supplier ledger entry against the first supplier in the
  list.

## Store indents (old `StoreIndents`, `StoreIndentDetails`, `IndentApprovals`)

* A sub-store's request for goods for a department (the old indent never recorded the department; the issue
  did): number `SI-<year>-<serial>`, date, priority (routine, emergency, critical care, new admission,
  discharge, other — the old 0–5 codes), note, lines (item once, quantity, remark).
* `draft` → `pending` → `approved` → `partially_served` → `served` → `acknowledged`; `rejected` with a reason;
  `cancelled` until fully served (a partly served indent is closed this way).
* **Approval levels per sub-store by role** (`/scm/indent-approval-levels`; old `StoreIndentApprovalSettings`).
  Every level decides in turn; approvers may lower quantities; nobody approves an indent they raised. The old
  screen marked the indent approved after the first level, so the later levels never saw it.
* Issues serve it, never beyond the approved quantity (422 `serve_exceeds_request`).
* The person who raised it **acknowledges** a served indent (403 `not_indenter` for anyone else). The old
  acknowledgement trimmed the issued quantities to an acknowledged quantity; issues are now exact, so it only
  confirms receipt.
* `GET /scm/store-indents/:id/shortfall?on=`: approved and not issued, less what the sub-store holds — what to
  ask the main store for (old PR-indent shortfall, worked out on the Issue page with two different bases).
* Indenting for a department needs the user to be among the department's users (`department-users` or
  `department-store-access`), or `scm:manage` (403 `no_department_access`).

## Store requests (old `PRIndents`, `PRSubmitted`)

* A sub-store asks **its** main store (`RQ-<year>-<serial>`): lines (item, quantity). The old page put every
  store's shortfalls into one PR indent under the first store.
* Served by main store → sub-store transfers that name it, never beyond what was asked; `open` →
  `partially_served` → `served`, or `closed`.
* `POST /scm/store-requests/:id/purchase-requisition` (`scm:purchase`): what is still outstanding becomes a
  **draft purchase requisition** for the main store (7b), linked to the request, once.

## Issues (old `Issues`, `IssueDetails`)

`POST /scm/store-issues` (`scm:issue`): sub-store, department, optional indent (same sub-store and department,
approved or partly served), date, receiving staff member, note, lines (item, quantity, optional lot; an item
may appear again for another lot). Number `IS-<year>-<serial>`. Issuing from a sub-store needs the user in its
`issue-store-users` (old `IssueStoreAcess`, which the old Issue page never checked) or `scm:manage` (403
`no_store_access`). Department stock comes in 7e; until then an issue is stock leaving the store.

## Transfers (old `SStockTransfer`, `SubStoreToMainTransfer`, `SCMStockTransfer`)

`POST /scm/stock-transfers` (`scm:issue`), number `TR-<year>-<serial>` (the old transfers had none, or MAX + 1):

| From → to | Old | Behaviour |
|---|---|---|
| Main store → its sub-store | `SStockTransfer` | Completes at once; may serve a store request. |
| Sub-store → its main store | `SubStoreToMainTransfer` | Completes at once (a return). |
| Sub-store → another sub-store | `SCMStockTransfer` | `pending`; nothing moves until the receiving store accepts (possibly less per line) with the arrival date, or rejects with a reason. `POST :id/decision` `{ version, decision, accepted[{line, qty}], on, reason }`. |

A sub-store must belong to the main store it exchanges with (422 `wrong_main_store`); main stores do not
transfer to each other. Sending from or accepting into a sub-store needs the user in its issue store users or
`scm:manage`.

## Endpoints (under `/api/v1/scm`)

| Method and path | Permission |
|---|---|
| `GET store-indents` (`status`, `from`, `to`, `q`, `subStoreId`, `departmentId`, paged), `GET :id`, `GET :id/shortfall` | `scm:read` |
| `POST store-indents`, `PATCH :id`, `POST :id/submit`, `POST :id/cancel`, `DELETE :id?version=` | `scm:indent` |
| `POST store-indents/:id/decision` | the level's role |
| `POST store-indents/:id/acknowledge` | the person who raised it |
| `GET store-indents/inbox` | signed in |
| `GET store-requests`, `GET :id` | `scm:read` |
| `POST store-requests`, `POST :id/close` | `scm:indent` |
| `POST store-requests/:id/purchase-requisition` | `scm:purchase` |
| `GET store-issues`, `GET :id` | `scm:read` |
| `POST store-issues` | `scm:issue` + store access |
| `GET stock-transfers` (`kind`, `subStoreId` or `mainStoreId` on either side, `requestId`), `GET :id` | `scm:read` |
| `POST stock-transfers`, `POST :id/decision` | `scm:issue` + store access |
| `indent-approval-levels` (records) | `scm:read` / `scm:manage` |

Reports: `scm.store-indent`, `scm.store-issue` (issue slip with lots, value and signature lines),
`scm.stock-transfer`.

## Old → new routes

| Old | New |
|---|---|
| `StoreIndent` (add/edit, `GetStoreIndentByDatesOrId`, `...ForPending`, detail by indent) | `/scm/store-indents` |
| `SpGetStoreIndentWithApprovalLevel`, `IndentApproval` review page | `GET /scm/store-indents/inbox`, `POST :id/decision` |
| `StoreIndentApprovalSetting` | `/scm/indent-approval-levels` |
| Indent acknowledgement page | `POST /scm/store-indents/:id/acknowledge` |
| `PRIndent`, PR-indent page, `PRSubmitted` | `/scm/store-requests`, `POST :id/purchase-requisition` |
| Issue page, `IssueStockToDepartmentCommand`, `GetIssueByDatesOrId`, `SpGetIssueDetailsByIssueId` | `/scm/store-issues` |
| `TransferStockWithDetailsCommand`, PR-indent "Stock Transfer" tab | `POST /scm/stock-transfers` (main → sub) |
| `SubStoreToMainTransfer` | `POST /scm/stock-transfers` (sub → main) |
| `SCMStockTransfer` (`/supply-chain/stock-transfer`, `/supply-chain/store-receive`) | `POST /scm/stock-transfers` (sub → sub), `POST :id/decision` |
| `SpGetSCMStockTransferByStoreIdAndDates`, `...DetailsByTransferId` | `GET /scm/stock-transfers`, `GET :id` |

## Open questions

1. Should a main store → sub-store transfer also wait for the sub-store to accept (goods in transit), as
   store-to-store transfers do?
2. Should indents be numbered per sub-store?
3. Is an issue without an indent allowed for every department, or only for some (emergency)?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* Migration `0019_scm_store_operations`: 10 tables; stock movement kinds `issue` and `transfer`
* `npm test`: 247 passed — new `test/unit/supply-chain/allocation.spec.ts` (first expiring first, expired left
  out, named lot, shortage) and `store.spec.ts` (every approval level in turn, serving with caps, acknowledge,
  reject and cancel, store request serving and purchase link, move lines, partial acceptance, StockKeeper locks
  in order and allocates across lines of one document)
* `npm run test:int`: 16 passed (migration count 20, new tables)
* `npm run test:e2e`: 89 passed — new `test/e2e/scm-store.e2e-spec.ts` (indent for a department without access,
  approval inbox and decision, shortfall, store request served by a FEFO transfer skipping an expired lot,
  issues against the indent with over-issue refused, acknowledgement by the indenter only, issue without stock,
  stock card; wrong main store, pending store-to-store transfer accepted in part after its date, decided once,
  return to the main store, transfer lists, purchase requisition from a request once; all three reports)
* Visual check of the issue slip (Bangla item name, lots, signature lines) and a store-to-store transfer; dev
  server restarted with the new routes mapped
