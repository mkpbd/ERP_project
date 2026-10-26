# Step 8g — Pharmacy: physical inventory (stock counts)

Status: **done** (2026-10-26). Previous: [step 8f](08f-pharmacy-returns.md) · Next: step 8h (pharmacy reports).

## Where the old logic lives

CoxBazar `Features/Pharmacy` stock audit: `AddEditStockAuditCommand`, `AuditInitializeCommand` (the lots to count),
`AddEditAuditDetailCommand` / `AddEditAuditDetailsBulkCommand` (the counts), `AddEditAuditedStockCommand` (a lot
found on the shelf), `ApplyStockAuditCommand`, `GetAuditedStockByStockAuditIdQuery`,
`GetRequireAuditedStockByStockAuditIdQuery`, the `AuditReportGridDocument` / `AuditReportGridExcelExporter`
(difference, excess, equal) and `StockAuditDetailsDocument`. The physical inventory report
(`AddEditPhysicalInventoryReportCommand`, `FinalizePhysicalInventoryReportCommand`,
`GetPhysicalInventoryFiguresQuery`, `GetPhysicalInventoryDualCountedQuery`) is a summary over several periods and
comes with the reports of step 8h.

The old audit copied the stock figures when it was started and applied the difference against those copies, so a
sale entered between starting and applying an audit was counted twice. The old audit also adjusted product
totals, not lots. Now:

* the count is **lot by lot** (batch and expiry) and the stock moves in the lots it was counted in;
* the difference is worked out **when the count is applied**, against the ledger **as of the count date**, so
  late entries dated on or before the count date are taken into account;
* the count is posted to accounts in the same transaction.

## Counts (`/pharmacy/stock-counts`, `SC-<year>-<serial>`)

* **Open** (`pharmacy:count`, works at the outlet): an outlet, a count date, a note and optionally some products
  only. The count lists every lot the outlet holds as of that date, **expired lots included**, each at its cost
  (value ÷ units of the lot's movements). A count has at most 5,000 lots; count a big store by product group.
  Lots are listed by brand, then earliest expiry first.
* **Record counts**: a lot and the units on the shelf (a whole number, 0 for none), with an optional note
  (for example "expired, sent for disposal") and a **`writeOff`** mark: what is missing of that lot is written
  off as expired or damaged, not a count loss. Counts can be recorded in as many sittings as needed; a lot recorded
  again takes the latest figure. A lot that is not on the count is refused (422 `not_on_count`).
* **Add a lot** found on the shelf: product, batch, expiry, sale rate and the units counted. A lot the outlet
  never held needs its unit cost (422 `cost_needed`).
* **Apply** (`pharmacy:manage`):
  * only when every lot is counted (422 `uncounted_lines`);
  * **by someone other than who opened the count** (403 `self_approval`);
  * the products are locked as for sales;
  * each lot's difference is counted less what the ledger holds as of the count date, at that moment;
  * the difference becomes a `count_adjustment` movement dated on the count date;
  * the system figure used and the units adjusted are kept on each line.
* **Voucher**:
  * shortage: **Dr** `pharmacy_count_loss` / **Cr** `pharmacy_inventory`;
  * missing units of lots marked `writeOff`: **Dr** `pharmacy_damage_loss` / **Cr** `pharmacy_inventory`
    (the count keeps it as `writtenOffValue`);
  * excess: **Dr** `pharmacy_inventory` / **Cr** `pharmacy_count_gain`;
  * both at the lots' cost.
* **Cancel** with a reason while counting; nothing moves. A count carries a `version`: an outdated one is 409
  `stale_stock_count`. Applied or cancelled counts change no more (422 `stock_count_state`).

## Endpoints (under `/api/v1/pharmacy`)

| Method and path | Permission |
|---|---|
| `GET stock-counts` (`outletId`, `status`, paged), `GET stock-counts/:id` | `pharmacy:read` |
| `POST stock-counts`, `POST stock-counts/:id/counts`, `POST stock-counts/:id/lots`, `POST stock-counts/:id/cancel` | `pharmacy:count` + works at the outlet |
| `POST stock-counts/:id/apply` | `pharmacy:manage` |

New GL roles: `pharmacy_count_loss` (expense) and `pharmacy_count_gain` (income).

## Reports

* `pharmacy.count-sheet` — **blind** count sheet: the lots with batch and expiry (expired ones marked), blank
  columns for the count and remarks, rows for lots found that are not listed, and signatures. What the system holds
  is not printed.
* `pharmacy.count-result` — landscape, PDF and xlsx. Each lot shows:
  * the system figure, the count and the difference;
  * the unit cost and the value;
  * the note.

  Totals cover short (count loss), written off (damage loss), over and the expired stock still on hand at cost. `differencesOnly` hides the lots that
  agree.

## Decisions taken (after the first version of this step; migration `0033_pharmacy_count_write_off`)

* Expired or damaged lots found short are marked `writeOff` on the count line and go to `pharmacy_damage_loss`.
* The physical inventory summary over several periods comes with the reports of step 8h.
* No second (dual) count for now: a lot in doubt is recounted on a new count.
* No freeze while counting: sales and receives go on, because the difference is taken against the ledger as of
  the count date when the count is applied.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0032_pharmacy_stock_counts`: 2 tables; movement kind `count_adjustment`; `0033`: write-off mark and value
* `npm test`: 299 passed — new `test/unit/pharmacy/count.spec.ts`:
  * applied against the balances given when applying, not those opened with;
  * shortage, written off and excess at cost; a lot added on the count;
  * all lots counted first, not by who opened it, once only;
  * unknown lots, fractions and a lot added twice are refused; cancel needs a reason.
* `npm run test:int`: 16 passed (migration count 34, new tables)
* `npm run test:e2e`: 113 passed — new `test/e2e/pharmacy-count.e2e-spec.ts`:
  * three lots listed, the expired one marked;
  * apply refused while one lot is uncounted;
  * the expired lot counted 0 and marked written off;
  * a lot found on the shelf, refused without a cost;
  * a sale dated before the count, entered after it was opened, is taken into account (lot B 95 against 97);
  * apply refused to the counter (no `pharmacy:manage`);
  * shortage 1.70, written off 40.00 and excess 9.00 in the count loss, damage loss and gain ledgers; lots after
    the count;
  * a second apply is refused;
  * the xlsx result shows the differences; both PDFs render;
  * a count of some products only, refused to whoever opened it, cancelled with a reason, no stock moved.
* Count sheet and result checked visually (Bangla product name, expired lot)
* Dev server restarted; readiness 200
