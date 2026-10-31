# Step 16g — Small screens (Angular)

Status: **done** (2026-10-31). Previous: [step 15g](15g-small-items.md) (its API) · Next: the screens of the
modules still without any (to choose).

The parts of step 15g that fit the frontend so far, in `D:\Pratices\ERP_Frontend` (`mkpbd/ERP_frontend`, commit
`8537554`).

## Old → new

| Old page (CoxBazar, Blazor) | New |
|---|---|
| `/diagnostic/test-preparation-videos` | **Booking setup**, Preparation guides tab |
| `/diagnosis/credit-card` | **Booking setup**, Card providers tab |
| `/administrator/user-expire-date-setup` | A user's page: **Signs in until** |
| `/account/budget-settings`, `/payroll/tax-challan-entry`, `/pharmacy/exists-product-update` | Not yet: the frontend has no accounts, payroll or pharmacy screens. They come with those modules |

## The screens

* **Preparation guides** (`diag:read`; changes `diag:manage`). Each guide has:
  * a title, in English and Bangla;
  * a department or one test;
  * instructions, in English and Bangla;
  * a video link, an order, and whether it is in use.
* **Card providers.** The card, its discount percent, a contact, an address, and whether it is in use.
* **A user's account expiry** (`users:deactivate`, not on one's own page):
  * the Profile card shows "Signs in until" with the last day, or "No end";
  * a date sets the last day: the account stops at the start of the next one;
  * **No end** clears it;
  * a day already gone by ends the account at once, and the notice says so.

## The shared master table

* **Choices loaded after opening.** The choices of a field that looks up another master (departments, tests) now
  reach the dialog as they load. Before, a dialog opened before they came had an empty list.
* **Forms.** The expiry form found the same fault as the booking dialogs of 16f: a `<form>` with no `[formGroup]`
  sent the page itself (a reload). It is now a form group.

## Verification

* Frontend `npm run check` (typecheck, lint, architecture, format, unit tests, build): clean, 80 unit tests.
* Frontend e2e (Playwright, mocked API): 48 passed.
  * `diagnostic.spec.ts`: a preparation guide for a department and a card provider added in the booking setup, with
    what is sent.
  * `users.spec.ts`: the last day set on another user and cleared again.
