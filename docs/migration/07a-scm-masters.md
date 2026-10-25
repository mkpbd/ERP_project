# Step 7a — Supply chain: stores, item catalogue, suppliers

Status: **done** (2026-10-25). Previous: [step 6d](06d-accounts-pf-book.md) · Next: step 7b (purchase cycle).

## Where the old logic lives

The supply chain was ported from Bellevue to FAK (`FouadAlKhateeb_API_V5/database/SchemaMap.md`: 52 tables,
57 procedures in schema `[SupplyChain ]`, with a trailing space). The API repository only has the 38 core
entities; the live Blazor application **`FouadAlKhateeb_CoxBazar`** (same database `FAK_Cox_DB`) has the
full module: supplier returns, sub-store to main store transfers, supplier ledger, PR indents, department stock,
gate passes and fixed assets. Step 7 follows the CoxBazar code and the procedures in
`FouadAlKhateeb_API_V5/database/StoredProcedures.sql`.

Stock in the old system is worked out from the movement tables each time (`FnGetBrandExtensionCurrentStock`,
`SpGetBrandExtensionCurrentStock*`): opening quantity + receives − transfers − issues ± returns. Step 7c keeps
one stock movement ledger instead.

## Plan for step 7

| Step | Content |
|---|---|
| 7a | Stores, store departments and access, item catalogue, suppliers (this step) |
| 7b | Purchase cycle: PR indent, purchase requisition and approval levels, comparative study and its approval, purchase order (with advances), GRN and faults, stock receive with lots, supplier ledger and posting to accounts |
| 7c | Store operations and stock: opening stock, store indents and approval, main → sub-store transfer, issue to departments, department consumption / return / adjustment, sub-store → main return, supplier returns and replacements, gate pass, drafts; one stock movement ledger with lots and expiry |
| 7d | Fixed assets: asset items per piece, depreciation profiles and runs, maintenance and warranty, discard and scrap sale |
| 7e | Reports: stock (main / sub-store, date-wise), purchase statements, issue reports, expired stock, comparative study, indents |

Reagent test mappings (`ReAgentTestMapping`, `TestConsumptionMapping`) come with diagnostics in step 10.

## Model

| New table | Old table | Notes |
|---|---|---|
| `main_stores` | `MainStores` | Name unique ignoring case. |
| `sub_stores` | `Stores` | Under a main store; name unique. |
| `store_departments` | `StoreDepts` | The departments that indent and receive issues. Kept apart from HR departments, as in the old system. |
| `store_department_users` | `StoreDeptUserAccesses` | One row per user and department (the old table kept a comma-separated list). |
| `department_store_access` | `DeptStoreAcesses` | Which sub-store a user indents from for a department. |
| `issue_store_users` | `IssueStoreAcesses` | Who may issue from a sub-store. |
| `item_categories` → `item_sub_categories` | `ParentCategories` → `SubCategories` | |
| `item_groups` → `item_sub_groups` | `Groups` → `SubGroups` | |
| `items` | `BrandNames` | Item (e.g. "A4 paper") under a sub-group and a sub-category, with unit and **item type** = the inventory GL account its purchases post to (old `ItemTypeId`, a `GeneralLedgers` row: Disposable / Consumable / Reusable / Fixed asset). |
| `item_variants` | `BrandExtensions` | What is stocked and bought: name, code / part number (unique ignoring case), alternate name, specification, purchase and sale price, reorder level, whether an expiry date is required. The old `OpeningQty` / `OpeningDate` become opening stock entries per store (7c). The attached image is not ported yet. |
| `role_group_restrictions` | `RoleGroupRestrictions` | Item groups hidden from a role in stock lists. |
| `supplier_types`, `suppliers` | `SupplierTypes`, `Suppliers` | Supplier: type, contact, e-mail, enlistment and its expiry (not before it starts), VAT and tax %, manufacturer flag, payable GL account (old `GLId`) and its **party sub-ledger** in accounts (one supplier per sub-ledger), active flag. The old `ManufacturerId` is not ported (it pointed at the pharmacy's manufacturers). |

Deleting a record in use is refused (409 `<record>_in_use`); unknown references are 404
(`main_store_not_found`, `item_sub_group_not_found`, `gl_account_not_found`, `user_not_found`, …).

Lists of items, variants and suppliers take `q` (search in name, code, alternate name or contact number,
case-insensitive; `%` and `_` are literal). This is a new option of the shared record store.

## Endpoints (under `/api/v1/scm`; read `scm:read`, write `scm:manage`)

| Path | Filters |
|---|---|
| `main-stores`, `sub-stores` | `mainStoreId` |
| `departments`, `department-users`, `department-store-access`, `issue-store-users` | `departmentId`, `subStoreId`, `userId` |
| `item-categories`, `item-sub-categories`, `item-groups`, `item-sub-groups` | `categoryId`, `groupId` |
| `items` | `subGroupId`, `subCategoryId`, `isActive`, `q` |
| `item-variants` | `itemId`, `isActive`, `q` |
| `role-group-restrictions` | `roleId`, `groupId` |
| `supplier-types`, `suppliers` | `typeId`, `isEnlisted`, `isManufacturer`, `isActive`, `q` |

Each has `GET` (list), `GET /:id`, `POST`, `PATCH /:id`, `DELETE /:id`.

Reports: `scm.item-catalogue` (PDF, Excel; optional group), `scm.suppliers` (PDF, Excel; enlisted only).

## Old → new routes

| Old controller | New |
|---|---|
| `MainStore`, `Store` | `/scm/main-stores`, `/scm/sub-stores` |
| `StoreDept`, `StoreDeptUserAccess` (`GetStoreDeptUserAccessByUserId`) | `/scm/departments`, `/scm/department-users?userId=` |
| `DeptStoreAcess` (`GetDeptStoreAcessByUserId`) | `/scm/department-store-access?userId=` |
| `IssueStoreAcess` (`GetIssueStoreAcessByUserId`) | `/scm/issue-store-users?userId=` |
| `ParentCategory`, `SSubCategory`, `SGroup`, `SubGroup` | `/scm/item-categories`, `/scm/item-sub-categories`, `/scm/item-groups`, `/scm/item-sub-groups` |
| `BrandName` (`GetBrandNameById`) | `/scm/items` |
| `SBrandExtension` (`GetBrandExtensionByGroupId`) | `/scm/item-variants?itemId=` (by sub-group: list the sub-group's items first) |
| `SupplierType`, `Supplier` | `/scm/supplier-types`, `/scm/suppliers` |
| Approval settings (`SCMPurchaseApprovalSetting`, `StoreIndentApprovalSetting`, `CSApprovalSetting`) | with their workflows in 7b and 7c |
| `ReAgentTestMapping` | step 10 |

## Open questions

1. Should store departments be the HR departments (one list) instead of a separate list?
2. Is a supplier's payable account per supplier (old `GLId`) still wanted, or one "trade payables" account with a
   sub-ledger per supplier (then `glAccountId` can go)?
3. Item images (`AttachedImage`): needed? They would be stored like staff files.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* Migration `0016_supply_chain_masters`: 15 tables
* `npm test`: 222 passed
* `npm run test:int`: 16 passed (migration count 17, new tables)
* `npm run test:e2e`: 81 passed — new `test/e2e/supply-chain.e2e-spec.ts` (stores, duplicate names, store in use,
  department users and store access, unknown user; catalogue with duplicate sub-group, unknown sub-group and GL
  account, variant code clash ignoring case, negative price, search by name / code / literal `%`, group in use,
  role group restriction; suppliers with sub-ledger clash, enlistment dates, VAT over 100, filters, both
  reports in PDF and Excel; permissions)
* Visual check of the item catalogue and supplier list (Bangla names, lakh grouping); dev server restarted with
  the new routes mapped
