# Step 6b — Accounts: vouchers and posting

Status: **done** (2026-10-25). Previous: [step 6a](06a-accounts-chart.md) · Next: step 6c (books and statements).

## Scope

| Old | Outcome |
|---|---|
| `Account.VoucherMasters` + `VoucherMasterDetails` (`GLMasterController`, `AddEditVoucherMasterCommand`) | `vouchers` + `voucher_lines` with the double-entry rules, drafts, posting, numbering and reversal |
| `VoucherValidationController` (returned an empty string; the validation was commented out) | `validLines()` in the domain, used on every save and again on posting |
| Voucher numbers typed by each screen (often the invoice number) | `<journal>-<fiscal year>-<serial>`, e.g. `JV-2025-2026-00001`, per journal type and fiscal year, given on posting |
| `Account.AttachedFileWithVouchers` (bytes + extension) | `voucher_attachments` (PDF or image, bytes checked, 5 MiB) |
| `Account.Configuration` (account type → account) and the GL ids hard-coded in `AppConstant` (`IPDReceivableGLId`, `IPDSaleGLId`, …) | `gl_roles`: a named role → GL account (e.g. `cash_in_hand`, `ipd_receivable`) |
| `SuperAdmin.AccountConfigurations` (posting on sale / end of day / weekly / monthly per section) | `posting_schedules`: section → timing (used by the modules that post, steps 8 onward) |
| Integrated posting (each module wrote voucher rows itself) | The **`LedgerPosting`** contract published by the accounts module |
| `GetVoucherByReferanceIdQuery`, `GetVoucherEntryByDateQuery`, `GetVoucherDetailByVMIDorGLIDQuery` | `GET /accounts/vouchers` filters (dates, journal, status, account, text, source) and `GET /accounts/vouchers/:id` |
| `GetVoucherDueBillBySupplierAndServiceUnitQuery` | Step 6d (party ledgers) |

## Rules

* A voucher has 2–500 lines. Each line is a debit **or** a credit, amounts have at most two decimals, and the
  debits equal the credits (422 `unbalanced_voucher`). Accounts must be active; an account that needs a cost
  centre needs one on the line; a control account needs a sub-ledger.
* **Draft** → can be edited (lines replaced) or deleted. **Post** finds the fiscal year the voucher date falls in
  (422 `no_fiscal_year`), refuses a closed one (422 `fiscal_year_closed`), checks the accounts again, takes the
  next serial of that journal type in that year and numbers the voucher. Posted vouchers are never edited or
  deleted.
* **Reverse** posts a new voucher on the given date with every debit and credit swapped and marks the original
  `reversed`; a voucher is reversed at most once.
* Every change sends the voucher's `version` (409 `stale_voucher`); every step is audited
  (`voucher.drafted/edited/posted/deleted/reversed/attachment_added/attachment_removed`).
* Vouchers from other modules keep their source (`sourceModule`, `sourceReference`; old `ReferenceId`).

## LedgerPosting (for later modules)

```ts
await ledgerPosting.post({
  journal: 'SV',
  voucherDate: '2026-03-15',
  narration: 'Pharmacy sales',
  source: { module: 'pharmacy', reference: 'INV-1001' },
  lines: [
    { account: { role: 'cash_in_hand' }, debit: 750, credit: 0 },
    { account: { code: '4001' }, debit: 0, credit: 750 },
  ],
  postedBy: userId,
});
```

It runs inside the caller's transaction, resolves GL codes and roles, applies the same rules and posts at once.

## Permissions

| Key | Allows |
|---|---|
| `accounts:read` | Vouchers and attachments |
| `vouchers:write` | Entering, editing and deleting drafts; attachments |
| `vouchers:post` | Posting (including entering already posted) and reversing |
| `accounts:manage` | GL roles and posting schedules |

## Endpoints (under `/api/v1/accounts`)

| Method and path | Access |
|---|---|
| `GET vouchers?from=&to=&journalTypeId=&status=&glAccountId=&q=&sourceModule=&sourceReference=&page=` | `accounts:read` |
| `POST vouchers` `{ journalTypeId, voucherDate, documentDate, narration, paidTo, mode, serviceUnitId, lines, post }` | `vouchers:write` (`vouchers:post` with `post: true`) |
| `GET vouchers/:id` | `accounts:read` |
| `PATCH vouchers/:id` `{ version, …header, lines? }`, `DELETE vouchers/:id?version=` | `vouchers:write` |
| `POST vouchers/:id/post` `{ version }`, `POST vouchers/:id/reverse` `{ version, voucherDate, narration }` | `vouchers:post` |
| `POST vouchers/:id/attachments?fileName=` (raw body), `GET/DELETE vouchers/:id/attachments/:attachmentId` | write / read |
| `… gl-roles`, `… posting-schedules` | read / `accounts:manage` |

Report `accounts.voucher` (`voucherId`): the voucher with accounts, cheque details, total in words and
signature lines; drafts and reversed vouchers are marked.

## Old → new routes

| Old | New |
|---|---|
| `POST api/v1/GLMaster` | `POST /accounts/vouchers` (and `PATCH`, `/post`, `/reverse`) |
| `POST api/v1/GLMaster/SaveAttachedFile` | `POST /accounts/vouchers/:id/attachments` |
| `POST api/v1/GLMaster/GetByDate`, `…/GetVoucherDetail` | `GET /accounts/vouchers?from=&to=`, `GET /accounts/vouchers/:id` |
| `POST api/v1/GLMaster/GetVoucherDueBill` | step 6d |
| `POST api/v1/VoucherValidation` | built into saving |
| `api/v1/Configuration` | `/accounts/gl-roles` |
| `api/v1/AccountConfiguration` | `/accounts/posting-schedules` |

## Data migration notes (step 13)

* Old vouchers are loaded as `posted` with their old numbers (unique) and fiscal years; unbalanced old vouchers
  are reported for review rather than rejected.
* `IsReversal` vouchers are linked to the voucher they reverse where the reference allows.
* The `AppConstant` GL ids become `gl_roles` entries.

## Open questions

1. Should posting require a different person from the one who entered the voucher (maker–checker)?
2. Should voucher numbers keep any old per-screen format (e.g. the invoice number for sales vouchers)?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 211 passed — new `test/unit/accounts/voucher.spec.ts` (balanced to the paisa, unbalanced,
  one-line, both sides, three decimals, inactive account, cost centre, control account, edit → post → locked,
  reversal swap and once only, stale version)
* `npm run test:int`: 16 passed (migration set now 15); upload checks moved to `shared/domain/uploads.ts` and
  HR's tests still pass
* `npm run test:e2e`: 75 passed — new `test/e2e/vouchers.e2e-spec.ts` (unbalanced, control account, clerk cannot
  post, draft edit, stale version, numbering per journal, outside any fiscal year, closed year, posted locked,
  reversal with swapped lines, double reversal refused, draft delete, posted delete refused, attachments,
  filters, print; LedgerPosting by role and code, unknown role, source filter)
* Visual check of the voucher print (Bangla payee, cheque details); dev server migrated, restarted, all 131
  accounts routes mapped
