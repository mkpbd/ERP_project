# Step 16e — The dashboard screen (Angular)

Status: **done** (2026-10-31). Previous: [step 15e](15e-dashboards.md) (its API) · Next: step 15f (diagnostic
appointments and home collection).

The figures of step 15e on the Angular dashboard (`D:\Pratices\ERP_Frontend`, `mkpbd/ERP_frontend`,
commit `89cb31e`).

## Old → new

| Old page (CoxBazar, Blazor) | New |
|---|---|
| `/infomation-dashboard` and the department dashboards (account, pharmacy, diagnostic, canteen, HR, SCM, marketing) | **Figures** on `/dashboard`: one card per section the user may see |
| Date filter bar | Presets (today, yesterday, last 7 days, this month, last month) and a date range |
| KPI tiles with up/down % | A tile per figure: its value, and its change on the days before |
| Clicking a head: the breakdown panel | A split dialog: each dimension as a toggle, bars and a total |

## The screen

* **Who sees it.** The figures sit under the greeting and above the admin counters and recent activity. Someone
  with no section to see does not see them at all.
* **The days.** The days are a preset or a range picked on the calendar. A note names the days compared with.
* **A tile shows:**
  * its label;
  * its value: taka with lakh and crore grouping (৳ 1,38,77,648.22), or a count;
  * its change on the days before: up, down, the same, or "none before";
  * "now" for a figure that stands as of now (stock, beds, dues), which has no change;
  * the hint, on hover.
* **The split.** A click opens the split:
  * by day first;
  * then by any other dimension the figure offers (way paid, user, ward, outlet, …);
  * each row with a bar, and the total.
* **Errors.** A failure shows an error with a retry, in the figures card or in the split.

## Decisions

1. **The figures join the existing dashboard page** rather than a page of their own. It is the first page after
   sign-in, so a manager sees the day at once.
2. **Bars, not a chart library.** A split is a ranked list or a run of days. CSS bars show both, without a new
   dependency.
3. **No export button.** As in step 15e, the reports cover export.

## Verification

* Frontend `npm run check` (typecheck, lint, architecture, format, unit tests, build): clean.
  * 75 unit tests.
  * New: `dashboard.models.spec.ts` covers the presets' days (a month's end, a year's turn), taka grouping and the
    change.
* Frontend e2e (Playwright, mocked API): 40 passed. New `e2e/dashboard.spec.ts`:
  * Money and Pharmacy figures with their change (16 % up, 20 % down) and "now";
  * the split by way paid;
  * "Last 7 days" asking for seven days;
  * no axe violations;
  * hidden from someone with no section.
* `errors.spec.ts` now waits for the dashboard's own requests before failing the API. The figures made a race in
  that test visible.
* The figures and the split were looked at in screenshots.
