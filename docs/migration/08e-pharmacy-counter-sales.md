# Step 8e — Pharmacy: counter sales, discounts, loyal members and dues

Status: **done** (2026-10-26). Previous: [step 8d](08d-pharmacy-outlet-transfers.md) · Next: [step 8f](08f-pharmacy-returns.md) (returns
from patients).

## Where the old logic lives

CoxBazar `Features/Pharmacy`: `CreatePharmacySaleCommand` and `Invoices/CreatePhInvoiceCommand` (the OPD invoice
with `InvoiceDetails`, `InvoiceLedgers`, loyal member and staff ledgers), `UpdateInvoicePaymentCommand`,
`UpdateInvoiceDiscountCommand`, `Discounts/PharmacyDiscountRules` and `PharmacyDiscountCommands` (the 19-10-2026
per-product discounts), `Expiry/PharmacySaleExpiryGuard`, `AddEditPLoyalMemberCommand`,
`AddEditPLoyalMemberLedgerCommand`, `GetPLoyalMemberDueByLoyalMemberIdQuery`; prints
`PrintPharmacyInvoiceRecieptDocument`, `PrinLoyalMemberDueRecieptDocument`.

What changes:

* The old invoice was saved from figures the page worked out (the discount rules were then re-checked on save).
  Now the server works out everything from the stock and the rules; `POST /pharmacy/sales/quote` shows the figures
  before selling.
* The old stock rows were decremented by separate commands; the lots were the page's choice and expired lots
  could be sold until the expiry guard (2026-10-19). Now the lots are taken **first expiring first, never an
  expired lot**, under a lock on the outlet's products, in the same transaction as the sale.
* The old invoice was posted to accounts later, if at all (`IsPostedToAccount`). Now the sale posts its voucher.

## Discounts

* **Policy** (`GET`/`PUT /pharmacy/discount-policy`, one row; `pharmacy:manage`): discountable by default or not,
  the over-the-counter (OPD) percent, the indoor (IPD) percent or "same". Without a policy the old flat 5 % applies.
* **Product rules** (`/pharmacy/product-discounts`, record type): a product discountable or not, its own OPD and
  IPD percents (none = the policy's; IPD none = the same as OPD).
* A line's discount = its amount × percent, rounded to the paisa; lines are worked out on their own (old
  `PharmacyDiscountRules`). Indoor sales (step 8g) use the IPD percent.

## Loyal members (`/pharmacy/loyal-members`, record type)

Name, contact number (unique), reference, remarks, active flag. Only a loyal member may leave a due.

## Sales (`/pharmacy/sales`, `SI-<year>-<serial>`)

* By someone working at the outlet (`pharmacy:sell`): date, customer name and mobile, optional loyal member,
  lines (product, units, optionally a lot), payment method (`cash`, `card`, `mobile`), reference, and what was
  handed over (`tendered`).
* Each lot part sells at the **lot's sale rate** less the product's discount. Paid = the tendered amount up to the
  total; cash beyond the total is **change**; a card or wallet is not charged beyond the total (422 `overpaid`).
  What is left is a **due**, only for an active loyal member (422 `due_needs_member`).
* One voucher: **Dr** `cash_in_hand` / `card_receipts` / `mobile_wallet_receipts` (what is paid),
  `pharmacy_receivable` (the due) and `pharmacy_sales_discount` (the discount) / **Cr** `pharmacy_sales` (gross); **Dr** `pharmacy_cogs` /
  **Cr** `pharmacy_inventory` at the lots' cost. Stock movements `sale`.
* **Cancel** (`pharmacy:manage`; or the seller, with `pharmacy:sell`, on their own sale dated the day of the sale and
  within a day of making it, else 403 `not_own_sale_today`; with a reason, not dated before the sale): only a sale nothing was collected
  against (422 `sale_state`): its lots come back at their cost (movement `sale_cancel`) and the voucher is reversed
  on the cancel date. Returning some units comes in step 8f.

## Due collection (`POST /pharmacy/loyal-members/:id/collections`, `DC-<year>-<serial>`)

An amount (`pharmacy:sell`) is set against the member's dues **oldest sale first**, never above them (422
`overpayment`), under a lock per member; **Dr** cash (card, wallet) / **Cr** `pharmacy_receivable`.
`GET /pharmacy/loyal-members/:id/dues` lists the sales still owed.

## Endpoints (under `/api/v1/pharmacy`)

| Method and path | Permission |
|---|---|
| `GET discount-policy`, `GET product-discounts`, `GET loyal-members`, `POST sales/quote`, `GET sales` (`outletId`, `loyalMemberId`, `status`, `from`, `to`, `q` number / customer / mobile), `GET sales/:id`, `GET loyal-members/:id/dues` | `pharmacy:read` |
| `PUT discount-policy`, `product-discounts`, `loyal-members` (write) | `pharmacy:manage` |
| `POST sales/:id/cancel` | `pharmacy:manage`, or the seller the same day |
| `POST sales` | `pharmacy:sell` + works at the outlet |
| `POST loyal-members/:id/collections` | `pharmacy:sell` |

## Reports

| Key | Old print | Contents |
|---|---|---|
| `pharmacy.sale-receipt` | `PrintPharmacyInvoiceRecieptDocument` | 80 mm roll receipt: medicines with batch and expiry, units × rate less discount, totals, paid, change, due, amount in words; "CANCELLED" when cancelled |
| `pharmacy.member-dues` | `PrinLoyalMemberDueRecieptDocument` | A member's unpaid sales: due at sale, collected, still due, total in words |

## Not ported here

Corporate clients, staff purchases on credit (staff ledger), doctor appointment "medicine served" status and the
prescription number are sales to parties that come with the hospital (step 9); indoor sales come in step 8g.

## Decisions taken (after the first version of this step)

* Sales are posted gross with the discount on its own account (`pharmacy_sales_discount`).
* A seller may cancel their own sale the same day.
* Cash per drawer or POS terminal comes with the cash counter report in step 8i (seller, outlet and method are kept on
  every sale).

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0029_pharmacy_counter_sales`: 7 tables, movement kinds `sale` and `sale_cancel`
* `npm test`: 290 passed — new `test/unit/pharmacy/sale.spec.ts` (policy and product rules on both channels,
  paisa rounding; totals, change and cost; due only for members; no card overpayment; cancel once with a reason;
  collection oldest first, never above the dues, in paisa)
* `npm run test:int`: 16 passed (migration count 30, new tables)
* `npm run test:e2e`: 108 passed — new `test/e2e/pharmacy-sale.e2e-spec.ts` (default policy, only managers set it;
  quote refusing the expired lot and pricing 60 + 2 units at 80.40 with a never-discounted product; due without a
  member, card overpaid and another outlet refused; cash sale with change 19.60; stock, cash, sales, cost and
  inventory ledgers; search by mobile; receipt; member sales with dues 6.40 and 5.70, collection of 8 oldest first,
  overpayment refused, receivable and cash ledgers; cancel refused after a collection and for a seller, allowed for
  a manager with stock back and cash reversed; member dues print)
* Receipt (80 mm) and member dues prints checked visually; the receipt's table font fixed
* Dev server restarted; readiness 200
