# Step 7i — Supply chain: asset reports and labels

Status: **done** (2026-10-26). Previous: [step 7h](07h-scm-stock-reports.md) · Next: [step 8a](08a-pharmacy-catalogue.md) (Pharmacy). This
closes step 7 (supply chain).

## Where the old logic lives

CoxBazar `Components/Pages/SupplyChain`: `FixedAssetRegisterPage`, `AssetDepreciationReportsPage` (tabs Summary,
Schedule, Monthly, History), `WarrantyMaintenanceDashboardPage`, `AssetDashboardPage`; prints
`PDF/SupplyChain/PrintAssetLabelDocument` and `PrintAssetStickerDocument` (Code 39 barcodes drawn with SkiaSharp).

## Reports

| Key | Title | Parameters | What it shows |
|---|---|---|---|
| `scm.asset-register` | Fixed asset register | `asOf` (default today), `groupId?`, `departmentId?`, `includeGone` (default no) | Every piece acquired by `asOf`, by item group: asset number, item, serial number, where it is, status, acquired on, source document and supplier, cost, depreciation charged by `asOf` (opening balance and every charge with a period end by then), book value; group and grand totals. Written-off, sold and returned pieces only on request. Landscape. |
| `scm.depreciation-schedule` | Depreciation schedule | `from`, `to`, `groupId?` | Per depreciating piece: cost, brought forward (before `from`), charge in the period, carried forward, book value; the period's charge by month and by the department the piece was in when charged (old "Department at posting"). Pieces gone before the period with no charge in it are left out. Landscape. |
| `scm.maintenance-register` | Maintenance register | `from`, `to`, `status?`, `serviceType?` | Every piece on a service request raised in the period: request and date, who it went to and the gate pass, the asset, warranty or maintenance, problem, state (waiting approval, out, back with the date, dropped, rejected), expected and actual cost, the voucher that booked it; totals and how many are still out. Landscape. |
| `scm.asset-stickers` | Asset stickers | `assetIds[]` (1–500) or `sourceDocumentId` (a receive or opening stock) | Code 39 barcode stickers, three to a row on A4, with the asset number and item. |
| `scm.asset-labels` | Asset labels | as above | One barcode label per 60 × 37 mm page (old 170 × 105 pt) for a label printer. |

Give either the pieces or the document they came in on (400 otherwise). Barcodes are inline SVG from
`src/shared/infrastructure/reports/code39.ts` (no image library; the same character table as the old code), so they
stay sharp at any print size; pharmacy labels can use the same helper.

The register and the schedule read the depreciation entries, so a reversed run (its entries removed) is not
counted, and a disposal charge is counted in its period.

## Not ported (open questions)

1. The asset and warranty dashboards (counts and charts): screens for the front end over `GET /scm/fixed-assets`
   and the asset documents; is a printed dashboard wanted?
2. The register shows today's status and place for every piece; a piece's place on a past date is not kept (only
   the department charged with each depreciation). Is a history of moves needed beyond the stock ledger?
3. Should labels carry a QR code (link to the piece) instead of, or as well as, Code 39?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 270 passed — new `test/unit/shared/code39.spec.ts` (bar layout and width, start character, refused
  characters, SVG)
* `npm run test:int`: 16 passed
* `npm run test:e2e`: 98 passed — new case in `test/e2e/scm-asset-requests.e2e-spec.ts` reading the Excel output:
  register as of February (3 × 120,000 cost, 3,600 charged), written-off pieces left out unless asked, book value
  115,470.97 for the one written off; schedule February–March with 2,729.03 charged to the written-off piece (16
  days of March); maintenance register with gate pass, expected 1,000 and actual 1,250; stickers and labels by
  receive and by piece, and refused without either
* All five PDFs checked visually (Bangla item and party names, barcodes on the sticker sheet and the label)
* Dev server restarted; readiness 200
