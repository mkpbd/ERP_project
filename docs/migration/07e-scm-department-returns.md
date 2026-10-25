# Step 7e — Supply chain: department stock, supplier returns, gate passes

Status: **done** (2026-10-26). Previous: [step 7d](07d-scm-store-operations.md) · Next: step 7f (fixed assets).

## Where the old logic lives

Department stock was added to the CoxBazar app on 2026-10-21 (`Features/SupplyChain/DeptStock`, the
`fnDeptStockLedger` function and scripts under `database/2026-10-21/DepartmentStock`; deployed to some live
databases only). Supplier returns are `SCMSupplierReturnIndent` pages (RetStatus 1 → 9 → 18) and gate passes
`CreateGatePassCommand`.

## Department stock

A **department** is now a place that holds stock, like a store: the stock movements carry a department, and
**an issue (7d) puts the goods into the department** lot by lot (old: the Issue was the department's IN document).
`GET /scm/stock?departmentId=` and `GET /scm/stock/card?departmentId=` read it.

| Document | Old | Behaviour |
|---|---|---|
| Consumption `DC-…` (`/scm/department-consumptions`) | `DeptStockConsumption` (DCN) | Posted at once: out of the department first expiring first, expired lots only when named, never below zero. Cancel with a reason (and date): the same lots and costs go back. |
| Return `DR-…` (`/scm/department-returns`) | `DeptStockReturn` (DRT) | `pending` → `received` by the sub-store (the user needs issue access to it; `on` not before the return date) → the lots go from the department to the sub-store, expired ones too. A pending return can be cancelled by the department. The old pending return reserved the stock; here it is checked when received. |
| Count `DA-…` (`/scm/department-counts`) | `DeptStockAdjustment` (DAJ) | Physical count by lot with the reason; `pending` → `approved` (by `scm:adjust`, not the person who counted) / `rejected` (with remarks) / `cancelled`. On approval each lot is set to what was counted against the records **at approval**: a shortfall leaves the department, a surplus comes in at the lot's cost in the department (or its received cost when the department held none). |

Recording consumption, returns and counts needs `scm:department` and being one of the department's users
(`department-users` or `department-store-access`), or `scm:manage`.

Internal movements (issue, consumption, return, count) post nothing to accounts, as before.

## Supplier returns `RT-…` (`/scm/supplier-returns`)

* `draft` (main store, supplier, date, reason, lines with optional lot; edited or deleted) → **`send`**:
  1. the lots leave the main store — expired lots first, since returns are where they go (old: no lot at all);
  2. a **gate pass** is issued for the supplier (`GP-…`);
  3. a **debit note** is posted: the supplier's payable (their account, else the `supplier_payable` role) on
     their sub-ledger is debited and inventory credited (item type account, else `store_inventory`) at the cost
     of the lots sent. The old return touched neither the supplier ledger nor accounts.
* **`settle`** (`on` not before the return date): for every line, what came back (0 to what was sent), the same
  product or a replacement (old `ReturnBrandExtentionId`) with its batch and expiry (required where the item
  needs one). What came back enters the main store in its own lot at the cost of what was returned, and that
  value of the debit note is reversed. What did not come back stays owed by the supplier on their sub-ledger.
* `scm:receive`. Old display bug not carried over: statuses 9 and 18 showed as "On Hold".

## Gate passes `GP-…` (`/scm/gate-passes`)

Date, purpose (`supplier_return`, `maintenance`, `other`), reference, who takes the goods, note. Supplier returns
issue theirs; others are issued by hand (`scm:issue`). The old number was MAX + 1 with a retry.

## Endpoints (under `/api/v1/scm`)

| Method and path | Permission |
|---|---|
| `GET department-consumptions`, `department-returns`, `department-counts`, `supplier-returns`, `gate-passes` (`status`, `from`, `to`, `q`, `departmentId`, `subStoreId`, `mainStoreId`, `supplierId`, paged) and `GET …/:id` | `scm:read` |
| `POST department-consumptions`, `POST :id/cancel` `{ version, reason, on }` | `scm:department` + department |
| `POST department-returns`; `POST :id/decision` `{ version, decision: receive\|cancel, on }` | `scm:department` (open, cancel), `scm:issue` + store (receive) |
| `POST department-counts`; `POST :id/decision` `{ version, decision: approve\|reject\|cancel, remarks }` | `scm:department` (count, cancel), `scm:adjust` (approve, reject) |
| `POST supplier-returns`, `PATCH :id`, `DELETE :id?version=`, `POST :id/send`, `POST :id/settle` | `scm:receive` |
| `POST gate-passes` | `scm:issue` |

Reports: `scm.supplier-return` (lines, lots sent with value, what came back, gate pass and voucher numbers),
`scm.gate-pass` (with signature lines). Department stock prints through `scm.stock` / `scm.stock-card` with
`departmentId`.

## Old → new routes

| Old | New |
|---|---|
| `DeptStockConsumptionCommands` (+ AutoConsumption from tests, 2026-10-25) | `/scm/department-consumptions` (automatic consumption from tests comes with diagnostics, step 10) |
| `DeptStockReturnCommands`, `vwDeptStockReturnReceipts` | `/scm/department-returns` |
| `DeptStockAdjustmentCommands`, `DeptStockMinLevel` (low-stock report only) | `/scm/department-counts`; minimum levels with the reports in 7g |
| `fnDeptStockLedger`, department stock pages | `GET /scm/stock?departmentId=`, `GET /scm/stock/card?departmentId=` |
| `SCMSupplierReturnIndent` (add, Return, Receive pages; `GetSCMSupplierReturnIndentByDatesOrId`, by number, details) | `/scm/supplier-returns`, `POST :id/send`, `POST :id/settle` |
| `CreateGatePassCommand`, gate pass list | `/scm/gate-passes` |

## Shared changes

* `stock_movements.department_id` (one of main store, sub-store or department per movement), kinds
  `consumption`, `department_return`, `adjustment`, `supplier_return`.
* Stock allocation can include expired lots (returns and counts).
* The stock ledger can reverse a document's movements.
* Tests: `DEBUG_LOG=1` shows server error logs in e2e runs.

## Open questions

1. Should issuing to a department (or consumption) post an expense to accounts?
2. Should a pending department return reserve the stock, as the old one did?
3. Should a settled supplier return with nothing back be followed by a payment from the supplier (a receipt
   voucher) through accounts only?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* Migration `0020_scm_department_stock`: 9 tables, department column and new movement kinds
* `npm test`: 253 passed — new `test/unit/supply-chain/department.spec.ts` (places, consumption cancelled once
  with a reason, return received not before its date, count approved by another person against the records at
  approval, supplier return sent at lot cost and settled with replacement and caps, debit note lines)
* `npm run test:int`: 16 passed (migration count 21, new tables)
* `npm run test:e2e`: 91 passed — new `test/e2e/scm-department.e2e-spec.ts` (issue into the department,
  consumption and its cancellation, no access to another department, over-consumption, return received by the
  store only, count approved by an auditor not the counter, department stock card by kind; supplier return
  sending expired lots first with gate pass and debit note, replacement in its own lot, supplier sub-ledger
  80 owed, settled return not deleted, manual gate pass; both reports)
* Visual check of the supplier return and gate pass; dev server restarted with the new routes mapped
