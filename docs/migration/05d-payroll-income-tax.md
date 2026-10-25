# Step 5d — Payroll: income tax

Status: **done** (2026-10-25). Previous: [step 5c](05c-payroll-bonus-ledgers.md) · Next: step 6 (accounts).

This finishes payroll. The **PF book** (`PFBook`: chart of accounts, categories, level-4 heads, general ledger,
vouchers, deposits, interest) and the **TDS rules** (`ITAXTDSController`, `IncomeTaxActAndTDSRules`: TDS
percentages on payments) are accounting, not payroll; they move to step 6 with the general ledger and
vouchers.

## Scope

| Old | Outcome |
|---|---|
| `Payroll.TaxSlabs` (rows per gender and `SlabStartEndDate` such as `2025-2026`, an `Exempted` row) | Record `income_tax_years`: dates, a male and a female slab scale, exemption caps, rebate and minimum-tax settings |
| Constants inside the procedures (`'2025-2026'` chosen by date, 2.5 bonuses, 3 % / 20 % × 15 % / 10 lakh rebate, 417 minimum, 40,600 / 46,000 thresholds) | Settings of each tax year |
| `SpGetSalaryCertificateForIncomeTaxNewFormulaRunningYear` | `incomeTaxCertificate()` in the domain; `GET /payroll/tax-certificates/:taxYearId`; report `payroll.tax-certificate` |
| `SpGetIndividualSalariesForIncomeTax` → `Payroll.IndividualSalariesIncomeTax` | `POST /payroll/income-tax/:year/:month/compute` → `income_tax_deductions` |
| Table `Payroll.TaxAdjustmentListOfMay` (overrides) | Deductions entered by hand (`PUT …/income-tax/:year/:month/:staffId`), kept when recomputing |
| Income tax column of the salary sheet (`NetTaxPayablePerMonth`) | The month's deduction; 0 until step 5d no longer |
| `SpGetTaxMonthlyStatement` | Report `payroll.tax-monthly` |
| `SpGetTaxYearlyStatementEmployeeWise`, `SpGetSalaryCertificate(Yearly)`, payslip for income tax (incl. the section 108 return variants) | The certificate (income, exemption, slabs, rebate, tax deducted so far and still due) covers them |
| Older formulas (`SpGetSalaryCertificateForIncomeTax`, `…Calculation`, `…NewFormula`) | Not ported: superseded by the running-year formula FAK uses |

## The calculation (one person, one tax year so far)

1. **Income received**: from the saved salary sheets of the tax year: basic, house rent, medical, conveyance,
   other allowance, overtime, allowances paid, special allowance, arrear (a negative arrear counts as 0), and
   the PF deducted (counted again as the employer's matching contribution); plus festival bonuses and leave
   encashments of the year.
2. **Projection** for the months still ahead (12, or from joining to the end of the year, less the months
   saved): the year's highest monthly basic, house rent, medical, conveyance and other allowance; festival
   bonuses still expected (expected basics − basics received, × highest basic; none for under 7 months of
   service); and the highest monthly PF as employer contribution. With no salary of the year saved yet, the
   current salary structure is the basis (the old procedure worked out no tax then).
3. **Exempt**: a third of the total, at most the year's cap. **Taxable** = total − exempt.
4. **Gross tax**: the progressive scale (male for men; the female scale for women and everyone else, as the
   old `'F'`), each band at its rate.
5. **Rebate**: the least of taxable × 3 %, taxable × 20 % × 15 %, and 10 lakh (all settings).
6. **Net tax** = gross − rebate. **Monthly deduction** = net ÷ 12, whole taka, with the old minimum rules: at
   least 417 when there is any tax, and 417 when there is none but gross tax was worked out or the monthly gross
   reaches the threshold (40,600 men / 46,000 women).

Differences from the old procedure (all deliberate): festival bonuses are counted from every festival rather
than hard-coded festival ids 1, 2 and half of 4; expected bonuses are counted in months of basic (two full Eid
bonuses and a half bonus = 2.5); the projected employer PF uses the person's actual PF rate rather than a
fixed 10 % of basic; leave encashment is counted as income (the old certificate always showed 0); the
hard-coded exclusion of employee `PH04357` and the 2024 catch-up rule are not ported.

## Workflow

* Set up the tax year (overlapping years are refused: a pay month must fall in exactly one).
* For each pay month, **compute** the deductions before approving the salary sheet; computing again replaces
  the worked-out ones and keeps those entered by hand. Remove a hand entry with `monthlyTax: null`.
* Once the month's salary sheet is committed, its deductions can no longer change (409 `pay_period_closed`).
* People can see their own certificate; others need `payroll:read`.

## Endpoints (under `/api/v1`)

| Method and path | Access |
|---|---|
| `GET/POST/PATCH/DELETE payroll/tax-years[/:id]` | read: signed in; write: `payroll:manage` |
| `GET payroll/income-tax/:year/:month` | `payroll:read` |
| `POST payroll/income-tax/:year/:month/compute` → `{ people, monthlyTax }` | `payroll:manage` |
| `PUT payroll/income-tax/:year/:month/:staffId` `{ monthlyTax \| null, remarks }` | `payroll:manage` |
| `GET payroll/tax-certificates/:taxYearId?staffId=` | own / `payroll:read` |

Reports: `payroll.tax-certificate` (`taxYearId`, `staffId`; own or `payroll:read`), `payroll.tax-monthly`
(`year`, `month`; PDF + Excel).

## Old → new routes

| Old | New |
|---|---|
| `GET api/v1/TaxSlab/{id}`, `POST`, `DELETE {id}` | `/payroll/tax-years` |
| `POST api/v1/Salary/IndividualSalariesForIncomeTax` | `POST /payroll/income-tax/:y/:m/compute`, `GET /payroll/income-tax/:y/:m` |
| `POST api/v1/Salary/SalaryCertificateForIncomeTax`, `…/GetSalaryCertificateForIncomeTaxAsync`, `POST api/v1/IncrementRecord/PrintTaxCertificateNew` | `GET /payroll/tax-certificates/:taxYearId`, report `payroll.tax-certificate` |
| `POST api/v1/Salary/GetSalaryPaySlipForIncomeTaxAsync`, `…/GetYearlyWaiseTaxPaymentStatement` | the certificate |
| `POST api/v1/Salary/TaxPaymentStatement` | report `payroll.tax-monthly` |
| `GET api/v1/ITAXTDS` | step 6 |

## Data migration notes (step 13)

* `TaxSlabs` rows of each `SlabStartEndDate` become one tax year (the `Exempted` row's
  `FixedExapmtedIncome` → exemption cap; `TaxRebateOnTaxableIncome` / `TaxRebateOnInvestment` → rebate
  settings).
* `IndividualSalariesIncomeTax` rows → `income_tax_deductions` (`computed`); `TaxAdjustmentListOfMay` rows →
  `manual`.

## Open questions

1. Should leave encashment be taxed (new) — the old certificate showed 0?
2. Confirm the FAK scale, caps and thresholds for 2025-26, and whether women and third-gender staff use the
   same scale.
3. Should tax be computed automatically when a salary sheet is approved, instead of a separate step?

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`: clean
* `npm test`: 205 passed — new `test/unit/payroll/income-tax.spec.ts` (scale bands, open-ended last band,
  scale per sex, a half year with projection and the minimum on a negative net, projection from the
  structure, gross threshold minimum, negative arrear, short service without bonus)
* `npm run test:int`: 16 passed (migration set now 13)
* `npm run test:e2e`: 72 passed — new `test/e2e/payroll-tax.e2e-spec.ts` (overlapping year, invalid scale,
  missing year, compute from the structure, hand entry kept on recompute and removed, deduction in the salary
  sheet's net pay, committed month refused, own certificate with tax paid, reports)
* Visual check of the certificate (Bangla name, lakh grouping); dev server migrated, restarted, all 96
  payroll routes mapped
