# Step 8c — Pharmacy: supplier payments and supplier returns

Status: **done** (2026-10-26). Previous: [step 8b](08b-pharmacy-purchase-stock.md) · Next: step 8d (outlet indents
and transfers).

## Where the old logic lives

CoxBazar `Features/Pharmacy/Commands/AddEdit`: `ProcessSupplierDuePaymentCommand` (payment over due invoices,
`SupplierPaymentRecords` / `Details`), `AddEditSupplierReturnIndentCommand` and `AddSupplierReturnIndentWithDetails…`,
`ProcessSupplierReturnCommand` (the return: stock out, supplier debit), `ReceiveSupplierReturnCommand`
(replacements against the return, value based, partly or fully, or closed); prints
`PrintSupplierPaymentReceiptDocument`, `PrintSupplierReturnIndentDocument`, `PrintSupplierReturnReceiveDocument`.

The old payment and return commands had already been rewritten as single transactions after the audits; the
new ones keep their rules and replace the pharmacy's own supplier ledger table with **vouchers on the supplier's
sub-ledger in accounts** (shared with the supply chain).

## Supplier payments (`/pharmacy/supplier-payments`, `SP-<year>-<serial>`)

* One payment pays one or more **posted** receives of one supplier, in cash or from a bank account (a GL account).
* Under a lock per supplier, each receive's due is worked out afresh: its total less what earlier payments paid of
  it. An amount must be more than 0 and not above that (422 `overpayment`); another supplier's receive, a draft or
  an unknown one is 422 `not_payable`; a receive twice is 422 `duplicate_line`.
* Posted **Dr the supplier's payable** (its account or the `supplier_payable` role) **on its sub-ledger / Cr
  `cash_in_hand`** or the bank account. A bank payment names the account, a cash payment does not (422
  `invalid_payment`).
* `GET /pharmacy/supplier-dues?supplierId=` lists the posted receives with something still due (total, paid, due).
* The payment keeps, per receive, the due before and the amount paid.

## Supplier returns (`/pharmacy/supplier-returns`, `RT-<year>-<serial>`)

* **Draft** at an outlet the user works at: supplier, date, reason, and lots with units (the product follows from
  the lot; one line per lot). Edit or delete while a draft.
* **Send**: the products are locked for the outlet; each lot must still hold the units (422 `insufficient_stock`);
  they leave stock (movement `supplier_return`) at the **lot's cost at the outlet** (weighted average of what came
  in), which is frozen on the line. The value is posted **Dr the supplier's payable / Cr `pharmacy_inventory`**:
  the supplier now owes it.
* **Settle** with replacement goods, the same products or others, in as many parts as needed: lines with units,
  purchase rate, sale rate, batch and expiry come into stock in their lots (movement `replacement`) at the purchase
  rate, posted **Dr `pharmacy_inventory` / Cr the supplier's payable**. Never above what is still owed (422
  `over_settlement`); status `partly_settled`, then `settled`.
* **Close** (with a reason) a sent or partly settled return: what was not replaced stays on the supplier's
  ledger, to be set off against payments.

## Also in this step (answers to step 8b's questions)

* **Bonus units** on receive lines (`bonusQty`): they go into stock with the paid units and share the line cost
  (the unit cost is the line total over all units, to 4 decimals); the supplier is owed for the paid units only;
  the purchase order counts the paid units.
* Posting a receive sets the product's **sale price** as well as its purchase price from the line.
* Purchase orders stay without approval.

## Endpoints (under `/api/v1/pharmacy`)

| Method and path | Permission |
|---|---|
| `GET supplier-dues?supplierId=`, `GET supplier-payments` (`supplierId`, `from`, `to`, paged), `GET supplier-payments/:id` | `pharmacy:read` |
| `POST supplier-payments` | `pharmacy:payment` |
| `GET supplier-returns` (`supplierId`, `outletId`, `status`, paged), `GET supplier-returns/:id` | `pharmacy:read` |
| `POST supplier-returns`, `PATCH`/`DELETE supplier-returns/:id`, `POST supplier-returns/:id/send`, `/settle`, `/close` | `pharmacy:receive` + works at the outlet |

## Reports

| Key | Old print | Contents |
|---|---|---|
| `pharmacy.supplier-payment` | `PrintSupplierPaymentReceiptDocument` | Payment header (cash or bank, reference, voucher), receives with due before, paid and due after, total in words |
| `pharmacy.supplier-return` | `PrintSupplierReturnIndentDocument`, `PrintSupplierReturnReceiveDocument` | Lots returned at cost, replacements received, what the supplier still owes |

## Old → new routes

| Old | New |
|---|---|
| `ProcessSupplierDuePaymentCommand`, `GetSupplierDueInvoicesQuery`, `GetSupplierPaymentRecordsQuery` | `POST /pharmacy/supplier-payments`, `GET supplier-dues`, `GET supplier-payments` |
| `AddEditSupplierReturnIndentCommand`, `AddEditSupplierReturnIndentDetailCommand`, `AddSupplierReturnIndentWithDetailsCommand`, `GetSupplierReturnIndentBy…` | `/pharmacy/supplier-returns` (draft) |
| `ProcessSupplierReturnCommand` | `POST supplier-returns/:id/send` |
| `ReceiveSupplierReturnCommand`, `GetSupplierReturnSettlementQuery` | `POST supplier-returns/:id/settle`, `/close` |
| `AddEditSupplierLegerCommand` | vouchers on the supplier's sub-ledger |

## Open questions

1. The receipt prints "Bank" and the reference (cheque number), not the bank account's name: the pharmacy may not
   read the accounts tables. Should accounts publish the account name through a contract?
2. Should a closed return's remaining value be refundable in cash by the supplier (a receipt voucher), or is set-off
   against payments enough?
3. Should the payment lock and due check also count supplier returns against particular receives (the old return
   was free-standing, as now)?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0026_pharmacy_supplier_payments_returns`: 5 tables, `bonus_qty` on receive lines, movement kinds
  `supplier_return` and `replacement`
* `npm test`: 278 passed — new `test/unit/pharmacy/supplier.spec.ts` (allocation to the paisa, overpayment,
  another supplier, unposted, duplicate, zero; return valued at lot cost, settled in parts up to its value, not
  before the return date, closed with a reason, edited only as a draft, one line per lot) and bonus units in
  `purchase.spec.ts`
* `npm run test:int`: 16 passed (migration count 27, new tables)
* `npm run test:e2e`: 104 passed — new `test/e2e/pharmacy-supplier.e2e-spec.ts` (dues of two receives; cash payment
  of 300 + 900 with the payable and cash ledgers; overpayment, bank without account, fully paid receive, draft
  receive refused; bank payment of the rest to zero; receipt lines and print; return of 700 refused for stock,
  edited to 100 and sent at 0.90 with the voucher; stock and ledgers; replacement of 50, over-settlement refused,
  closed; return view and stock card with receive, return and replacement; print; draft deleted) and bonus units
  and the sale price in `pharmacy-purchase.e2e-spec.ts`
* Payment receipt, supplier return and receive (bonus column) prints checked visually
* Dev server restarted; readiness 200
