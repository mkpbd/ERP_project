# Step 15g — Small items

Status: **done** (2026-10-31). Previous: [step 16f](16f-booking-screens.md) · Next: [step 16g](16g-small-screens.md)
(the screens that fit the frontend so far).

The last gaps of the page-by-page check, one or two pages each:

* the rest of the diagnostic front office (preparation videos, card providers);
* user account expiry;
* budgets;
* income-tax challans;
* correcting a pharmacy lot.

Feeder institutions are left out (see the decisions).

## What the old pages did

The old code of each page was read in full. Some of them did less than their names say.

| Old page | What it really did |
|---|---|
| `/diagnostic/test-preparation-videos` | A video per test group (an uploaded file of up to 80 MB kept in the database, or an https link) with an English and a Bangla title. No written instructions. One active clip a group |
| `/diagnosis/credit-card` | A provider, an address, a contact and a "discount group". **Nothing behind it:** no handler and no controller, and diagnostic billing never read it. Discount groups (a percent or an amount per test) were used by corporate clients only |
| `/administrator/user-expire-date-setup` | **Not a per-user expiry.** A vendor licence lock: a Base64 date and module saved on the users by a stored procedure. The layout compared it with the date of the last admission, invoice or sale (not today) and signed everyone but super-admins out |
| `/account/budget-settings` | One company-wide income and one expense total a year, keyed by a year label. Not per account and not monthly. No report read it; deleting a row did not work |
| `/payroll/tax-challan-entry` | A challan number, a date and an amount per staff member and pay month, edited as a grid of the tax year's months. A tax certificate with a challan table was written but never used |
| `/pharmacy/exists-product-update` | The expiry and sale price of a lot still in stock, edited in place for every unit. The product's master price was changed too. Logged without a reason; the purchase price could not change |

## What it is here

### Test preparation guides (`hospital/test-preparations`, `diag:read` / `diag:manage`)

* **What a guide is:** a title (English and Bangla), instructions (English and Bangla) and an https video link.
* **What it is for:** a department's tests, or one test (exactly one of the two).
* **Rules:** it needs written instructions or a video. There is a display order, and it can be switched off.
* **On the portal.** `GET /portal/test-preparations` (no sign-in) lists the guides in use with their department or
  test.
* **No video files.** The centre hosts the video and gives the link.

### Card providers (`hospital/card-providers`, `diag:read` / `diag:manage`)

* A provider has a name, an address, a contact number and a discount percent, and can be switched off.
* `POST /hospital/diagnostic-bills` takes `cardProviderId`. A card is for a patient paying their own outpatient
  bill; it is refused with a company, a staff member or an admission (`invalid_payer`).
* Unless another discount is asked for, the card's percent is given on what may be discounted, with the reason
  "Card: …". The card's percent is also how far the counter may go without `diag:discount`, as with a corporate
  client.
* The bill keeps the card provider. A card switched off is refused (`inactive_card`).

### User account expiry (`PUT /users/:id/expiry`, `users:deactivate`)

* A moment from which the account stops signing in (`account_expired`), or null to clear it. It is shown on the
  user as `expiresAt`.
* **Open sessions.** They end at their next refresh. When the moment set is already past, they end at once.
* **Elsewhere.** An expired account counts as inactive in the user directory, for example in the list of collectors.
* **Limits.** Not one's own account (`cannot_expire_self`), and never the last active super-admin.

### Budgets (`/accounts/budgets/:fiscalYearId`)

* **Setting it** (`PUT`, `accounts:manage`). The year's whole budget: an amount, and a note, for any income or
  expense account of the main books (`not_budgetable` otherwise). A closed fiscal year is refused.
* **Budget against actual** (`GET ?to=`, `accounts:read`). For each budgeted account, and each income or expense
  account with postings:
  * the budget;
  * what was posted from the year's start to the date (its end when left out), on the account's side;
  * actual less budget, and the share used.

  Then the income, expense and profit totals.
* **Print.** `accounts.budget-vs-actual` (PDF and Excel).

### Tax challans (`payroll/tax-challans`, `payroll:read` / `payroll:manage`)

* **A challan:** the staff member and pay month, the challan number and date, the bank (new) and the amount. One
  per person and month (`tax_challan_month_taken`).
* **The tax certificate** (`GET /payroll/tax-certificates/:taxYearId` and its print) shows each month of the tax
  year: the tax deducted from the salary and the challan it was deposited with, with both totals. This is the table
  the old code wrote and never used.

### Correcting a pharmacy lot (`POST /pharmacy/lots/:id/correct`, `pharmacy:manage`)

* **What changes:** the batch, the expiry or the sale rate (`lot_unchanged` otherwise). A reason and a day are
  required.
* **How it moves.** At every outlet holding units of the lot, the units move to the lot as it should have been, at
  their cost there. The lot is created, or joined when it exists already. The movements are of the new kind
  `lot_correction`, numbered `LC-<year>-…`, and the correction itself is kept with its reason.
* **What stays.** What was sold from the old lot stays as sold. Stock reports leave these movements out, since they
  move nothing in or out of a product's stock.
* **Expired lots** are moved too: a wrong expiry may be the very thing corrected.

## Decisions ("next" without answers: the recommendations)

1. **Preparation guides, not video uploads.** A link and words in English and Bangla, per department or per test.
   The new system has no test groups; departments and tests do that job. The old 80 MB files in the database are
   not repeated.
2. **A card is a percent.** The old page had nothing behind it. A card's percent works like a corporate client's,
   for a patient paying their own bill.
3. **Account expiry is per user.** It is for temporary accounts (locums, trainees). The old licence lock (a vendor
   switch comparing an encoded date with the last invoice) is not brought over.
4. **Budgets per account.** The old single yearly total is the sum of these. The comparison with the books is new.
5. **A lot is corrected by moving its stock,** not by editing it, so sales and costs stay true. The purchase price is
   not corrected here: stock is valued at what came in, and a wrong price is set right with the supplier (a return
   or a replacement). The product's catalogue price is not touched.
6. **Feeder institutions left out.** The old page had no data behind it that the new system would use; referring
   doctors and corporate clients cover who sends patients.

## Not done here

* **Screens** for budgets, challans and lot corrections. The frontend has no accounts, payroll or pharmacy
  screens yet; they come with those modules' screens. Step 16g adds what fits now.
* **Bringing over old data.** On the QA copy these tables are empty or, for budgets, hold the single yearly total
  only. Rehearsal 2 will show the live copy.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. Migration `0064_small_items`
  (five tables, the users' expiry, the bills' card, the new movement kind).
* `npm test`: 466 passed.
  * New `lot-correction.spec.ts`: what may change, the reason, unchanged lots.
  * `user.spec.ts`: an account stops signing in at its expiry, until it is cleared.
* `npm run test:int`: 16 passed (migration count 65, five more tables).
* `npm run test:e2e`: 188 of 189 passed. The one failure is `hospital-ot` (step 15a), run at 23:06 in Dhaka. It schedules
  operations one to four hours from now and looks for them on today's board; late in the evening they fall on
  tomorrow. Nothing in it changed in this step. It passes in the day and needs its times anchored to the day (to do).
  * **Authorization:** sign-in refused at the expiry; sessions ended when it is past; not one's own; cleared again.
  * **Bookings:**
    * a card's 15 % above the counter's limit;
    * a larger discount refused;
    * a card switched off refused;
    * preparation guides with their department or test on the portal, both kinds of target and an http link
      refused.
  * **Books:** a budget of income and expense accounts against what was posted, the totals, a date outside the
    year, replacing it; the print as PDF and Excel.
  * **Payroll tax:** a challan, one a month, by the officer only; the certificate's deducted and deposited.
  * **Pharmacy transfer:**
    * an expired lot corrected, its stock, cost and value unchanged, then sent;
    * a lot corrected into an existing one;
    * a lot with no stock, an unchanged lot, and the permission refused.
