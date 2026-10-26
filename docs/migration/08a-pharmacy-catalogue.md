# Step 8a — Pharmacy: medicine catalogue, outlets, reorder levels

Status: **done** (2026-10-26). Previous: [step 7i](07i-scm-asset-reports.md) · Next: step 8b (pharmacy purchase
and stock).

## Where the old logic lives

CoxBazar `Core/Application/Features/Pharmacy` (≈ 220 files: `Commands`, `Queries`, `Stocks`, `Returns`,
`Discounts`, `Expiry`, `PhysicalInventory`), entities in `Core/Domain/Entities/Pharmacy`, prints in
`Web/Server/Server/PDF/Pharmacy`. The forensic reviews at the repository root (`PHARMACY_STOCK_AUDIT_FORENSIC.md`,
`PHARMACY_RETURN_AUDIT.md`, `AUDIT_ROOT_CAUSE_ANALYSIS.md`, …) describe how its stock drifted: balances and
ledgers written by separate commits, write-offs against arbitrary lots, transfers subtracted twice, reports
reading frozen figures. The new pharmacy keeps **one movement ledger per outlet and lot**, written in the same
transaction as the document, as the supply chain does (step 7c).

The pharmacy buys from the **same suppliers** as the supply chain (old `SupplyChain.Suppliers`); step 8b posts to
their payable account and party sub-ledger.

## Plan for step 8

| Step | Content |
|---|---|
| 8a | Catalogue: generic groups and generics, formations, strengths, units and package units, manufacturers, brands, products; outlets, who works at each, reorder levels; price list (this step) |
| 8b | Purchase and stock: purchase orders, stock receive into an outlet with lots (batch, expiry, purchase and sale rate), opening stock, the outlet movement ledger, posting to accounts, supplier ledger, payments and supplier returns |
| 8c | Outlet indents and transfers between outlets, with acceptance |
| 8d | Sales over the counter: invoices, discount rules, loyal members, payments and dues, cancellations, expiry guard |
| 8e | Returns: OPD returns with the return window, return to stock |
| 8f | Indoor patients: medicine indents for admitted patients, IPD sale and returns, IPD dues (needs the hospital admission from step 9; may move after it) |
| 8g | Physical inventory and stock audit |
| 8h | Reports: product ledger, stock, purchase, sale and audit reports, receipts |

## Model

| New table | Old table | Notes |
|---|---|---|
| `pharmacy_generic_groups` | `Groups` | Name unique ignoring case, information text. |
| `pharmacy_generics` | `Generics` | Under an optional group. |
| `pharmacy_formations` | `Formations` | With the short form printed before the brand (`Tab.`, `Syp.`). |
| `pharmacy_strengths`, `pharmacy_units`, `pharmacy_package_units`, `pharmacy_manufacturers` | `Strengths`, `Units`, `PackageUnits`, `Manufacturers` | A name, unique ignoring case. |
| `pharmacy_brands` | `BrandNames` | Under a manufacturer; unique per manufacturer (two manufacturers may share a brand name). The old `SubCategoryId` is not ported. |
| `pharmacy_products` | `BrandExtensions` | Brand, generic, formation, optional strength, the unit sold by and the pack bought in (old free text `Unit` / `PkgUnit` become the unit masters), units per pack (1–10,000), purchase and sale price, barcode (unique), active flag. **One product per brand, formation and strength** (a missing strength counts as one value). The old `TurnOver` is not ported. |
| `pharmacy_outlets` | `MedicineOutlets` | Name and code unique ignoring case, description, active flag. |
| `pharmacy_outlet_users` | `PharmacistDutyOutlets` | Who works at an outlet (sells, receives, transfers there from step 8b on). |
| `pharmacy_reorder_levels` | `ROLRecords` | Reorder level of a product at an outlet (one per pair; the old table used an integer outlet id). |

Deleting a record in use is refused (409 `<record>_in_use`); unknown references are 404 (`generic_not_found`,
`brand_not_found`, …); duplicates are 409 (`brand_name_taken`, `product_exists`, `product_barcode_taken`,
`outlet_code_taken`, `outlet_user_exists`, `reorder_level_exists`).

## Catalogue

`GET /pharmacy/catalogue` (paged; `q` searches brand, generic and barcode; `genericId`, `manufacturerId`,
`formationId`, `isActive`) returns each product with its names put together, as the old `BrandDetails` view did:
`displayName` "Tab. Napa 500 mg" (formation short form, brand, strength), generic and its group, manufacturer,
unit and pack, units per pack, prices, barcode.

## Report

`pharmacy.price-list` — "Medicine price list": active products (or all) by generic group and generic, with
manufacturer, pack ("Box of 100 Pcs"), purchase and sale price, barcode; filters `manufacturerId`, `genericId`,
`includeInactive`. PDF and Excel.

## Endpoints (under `/api/v1/pharmacy`; read `pharmacy:read`, write `pharmacy:manage`)

| Path | Filters |
|---|---|
| `generic-groups`, `generics` | `groupId`, `q` |
| `formations`, `strengths`, `units`, `package-units`, `manufacturers` | `q` |
| `brands` | `manufacturerId`, `q` |
| `products` | `brandId`, `genericId`, `formationId`, `isActive`, `barcode` |
| `outlets` | `isActive` |
| `outlet-users` | `outletId`, `userId` |
| `reorder-levels` | `outletId`, `productId` |
| `GET catalogue` | see above |

## Old → new routes

| Old | New |
|---|---|
| `AddEditGenericCommand`, `GetAllGenericsQuery`, `AddEditPharmacyItemGroupCommand`, `GetAllGroupsQuery` | `/pharmacy/generics`, `/pharmacy/generic-groups` |
| `AddEditFormationCommand`, `AddEditStrengthCommand`, `AddEditUnitCommand`, `AddEditPackageUnitCommand`, `AddEditManufacturerCommand` and their `GetAll…` | `/pharmacy/formations`, `strengths`, `units`, `package-units`, `manufacturers` |
| `AddEditBrandNamesCommand`, `GetAllBrandNamesQuery` | `/pharmacy/brands` |
| `AddEditPharmacyItemCommand` (`AddEditBrandExtensionCommand`), `GetAllBrandExtensionsQuery` | `/pharmacy/products` |
| `GetAllBrandDetailsQuery`, `GetBrandDetailsSummaryListQuery`, `GetProductsQuery` | `GET /pharmacy/catalogue` |
| `AddEditMedicineOutletCommand`, `GetAllMedicineOutletQuery` | `/pharmacy/outlets` |
| `AddEditPharmacistDutyOutletCommand`, `DeletePharmacyDutyOutletsCommand`, `GetAllPharmacyDutyOutletDetailsQuery` | `/pharmacy/outlet-users` |
| `AddEditROLRecordCommand`, `GetROLRecordByIdQuery` | `/pharmacy/reorder-levels` |
| Product discount settings, return policies, invoice types | steps 8d and 8e |

## Open questions

1. Should products also carry a reorder level for the whole hospital (as the old `BrandDetails.ROL`), or only per
   outlet?
2. The old brand had a supply chain sub-category; is it used for anything (reports, accounts)?
3. Should the price list be printable per outlet with stock (that comes with step 8b)?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* Migration `0024_pharmacy_catalogue`: 12 tables
* `npm test`: 270 passed; `npm run test:int`: 16 passed (migration count 25, new tables)
* `npm run test:e2e`: 100 passed — new `test/e2e/pharmacy-catalogue.e2e-spec.ts` (brand names per manufacturer,
  one product per brand, formation and strength including no strength, barcode unique, unknown generic 404,
  catalogue search by brand, generic and barcode with display names, manufacturer filter, inactive products,
  generic in use, price list in Excel and PDF; outlets with unique codes, outlet users, reorder levels, read-only
  pharmacist refused)
* Price list checked visually (Bangla product name)
* Dev server restarted with the pharmacy routes mapped; readiness 200
