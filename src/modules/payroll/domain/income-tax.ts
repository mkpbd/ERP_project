import { DomainError } from '../../../shared/domain/errors.js';
import { roundTaka, type SalaryBreakdown } from './salary.js';

/** One band of the progressive scale; the last band has no width (the rest of the income). */
export interface TaxSlab {
  readonly width: number | null;
  readonly ratePercent: number;
}

export type TaxSlabSet = 'male' | 'female';

/** A tax year's rules (old Payroll.TaxSlabs rows of one SlabStartEndDate, plus constants of the old procedures). */
export interface TaxYearTerms {
  readonly startsOn: string;
  readonly endsOn: string;
  readonly slabs: Readonly<Record<TaxSlabSet, readonly TaxSlab[]>>;
  /** Old 'Exempted' row: the cap on the exempt part of salary (the exempt part is otherwise a third). */
  readonly exemptionCap: Readonly<Record<TaxSlabSet, number>>;
  /** Rebate: the least of taxable × this %, … */
  readonly rebateOnTaxablePercent: number;
  /** … taxable × investment allowance % × rebate-on-investment %, … */
  readonly investmentAllowancePercent: number;
  readonly rebateOnInvestmentPercent: number;
  /** … and this cap. */
  readonly rebateCap: number;
  /** Least monthly deduction once someone is taxable (old 417, i.e. the 5,000 minimum tax ÷ 12). */
  readonly minimumMonthlyTax: number;
  /** Monthly gross from which the minimum applies even with no tax worked out (old 40,600 / 46,000). */
  readonly minimumTaxGross: Readonly<Record<TaxSlabSet, number>>;
  /** Festival bonuses expected in a year, in months of basic (old 2.5). */
  readonly expectedBonusBasics: number;
}

export function validSlabs(slabs: readonly TaxSlab[]): readonly TaxSlab[] {
  if (slabs.length === 0) throw new DomainError('invalid_tax_year', 'Give at least one tax slab');
  slabs.forEach((slab, index) => {
    const last = index === slabs.length - 1;
    if (last !== (slab.width === null)) {
      throw new DomainError('invalid_tax_year', 'Only the last slab is open-ended (no width)');
    }
  });
  return slabs;
}

/** The slab set the old procedures chose: 'M' for male, 'F' for everyone else. */
export const slabSetFor = (sex: string | null): TaxSlabSet => (sex === 'male' ? 'male' : 'female');

/** Old cursor over Payroll.TaxSlabs: each band taxed at its rate until the income is used up. */
export function progressiveTax(
  taxable: number,
  slabs: readonly TaxSlab[],
): { bands: { amount: number; ratePercent: number; tax: number }[]; tax: number } {
  let left = Math.max(0, taxable);
  const bands = slabs.map((slab) => {
    const amount = slab.width === null ? left : Math.min(left, slab.width);
    left -= amount;
    return { amount, ratePercent: slab.ratePercent, tax: (amount * slab.ratePercent) / 100 };
  });
  return { bands, tax: bands.reduce((sum, band) => sum + band.tax, 0) };
}

/** One month of salary as the tax certificate counts it (from a saved salary sheet line). */
export interface TaxableMonth {
  readonly basic: number;
  readonly houseRent: number;
  readonly medical: number;
  readonly conveyance: number;
  readonly otherAllowance: number;
  readonly overtime: number;
  readonly allowance: number;
  readonly specialAllowance: number;
  readonly arrear: number;
  readonly pf: number;
  readonly incomeTax: number;
}

export interface IncomeTaxInput {
  readonly joiningDate: string;
  readonly sex: string | null;
  /**
   * The current salary structure: its gross decides the minimum tax, and it is the basis for the months ahead
   * when no salary of the year has been saved yet (the old procedure then worked out no tax at all).
   */
  readonly current: Pick<
    SalaryBreakdown,
    'gross' | 'basic' | 'houseRent' | 'medical' | 'conveyance' | 'otherAllowance' | 'pf'
  >;
  readonly months: readonly TaxableMonth[];
  /** Festival bonuses received in the year, with the share of basic each was. */
  readonly bonuses: readonly { readonly amount: number; readonly basics: number }[];
  readonly leaveEncashment: number;
}

export interface IncomeTaxCertificate {
  readonly monthsPaid: number;
  readonly monthsAhead: number;
  readonly received: Readonly<
    Record<keyof Omit<TaxableMonth, 'incomeTax'> | 'festivalBonus' | 'leaveEncashment', number>
  >;
  readonly projected: { readonly salary: number; readonly bonus: number; readonly employerPf: number };
  readonly totalIncome: number;
  readonly exemption: number;
  readonly taxableIncome: number;
  readonly bands: { amount: number; ratePercent: number; tax: number }[];
  readonly grossTax: number;
  readonly rebate: number;
  readonly netTax: number;
  readonly taxPaid: number;
  readonly taxDue: number;
  readonly monthlyTax: number;
}

const cents = (amount: number) => Math.round(amount * 100) / 100;
const monthIndex = (date: string) => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));

/**
 * Old SpGetSalaryCertificateForIncomeTaxNewFormulaRunningYear (+ SpGetIndividualSalariesForIncomeTax for the
 * monthly figure): salary received so far in the tax year plus the rest of the year projected at the year's
 * highest monthly amounts; a third exempt up to the cap; progressive slabs; the least of three rebates;
 * the year's tax ÷ 12 each month, with the minimum tax rules.
 */
export function incomeTaxCertificate(input: IncomeTaxInput, terms: TaxYearTerms): IncomeTaxCertificate {
  const set = slabSetFor(input.sex);
  const sum = (pick: (month: TaxableMonth) => number) => input.months.reduce((total, month) => total + pick(month), 0);
  // The months ahead are projected at the year's highest monthly amounts, or the current structure.
  const max = (pick: (month: TaxableMonth) => number) =>
    input.months.length === 0
      ? pick({ ...input.current, overtime: 0, allowance: 0, specialAllowance: 0, arrear: 0, incomeTax: 0 })
      : input.months.reduce((top, month) => Math.max(top, pick(month)), 0);

  const received = {
    basic: sum((m) => m.basic),
    houseRent: sum((m) => m.houseRent),
    medical: sum((m) => m.medical),
    conveyance: sum((m) => m.conveyance),
    otherAllowance: sum((m) => m.otherAllowance),
    overtime: sum((m) => m.overtime),
    allowance: sum((m) => m.allowance),
    specialAllowance: sum((m) => m.specialAllowance),
    // The old procedure counted a negative arrear (a late joiner's first month) as nothing.
    arrear: sum((m) => Math.max(0, m.arrear)),
    // The employer's matching contribution, taken equal to the staff member's own PF.
    pf: sum((m) => m.pf),
    festivalBonus: input.bonuses.reduce((total, bonus) => total + bonus.amount, 0),
    leaveEncashment: input.leaveEncashment,
  };

  const yearMonths = monthIndex(terms.endsOn) - Math.max(monthIndex(terms.startsOn), monthIndex(input.joiningDate)) + 1;
  const monthsPaid = input.months.length;
  const monthsAhead = Math.max(0, Math.min(12, yearMonths) - monthsPaid);
  const maxBasic = max((m) => m.basic);
  const projectedSalary =
    monthsAhead *
    (maxBasic +
      max((m) => m.houseRent) +
      max((m) => m.medical) +
      max((m) => m.conveyance) +
      max((m) => m.otherAllowance));
  // Less than seven months of service in the year: no further bonus is expected (old rule).
  const bonusBasicsReceived = input.bonuses.reduce((total, bonus) => total + bonus.basics, 0);
  const projectedBonus = yearMonths < 7 ? 0 : Math.max(0, terms.expectedBonusBasics - bonusBasicsReceived) * maxBasic;
  const projectedEmployerPf = monthsAhead * max((m) => m.pf);

  const totalIncome = cents(
    Object.values(received).reduce((total, amount) => total + amount, 0) +
      projectedSalary +
      projectedBonus +
      projectedEmployerPf,
  );
  const exemption = cents(Math.min(totalIncome / 3, terms.exemptionCap[set]));
  const taxableIncome = cents(totalIncome - exemption);
  const { bands, tax } = progressiveTax(taxableIncome, terms.slabs[set]);
  const grossTax = cents(tax);
  const rebate = cents(
    Math.min(
      (taxableIncome * terms.rebateOnTaxablePercent) / 100,
      (((taxableIncome * terms.investmentAllowancePercent) / 100) * terms.rebateOnInvestmentPercent) / 100,
      terms.rebateCap,
    ),
  );
  const netTax = cents(grossTax - rebate);
  const taxPaid = sum((m) => m.incomeTax);

  let monthlyTax = netTax > 0 ? cents(netTax / 12) : 0;
  if (monthlyTax > 0 && monthlyTax < terms.minimumMonthlyTax) monthlyTax = terms.minimumMonthlyTax;
  if (monthlyTax === 0 && (grossTax > 0 || input.current.gross >= terms.minimumTaxGross[set])) {
    monthlyTax = terms.minimumMonthlyTax;
  }

  return {
    monthsPaid,
    monthsAhead,
    received,
    projected: { salary: projectedSalary, bonus: projectedBonus, employerPf: projectedEmployerPf },
    totalIncome,
    exemption,
    taxableIncome,
    bands: bands.map((band) => ({ ...band, amount: cents(band.amount), tax: cents(band.tax) })),
    grossTax,
    rebate,
    netTax,
    taxPaid,
    taxDue: cents(netTax - taxPaid),
    monthlyTax: roundTaka(monthlyTax),
  };
}
