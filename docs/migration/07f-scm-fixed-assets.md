# Step 7f — Supply chain: fixed asset register and depreciation

Status: **done** (2026-10-26). Previous: [step 7e](07e-scm-department-returns.md) · Next: step 7g (asset
maintenance, warranty, discard and scrap sale).

## Where the old logic lives

CoxBazar `FixedAssetItems` (with `GenerateFixedAssetNumbersCommand`, `RelocateFixedAssetPiecesCommand`) and the
depreciation folder (`Features/SupplyChain/Depreciation`: `DepreciationEngine`, `DepreciationCalendar`,
`AssetDepreciationLedger`). Step 7 is planned again: maintenance and warranty, discard and scrap sale move to
**7g**, the supply chain reports to **7h**.

## Asset register (`fixed_assets`)

* An item is a **fixed asset** when `isAsset` is set (old: the item type GL was named "Reusable" or "Fixed
  Asset"). Every piece of such an item that comes into stock gets a row: asset number `FA-000001` (one series,
  as before), variant, lot, source document (receive or opening stock), supplier, **cost** (the unit cost it came
  in at, VAT and AIT included as the stock is), acquisition date, status and where it is.
* Pieces are made **when the receive or opening stock is posted**, in the same transaction (old: after the
  receive was saved, outside its transaction, never on an edit, and silently dropping fractions). A fixed-asset
  item comes in whole pieces (422 `whole_pieces`).
* Pieces **follow the stock**: a transfer, an issue to a department and a department return move as many pieces
  of that lot from the source to the target, oldest asset number first (old `RelocateFixedAssetPieces`, which
  only ran on transfers and issues, best effort). A supplier return takes them out of the register as
  `returned`. Fixed-asset items are not consumed or counted in bulk (422 `asset_item`).
* Statuses: `in_stock` (in a store or a department), `out_for_service`, `discarded`, `sold` (7g), `returned`.
* `PATCH /scm/fixed-assets/:id` writes the serial number and a note.
* The old manual "set location" (no stock movement, no permission check) is not ported.

## Depreciation

Straight line, the only method there was.

| Rule | Behaviour |
|---|---|
| Frequency | Monthly, quarterly, half-yearly or yearly; periods are calendar blocks from January. The useful life (1–1200 months) must be whole periods. |
| Start | Default: the acquisition date when it is the 1st of a month, otherwise the 1st of the next month (old rule). A start inside a period charges that period by days and adds a closing stub for the rest. |
| Charge | Each period takes its share of what remains to depreciate (cost − residual − accumulated) over the weight still to come, to the paisa; the last period takes exactly what is left. |
| Residual | An amount (one asset) or a percentage of each piece's cost (bulk). |
| Opening | One asset may bring depreciation charged before this system, as of a period end; the rest is spread over what is left of the life (old "Manual" opening). |
| Configure | `POST /scm/fixed-assets/depreciation` for up to 1000 pieces; refused once a piece has been charged (422 `depreciation_started`) or is not in stock. |

**Runs** (`/scm/depreciation-runs`, number `DP-<year>-<serial>`):

* `GET preview?asOf=` and `POST { asOf }`: every charge due up to a **month end**, not a month still to come
  (422 `invalid_as_of`). Each piece is charged once per period (a unique index), with the department it was in.
  422 `nothing_due` when there is nothing.
* One journal voucher per run: **Dr `depreciation_expense` / Cr `accumulated_depreciation`** (GL roles; old: the
  two accounts on `AssetDepreciationSetting`, posted best effort after the run and only when integrated accounts
  were on).
* `POST :id/reverse { reason, on }`: only the **most recent** posted run (422 `not_latest_run`); its entries go,
  its periods become due again and a reversing voucher is posted on the reversal date.
* Runs are serialized; the old run claimed the voucher with a five-minute marker instead.

Not ported yet (open questions): revision of life, residual or cost, suspension and resumption, the hourly
automatic run, depreciation on disposal (7g).

## Endpoints (under `/api/v1/scm`)

| Method and path | Permission |
|---|---|
| `GET fixed-assets` (`status`, `variantId`, `mainStoreId`, `subStoreId`, `departmentId`, `q` asset number, paged) — with cost, accumulated depreciation and book value | `scm:read` |
| `GET fixed-assets/:id` — lot, supplier, depreciation terms and every charge | `scm:read` |
| `PATCH fixed-assets/:id`, `POST fixed-assets/depreciation` | `scm:assets` |
| `GET depreciation-runs`, `GET depreciation-runs/:id` (entries per piece) | `scm:read` |
| `GET depreciation-runs/preview`, `POST depreciation-runs`, `POST depreciation-runs/:id/reverse` | `scm:assets` |

## Old → new routes

| Old | New |
|---|---|
| `GenerateFixedAssetNumbersCommand` (after a receive), fixed asset import | posting a stock receive or opening stock |
| Asset Register `/supplychain/asset-management`, Asset Dashboard | `GET /scm/fixed-assets` |
| `RelocateFixedAssetPiecesCommand` | transfers, issues and department returns |
| `SetAssetLocationCommand` | not ported |
| `AssetDepreciationSetting` | GL roles `depreciation_expense`, `accumulated_depreciation` |
| `ConfigureAssetDepreciationCommand` | `POST /scm/fixed-assets/depreciation` |
| `PostAssetDepreciationCommand` (preview and post), runs list | `/scm/depreciation-runs` |
| `ReverseAssetDepreciationCommand` | `POST /scm/depreciation-runs/:id/reverse` (whole latest run) |
| `ReviseAssetDepreciationCommand`, `AssetDepreciationAutoRunService` | not yet |

## Open questions

1. Should depreciation run automatically each month end (old hourly job, off by default)?
2. Are revisions (life, residual, added cost) and suspension needed now, or later with real data?
3. Should reversing a single piece's charges be possible, as the old screen allowed?

## Environment note

The dev and test databases moved to the local PostgreSQL on port 5432 (the container on 5433 was not running);
`erp_dev` and `erp_test` were created afresh and all migrations applied.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* Migration `0021_scm_fixed_assets`: 4 tables and `items.is_asset`
* `npm test`: 260 passed — new `test/unit/supply-chain/depreciation.spec.ts` (calendar blocks, a start inside a
  period with its closing stub, life and residual rules, even charges up to a date, rounding absorbed by the
  last period, opening balance, default start); the stock keeper test checks pieces moving with a transfer
* `npm run test:int`: 16 passed (migration count 22, new tables)
* `npm run test:e2e`: 92 passed — new `test/e2e/scm-assets.e2e-spec.ts` (fractional pieces refused, two pieces
  registered at receive, transfer and issue moving one to the department, no consumption of assets, bulk
  configuration with 10 % residual, month-end rule, preview and run with voucher, nothing due twice, no
  reconfiguration after charging, only the latest run reversed with its voucher, periods due again, piece
  detail with charges, accumulated depreciation GL balance, serial number, runs list)
* Dev server restarted with the new routes mapped
