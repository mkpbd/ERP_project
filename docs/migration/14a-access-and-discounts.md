# Step 14a — Data migration gaps: users' outlets and stores, corporate discounts

Status: **done** (2026-10-31). Previous: [step 13g](13g-cut-over-runbook.md) · Next: step 14b (the rest of the
clinical history).

Step 13's notes left some setup to do by hand on the cut-over night. This step brings over the parts the old
system kept, so the morning after the cut-over:

* pharmacists can sell from their outlets;
* store users can indent and issue as before;
* corporate patients get their discount.

```
ETL_SOURCE_URL=… npm run etl -- [--dry-run] [--only=pharmacist-outlets,corporate-discounts]
```

These loaders need no cut-over day. They run with everything else, or on their own after it.

## What comes over

| Old | New | How |
|---|---|---|
| `Pharmacy.PharmacistDutyOutlets` | outlet users | Who sells from and receives into each outlet |
| `SupplyChain.StoreDeptUserAccesses` | store department users | The old comma-separated list of departments per user, one grant each |
| `SupplyChain.DeptStoreAcesses` | department store access | Which sub-store a user indents from for a department |
| `SupplyChain.IssueStoreAcesses` | issue store users | Who issues from each sub-store |
| `Diag.DiscountGroups` / `DiscountGroupDetails` of `Marketing.CorporateClients` | the client's discount | See the discount rules below |

**Access lists:**

* A grant whose user, outlet, department or store did not come over is rejected and named in the report, e.g.
  `user_not_brought`.
* A grant that exists already is kept.

**Corporate discounts.** The old system discounted a corporate client's people **per test**: a discount group with a
percent or an amount for each test. Here a client has **one discount** on its people's bills.

* A client whose group gives **every test the same percent** gets that percent.
* A client with **several percents or discounts by amount** keeps none and is listed in the report ("2 different
  percents (10, 15) per test … set its discount by hand").
* A discount already set here is not changed.

## Decisions ("next" without answers after step 13; what would otherwise be set by hand at the cut-over)

1. **The old access lists come over**, so the morning after the cut-over works as the day before.
2. **A corporate discount is brought only when it is unambiguous** (one percent for every test). A guess (the most
   common percent, an average) could over- or under-charge a company's people, so the rest are listed to decide.
3. **Old pharmacy reorder levels (`Pharmacy.ROLRecords`) are not brought.**
   * The old rows name the outlet by a number that matches none of the outlets (their ids are Guids), so they cannot
     be placed.
   * Reorder levels are set here per outlet.
   * The store items' reorder levels came over with the items (13d).

## Not done here

* **Canteen outlets' sellers.** Set up here with the canteen outlets.
* **Pharmacy discount settings, loyal members, return policy.** Set up here.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. No new migration.
* `npm test`: 433 passed.
* `npm run test:int`: 16 passed.
* `npm run test:e2e`: 164 passed. `test/e2e/data-migration.e2e-spec.ts` covers:
  * **Pharmacist outlets:** a pharmacist on their outlet; one whose user did not come over rejected.
  * **Store access:**
    * a store user's comma-separated departments (one not brought, rejected);
    * their department's sub-store;
    * an issuer of a sub-store.
  * **Corporate discounts:** one client given its single 10 %; one with two percents listed to set by hand.
  * **Re-run:** nothing written twice.
* Dev server restarted; readiness 200.
