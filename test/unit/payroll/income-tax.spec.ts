import { describe, expect, it } from 'vitest';
import {
  incomeTaxCertificate,
  progressiveTax,
  slabSetFor,
  validSlabs,
  type IncomeTaxInput,
  type TaxableMonth,
  type TaxYearTerms,
} from '../../../src/modules/payroll/domain/income-tax.js';
import { DomainError } from '../../../src/shared/domain/errors.js';

const scale = (taxFree: number) => [
  { width: taxFree, ratePercent: 0 },
  { width: 300_000, ratePercent: 10 },
  { width: 400_000, ratePercent: 15 },
  { width: 500_000, ratePercent: 20 },
  { width: 2_000_000, ratePercent: 25 },
  { width: null, ratePercent: 30 },
];
const terms: TaxYearTerms = {
  startsOn: '2025-07-01',
  endsOn: '2026-06-30',
  slabs: { male: scale(375_000), female: scale(425_000) },
  exemptionCap: { male: 500_000, female: 500_000 },
  rebateOnTaxablePercent: 3,
  investmentAllowancePercent: 20,
  rebateOnInvestmentPercent: 15,
  rebateCap: 1_000_000,
  minimumMonthlyTax: 417,
  minimumTaxGross: { male: 40_600, female: 46_000 },
  expectedBonusBasics: 2.5,
};
const month = (overrides: Partial<TaxableMonth> = {}): TaxableMonth => ({
  basic: 30_000,
  houseRent: 15_000,
  medical: 3_000,
  conveyance: 2_000,
  otherAllowance: 0,
  overtime: 0,
  allowance: 0,
  specialAllowance: 0,
  arrear: 0,
  pf: 3_000,
  incomeTax: 0,
  ...overrides,
});
const input = (overrides: Partial<IncomeTaxInput> = {}): IncomeTaxInput => ({
  joiningDate: '2020-01-01',
  sex: 'male',
  current: {
    gross: 50_000,
    basic: 30_000,
    houseRent: 15_000,
    medical: 3_000,
    conveyance: 2_000,
    otherAllowance: 0,
    pf: 3_000,
  },
  months: Array.from({ length: 6 }, () => month()),
  bonuses: [{ amount: 30_000, basics: 1 }],
  leaveEncashment: 0,
  ...overrides,
});

describe('tax scale', () => {
  it('taxes each band at its rate until the income runs out', () => {
    expect(progressiveTax(474_000, scale(375_000)).tax).toBe(9_900);
    expect(progressiveTax(2_150_000, scale(375_000)).tax).toBe(333_750);
    expect(progressiveTax(100_000, scale(375_000)).tax).toBe(0);
  });

  it('needs exactly one open-ended band, the last; women and others use the female scale', () => {
    expect(() =>
      validSlabs([
        { width: null, ratePercent: 0 },
        { width: 10, ratePercent: 5 },
      ]),
    ).toThrow(DomainError);
    expect(() => validSlabs([{ width: 10, ratePercent: 5 }])).toThrow(DomainError);
    expect(slabSetFor('female')).toBe('female');
    expect(slabSetFor(null)).toBe('female');
    expect(slabSetFor('male')).toBe('male');
  });
});

describe('salary certificate for income tax (old NewFormulaRunningYear)', () => {
  it('projects the rest of the year, exempts a third, takes the least rebate and keeps the minimum tax', () => {
    const certificate = incomeTaxCertificate(input(), terms);
    expect(certificate).toMatchObject({
      monthsPaid: 6,
      monthsAhead: 6,
      projected: { salary: 300_000, bonus: 45_000, employerPf: 18_000 },
      totalIncome: 711_000,
      exemption: 237_000,
      taxableIncome: 474_000,
      grossTax: 9_900,
      rebate: 14_220,
      netTax: -4_320,
      // Tax was worked out, so the minimum applies.
      monthlyTax: 417,
    });
  });

  it('projects from the salary structure before any salary of the year is saved', () => {
    const certificate = incomeTaxCertificate(
      input({
        months: [],
        bonuses: [],
        current: {
          gross: 200_000,
          basic: 100_000,
          houseRent: 50_000,
          medical: 10_000,
          conveyance: 2_500,
          otherAllowance: 37_500,
          pf: 0,
        },
      }),
      terms,
    );
    expect(certificate).toMatchObject({
      monthsAhead: 12,
      totalIncome: 2_650_000,
      exemption: 500_000,
      taxableIncome: 2_150_000,
      grossTax: 333_750,
      rebate: 64_500,
      netTax: 269_250,
      monthlyTax: 22_438,
    });
  });

  it('applies the minimum from the gross threshold, ignores negative arrears and expects no bonus for short service', () => {
    const low = incomeTaxCertificate(
      input({ months: [], bonuses: [], current: { ...input().current, gross: 41_000, basic: 1_000 } }),
      { ...terms, minimumTaxGross: { male: 40_600, female: 46_000 } },
    );
    expect(low.monthlyTax).toBe(417);
    const joiner = incomeTaxCertificate(
      input({ joiningDate: '2026-02-10', months: [month({ arrear: -10_000 })], bonuses: [] }),
      terms,
    );
    expect(joiner).toMatchObject({ monthsAhead: 4, projected: { bonus: 0 } });
    expect(joiner.received.arrear).toBe(0);
  });
});
