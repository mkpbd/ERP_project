# Step 13d — Data migration: catalogues, suppliers and opening stock

Status: **done** (2026-10-30). Previous: [step 13c](13c-hr.md) · Next: step 13e (open documents and dues).

```
ETL_SOURCE_URL=… npm run etl -- --cut-over=2027-01-01 [--dry-run] [--only=pharmacy-opening-stock,store-opening-stock]
```

The opening stock is **the old system's stock once it is frozen for the cut-over** (step 13g). It is dated the day
before the cut-over, like the opening balances (13b), and checked against them. Without `--cut-over` the catalogues,
stores and suppliers come over and the stock is left out (noted).

## What comes over

**Pharmacy**

| Old (`Pharmacy.*`) | New | How |
|---|---|---|
| `Groups`, `Generics` | generic groups, generics | By name; a generic without a group keeps none |
| `Formations`, `Strengths`, `Manufacturers` | the same masters | By name (formation short names kept) |
| `BrandNames` | `pharmacy_brands` | By name within the manufacturer |
| `BrandExtensions` | `pharmacy_products` | See the products rules below |
| `MedicineOutlets` | `pharmacy_outlets` | By name; a code another outlet has is left out. Pharmacists' duty outlets are not brought: give them here |
| `Stocks` | one **opening stock** (`OP-…`) per outlet | See below |

**Products:**

* Each product keeps its brand, generic, formation and strength.
* The free-text unit and pack unit become unit masters, made when new.
* Units per pack, prices, barcode and active flag are kept.
* A second old product of the same brand, formation and strength is the same product here (merged, noted).
* A barcode another product already has is left out (noted).

**Stores and supply chain**

| Old (`SupplyChain.*`) | New | How |
|---|---|---|
| `MainStores`, `Stores` | main stores, sub-stores | By name |
| `StoreDepts` | store departments | By name. Users' access lists are not brought: set them here |
| `ParentCategories`, `SubCategories`, `Groups`, `SubGroups` | item categories and groups | By name (within their parent) |
| `BrandNames` | `items` | See the items rules below |
| `BrandExtensions` | `item_variants` | Prices, reorder level, code (a code another variant has is left out), alternate name, specification, expiry requirement |
| `SupplierTypes`, `Suppliers` | supplier types, suppliers | See the suppliers rules below |
| Current stock per store | one **opening stock** (`OS-…`) per main or sub-store | See below |

**Items:**

* The old item type was an inventory GL account (13b). It becomes the item's type account.
* Types named *reusable* or *fixed asset* make **asset items**.
* An item without a unit gets `pcs`.

**Suppliers:**

* Enlistment, VAT and tax rates are kept.
* Each keeps the payable account that was theirs (old `GLId`).
* Each keeps **their sub-ledger from 13b** (old `SubLedgers.SupplierId`), so their opening balance and new purchases
  meet on one party.
* Unset old dates (`0001-01-01`) are left empty.

## Opening stock

### Pharmacy (`Pharmacy.Stocks`)

* **Source.** Each outlet's available stock by product and lot, at the lot's purchase rate and sale rate (MRP).
* **One document per outlet.** One opening stock entry per outlet, numbered like any other (`OP-2026-00001`).
* **Lots.** Lots come over by batch, expiry and sale rate.
* **Below zero.** Old rows below zero are netted per product. What the product holds stays in the lots that expire
  last. A product below zero overall holds nothing (noted).
* **Left out, with notes:**
  * expired lots, with their value;
  * lots whose expiry cannot be read;
  * products not brought over.
* **Part units** are rounded to whole units (noted).

### Stores

**Source.** The old system kept no stock table: stock was added up from receives, transfers, issues and returns in
each report, and those reports have had bugs. So the stock is read **from the old system's own current-stock
procedure**, `SpGetBrandExtensionCurrentStockBySubStore`. It takes a main store or a sub-store and is the corrected
definition of 2026-06-27. These are the numbers staff see on the old current-stock screen and can sign off.

**The read-only login needs `EXECUTE`** on that procedure.

**How it is turned into opening stock:**

* **Below zero.** Issues and transfers were counted without their lot, so a variant's rows are netted. The stock
  stays in its last-expiring lots, as for the pharmacy.
* **Lots.** Old lot expiry text is read in its several formats: `2027-03-31`, `31/03/2027`, `31-Mar-2027`,
  `03/2027`, and others. A month alone expires on its last day.
* **Unit cost.** The variant's **last receive rate**, or its purchase price when it was never received.

**Left out, with notes:**

* **asset items**, which are registered piece by piece as fixed assets: register them here;
* expired lots;
* stock below zero;
* variants not brought over.

**Several main stores.** When there is more than one, the old procedure counts the variants' opening quantities at
each, and the report says to check them.

### The check against the books

The opening stock's value is compared with the inventory account on the same day, in the books opened in 13b, and the
report says whether they agree:

* pharmacy stock against the `pharmacy_inventory` posting account;
* store stock per item type account.

A difference is reported, not refused. The old books were not always posted from stock, so it is for the accountants
to clear with an adjustment voucher here.

## Decisions (step 13c's open questions; "next" without answers, so the recommendations)

1. **The pharmacy and store catalogues come over as they are**, matched by name.
2. **Suppliers come over with their sub-ledger** (old `SubLedgers.SupplierId`) and payable account.
3. **Opening stock is the frozen old stock per outlet and store**, by item, batch and expiry, valued at:
   * the lot's purchase rate (pharmacy);
   * the last receive rate (stores).

   It is one opening document per outlet and store. Expired lots are left out and reported.
4. **Stock value is compared with the inventory accounts** from 13b, and differences are reported.
5. **Open purchase orders, indents and requisitions are finished or cancelled in the old system before the cut-over.**
   None are brought; the runbook (13g) lists them as a freeze step.

## Not done here

* **Purchase, sale and stock history.** It stays in the old database.
* **Reorder levels per outlet, discount settings, loyal members, return policy.** Set up here, or a later run.
* **Pharmacists' duty outlets, store department and issue access lists.** User access is set up here.
* **Fixed asset register and depreciation.** Asset items with stock are reported for registration.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. No new migration.
* The ETL loaders now share `loader-kit.ts` (paging, re-run checks, named masters).
* `npm test`: 426 passed. New: `test/unit/data-migration/stock-records.spec.ts` covers:
  * expiry days in every old format, and unreadable ones;
  * stock kept in its last-expiring lots when outs had no lot;
  * a product below zero holding nothing;
  * asset item types.
* `npm run test:int`: 16 passed.
* `npm run test:e2e`: 160 passed. `test/e2e/data-migration.e2e-spec.ts` adds stock; the 13b books gain inventory
  accounts. A dry run and a real run with the same counts; a re-run writes nothing. It covers:
  * **Catalogue:**
    * a generic without a group;
    * a brand whose manufacturer did not come over;
    * a product merged into another, one rejected.
  * **Pharmacy opening (`OP-2026-00001`):**
    * the live lot only (the expired lot noted with its value);
    * a product not brought over noted;
    * value equal to the pharmacy inventory account.
  * **Store opening (`OS-2026-00001`):**
    * the variant's stock netted into its lot (batch and `31/12/2028` expiry);
    * the last receive rate;
    * the asset item left out;
    * a sub-store below zero holding nothing;
    * value equal to the item type's account.
  * **Supplier:** with their 13b sub-ledger and payable account.
* Dev server restarted; readiness 200.
