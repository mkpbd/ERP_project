# Step 12a — Canteen: the menu, sales, members' dues

Status: **done** (2026-10-30). Previous: [step 11e](11e-patient-portal.md) · Next: [step 12b](12b-marketing.md).

Step 12 is split:

| Part | Scope |
|---|---|
| **12a** (this step) | Canteen |
| 12b | Marketing |
| 12c | Others: health tips, notices, chat |
| 12d | Activity log |

What this step adds, in a new `canteen` module:

* **The menu.** Groups and items, each with a general rate, a staff rate, VAT and a unit.
  * A **packaged item** names a store item of the supply chain and how much of it one unit uses.
  * **Cooked food** names none.
* **Outlets.** Each names the store department its packaged goods come from, and **who sells there**.
* **Members** who may eat on credit.
* **Sales** at an outlet:
  * to a walk-in customer, a staff member (staff rates) or a member (who may leave a due);
  * VAT per line, a discount, cash paid with change;
  * posted to the ledger;
  * packaged goods used up from the outlet's store department.
* **Cancelling a sale** the same day (later, by the manager).
* **Members' dues:** collections and a statement.
* **Prints:** the receipt (80 mm), sales by item, member dues.

## Where the old logic lives

CoxBazar, `Canteen` (`src/Core/Domain/Entities/Canteen/`):

* **Menu:** `CanteenGroup`; `Item` (purchase, production, staff and general rates, VAT %, code, unit).
* **Outlets:** `CanteenOutlet`; `SalesmanDutyOutlet` (who sells where).
* **Stock:**
  * `StockReceiveRecord` / `Detail` (items received per outlet from a supplier);
  * `CanteenStockTransfer` (between outlets);
  * `RawItem`, `RawItemStockReceive`, `RawItemIssue` / `Detail` (ingredients received and issued to the kitchen);
  * `ViewStock`.
* **Sales:** `SaleInvoice` / `SaleInvoiceDetails` (outlet, customer type, UHID, member, staff, IPD patient, VAT,
  discount, received, change, due, cancel reason); `SaleLedger` (payment channel, POS terminal).
* **Members:** `LoyalMember`, `LoyalMemberLedger`, `MemberDueCollectionInvoice`.
* **Patients' food:** `IPDFoodIndent` / `Detail`. The patients' diets are now the nutrition module (step 11d).

## Decisions (step 11e's open questions; "next" without answers, so the recommendations)

1. **Step 12 is split** into 12a canteen, 12b marketing, 12c others, 12d activity log. The canteen is first.
2. **The supply chain keeps all the stock.**
   * The canteen keeps no stock tables. Its receive, transfer and raw-item tables are not ported: the supply chain
     already buys, receives, stores and issues, ingredients included.
   * A packaged item names its store item (`stockVariantId`, `stockQty` per unit sold).
   * A sale uses those up from the outlet's store department through the existing **`DepartmentStock`** contract,
     like the lab's reagents (step 10e).
   * When the department holds too little, nothing is taken. **The sale stands, marked short** (`stockShort`), to be
     put right in the store.
   * Cooked food uses nothing at sale. The kitchen's ingredients are department consumptions in the supply chain.
3. **Nutrition menus stay text** (step 11d), not linked to canteen items.
4. **Marketing** (12b): agents, zones, areas, targets; referral commissions stay with the hospital.
5. **Activity log** (12d): an audit viewer and sign-in history.

Other decisions:

* **Customers:** walk-in, staff or member.
  * **Staff** is a staff record (through `StaffDirectory`), charged the staff rate; their name is copied.
  * **A member** is a canteen member. **Only a member may leave a due.** Anyone else pays it all; more than the bill
    is change, never kept.
* **Totals.**
  * Each line is qty × rate, with VAT at the item's rate on the line.
  * The discount comes off the gross: net = gross − discount + VAT.
  * Quantities go to 3 decimals.
* **Books.**
  * A sale posts: Dr cash in hand (paid), Dr canteen member receivable (due) / Cr canteen sales (gross − discount), Cr
    VAT payable.
  * A collection posts: Dr cash / Cr member receivable.
  * New roles: `canteen_sales`, `canteen_vat_payable`, `canteen_member_receivable`.
* **Selling.** Only at an outlet one is assigned to (`not_your_outlet`), unless `canteen:manage`.
* **Cancelling.**
  * The seller cancels on the sale's day; another day's sale needs `canteen:manage`. A reason is needed.
  * The money is reversed. Packaged goods already used up stay used up (a return is entered in the store).
  * A member sale whose due the member has paid towards is not cancelled (`due_collected`).
* **A member pays** at most what they owe. Their balance is the dues of sales not cancelled less what they paid.
* **Numbering:** sales `CS-<year>-00001`, collections `CC-<year>-00001`.

## API (`/api/v1/canteen`)

| Endpoint | Who | What |
|---|---|---|
| `GET` / `POST` / `PATCH` `groups`, `items`, `outlets`, `members` | `canteen:read` / `canteen:manage` | Menu, outlets (`storeDepartmentId`), members |
| `GET` / `PUT` `outlets/:id/users` | `canteen:read` / `canteen:manage` | Who sells at the outlet (whole list) |
| `POST sales` | `canteen:sell` | `outletId`, `customerKind`, `staffId` / `memberId`, `lines`, `discount`, `paid` → number, net, due, change, stock used / short / none |
| `GET sales`, `GET sales/:id` | `canteen:read` | By outlet, member, days, state; one sale with its lines |
| `POST sales/:id/cancel` | `canteen:sell` (the day) / `canteen:manage` | `version`, `reason` |
| `GET members/:id/statement`, `POST members/:id/collections` | `canteen:read` / `canteen:sell` | The member's dues and payments; a payment |

## Reports

* **`canteen.receipt`** (`saleId`), 80 mm. It shows:
  * the outlet, number, time and customer;
  * the lines;
  * total, discount, VAT, net, paid and due;
  * "CANCELLED" on a cancelled sale.
* **`canteen.item-sales`** (`from`, `to`, `outletId`?): quantity, amount and VAT per item by group, cancelled sales
  left out. PDF and Excel.
* **`canteen.member-dues`**: members owing, most owed first. PDF and Excel.

## Not ported here

* **The canteen's own stock:** receive, transfer, raw items, stock view. These are the supply chain's (decision 2).
* **Purchase and production rates on items.** Costs are the store's.
* **Meals for admitted patients on the canteen** (`IPDFoodIndent`, `ServType`, `MealType`, `FoodPatternName`). These
  are nutrition's (step 11d); patients' meals are not sold.
* **Payment channels and POS terminals on canteen sales.** Cash only.
* **The daily serial number.**

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
  * The canteen uses up stock only through `DepartmentStock` and reads staff only through `StaffDirectory`.
* Migration `0054_canteen`: 9 tables.
* `npm test`: 396 passed. New: `test/unit/canteen/sale.spec.ts` covers:
  * **Pricing:**
    * general and staff rates;
    * VAT and discount;
    * only a member leaves a due.
  * **Refused:** items not sold, odd quantities, too large a discount, no lines.
  * **Stock:** packaged goods added up per store item; cooked food uses none.
* `npm run test:int`: 16 passed (migration count 55, new tables).
* `npm run test:e2e`: 151 passed. New: `test/e2e/canteen.e2e-spec.ts` covers:
  * **Setup:**
    * the menu kept by `canteen:manage`;
    * an unknown store item refused;
    * the outlet with its store department and seller.
  * **Selling:**
    * not at another's outlet;
    * a walk-in sale with VAT, discount and change, juice used up from the store;
    * a walk-in due refused;
    * a member sale on credit marked short when the store has too little;
    * the sale view.
  * **Dues:**
    * overpaying refused;
    * a payment;
    * the statement;
    * a member sale with dues paid not cancelled.
  * **Cancelling:**
    * the walk-in sale cancelled by its seller (not another's);
    * twice refused;
    * the cancelled list.
  * **Books:** cash, receivable, sales and VAT closings.
  * **Reports:** sales-by-item sheet, receipt and member dues PDFs.
* **Visual check** of the receipt (screenshot).
* Dev server restarted; readiness 200.
