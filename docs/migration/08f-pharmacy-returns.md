# Step 8f — Pharmacy: returns from customers

Status: **done** (2026-10-26). Previous: [step 8e](08e-pharmacy-counter-sales.md) · Next: step 8g (physical inventory;
step 8 is re-ordered: reports in 8h, indoor patients in 8i after step 9's admissions).

## Where the old logic lives

CoxBazar `Features/Pharmacy`: `ProcessOpdProductReturnCommand` (the atomic OPD return), `ReturnStockMutator`,
`Returns/PharmacyReturnPolicyFeature`, `PharmacyReturnWindowGuard`, `PharmacyReturnWindowRules` (the 19-10-2026
return period), `GeInvoiceDetailWithReturnedAmountByInvoiceIdQuery`, `GetCancelledProductsByInvoiceIdQuery`.

The old return had been made atomic and race-safe after the audits; it still took the amounts the page worked
out, wrote a stock receive of the returned goods and kept a separate duplicate-basket check. Now:

* the amounts are worked out on the server from the sale's own lines;
* the goods go back into **the lots they were sold from, at the cost they left at**;
* a second submission of the same return is refused because it carries the sale's old version (409
  `stale_sale`), replacing the duplicate-basket check;
* the return is posted to accounts in the same transaction.

## Return period (`/pharmacy/return-policies`)

One row per channel (`opd`, `ipd`): switched on or off, days (0–365). **Calendar days, inclusive** (with 7 days a
sale of the 12th comes back up to and including the 19th; 0 = the same day only), judged on the sale's own date;
a return dated before the sale is refused; switched off or not set up = no limit (old
`PharmacyReturnWindowRules`). `PUT /pharmacy/return-policies/:channel` needs `pharmacy:manage`. Over the period is
422 `return_period_over`. Indoor returns (step 8g) use the `ipd` row.

## Returns (`POST /pharmacy/sales/:id/returns`, `SR-<year>-<serial>`)

* By someone working at the sale's outlet (`pharmacy:sell`), with the sale's `version`, the date, a reason and
  lines: a sale line (1-based) and units. Never more than the line sold less what came back before (422
  `over_return`), one entry per sale line, a completed sale only.
* Each line's units are worth **its total per unit**, so the discount given on them comes back with them. Each
  return takes the line's share up to its units less its share before them, so all returns of a line add up to
  exactly its total.
* The refund **takes the sale's open due down first** (a loyal member's due: what is still owed after collections
  and earlier returns); the rest is **paid back the way the sale was paid** (cash, card or wallet).
* A line may be marked **`damaged`** (opened, broken, expired): its units are refunded all the same but **written
  off at cost** (`pharmacy_damage_loss`) instead of going back into stock.
* Stock movements `sale_return`, into the same lots at the sale line's unit cost.
* One voucher: **Dr** `pharmacy_sales` (gross) / **Cr** `pharmacy_sales_discount` (the discount taken back),
  `cash_in_hand` / `card_receipts` / `mobile_wallet_receipts` (paid back) and `pharmacy_receivable` (the due taken
  down); **Dr** `pharmacy_inventory` (restocked) and `pharmacy_damage_loss` (damaged) / **Cr** `pharmacy_cogs` at
  cost.
* The sale keeps the units returned per line and the value returned; a sale with returns can no longer be
  cancelled (422 `sale_state`), and its due for collections is what is left.

## Endpoints (under `/api/v1/pharmacy`)

| Method and path | Permission |
|---|---|
| `GET return-policies`, `GET sale-returns` (`saleId`, `outletId`, `from`, `to`, paged), `GET sale-returns/:id` | `pharmacy:read` |
| `PUT return-policies/:channel` | `pharmacy:manage` |
| `POST sales/:id/returns` | `pharmacy:sell` + works at the outlet |

## Report

`pharmacy.return-receipt` — the customer's slip on an 80 mm roll: sale it is against, medicines given back with
batch and expiry, units × rate less the discount taken back, refund, what came off the due and what was paid back.

## Not ported here

Exchanges (a return and a new purchase on one screen) are two documents: a return and a new sale. Returns of
indoor patients' medicines (return indents) come with step 8g.

## Decisions taken (after the first version of this step; migration `0031_pharmacy_return_damaged`)

* Damaged or expired units are marked on the return line and written off.
* Refunds are paid back the way the sale was paid.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0030_pharmacy_sale_returns`: 3 tables; returned units and value on sales; movement kind `sale_return`
* `npm test`: 296 passed — new `test/unit/pharmacy/return.spec.ts` (calendar days inclusive, same day, switched off,
  no row, before the sale, limits; units at the line total per unit; the rest of a line to its exact total; shares
  adding up across uneven parts; open due first; unknown and repeated lines; no cancel after returns)
* `npm run test:int`: 16 passed (migration count 31, new tables)
* `npm run test:e2e`: 110 passed — new `test/e2e/pharmacy-return.e2e-spec.ts` (policy; return refused after 10 days;
  3 Napa and 1 Seclo back for 9.42 in cash; the same submission refused as stale; over-return refused; stock back
  in the lot; sales, discount, cash and cost ledgers; sale with returned units and value; cancel refused after a
  return; return view, list and receipt; a member's due taken down by 2.28 with nothing paid back, receivable and
  dues updated, collection above the rest refused)
* Return receipt checked visually (Bangla customer name)
* Dev server restarted; readiness 200
