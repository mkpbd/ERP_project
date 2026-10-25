import { describe, expect, it } from 'vitest';
import {
  incrementArrear,
  isIncrementDue,
  splitGross,
  StaffSalary,
  type SalaryPolicyTerms,
  type SalarySettings,
} from '../../../src/modules/payroll/domain/salary.js';
import { DomainError } from '../../../src/shared/domain/errors.js';

const terms: SalaryPolicyTerms = {
  basicPercentOfGross: 60,
  houseRentPercentOfBasic: 50,
  medicalPercentOfBasic: 10,
  pfPercentOfBasic: 10,
  cpfPercentOfBasic: 10,
  conveyanceCap: 2500,
};
const settings: SalarySettings = {
  policyId: 'p1',
  pfEnabled: true,
  specialAllowance: 0,
  otherFixed: 0,
  overtimeRatePerHour: 0,
  taxableAmount: 0,
  incrementMethod: 'percentage',
  incrementPercent: 10,
  fixedIncrement: 0,
  reviewCycleId: null,
};
const now = new Date('2026-04-01T00:00:00Z');

describe('salary split (old salary screen)', () => {
  it('splits gross by the policy, caps conveyance and keeps the total', () => {
    expect(splitGross(30_000, terms, true)).toEqual({
      gross: 30_000,
      basic: 18_000,
      houseRent: 9_000,
      medical: 1_800,
      conveyance: 1_200,
      otherAllowance: 0,
      pf: 1_800,
      cpf: 1_800,
    });
    const big = splitGross(70_000, terms, false);
    expect(big).toMatchObject({
      basic: 42_000,
      houseRent: 21_000,
      medical: 4_200,
      conveyance: 2_500,
      otherAllowance: 300,
      pf: 0,
    });
    const bigger = splitGross(80_000.5, { ...terms, basicPercentOfGross: 50 }, false);
    expect(bigger).toMatchObject({ basic: 40_000, houseRent: 20_000, medical: 4_000, conveyance: 2_500, pf: 0 });
    expect(bigger.otherAllowance).toBe(13_500.5);
    const parts = bigger.basic + bigger.houseRent + bigger.medical + bigger.conveyance + bigger.otherAllowance;
    expect(parts).toBe(bigger.gross);
  });

  it('rounds components to whole taka and refuses impossible policies', () => {
    expect(splitGross(12_345, terms, true)).toMatchObject({ basic: 7_407, houseRent: 3_704, medical: 741, pf: 741 });
    expect(() => splitGross(10_000, { ...terms, basicPercentOfGross: 90 }, true)).toThrow(/more than the gross/);
    expect(() => splitGross(0, terms, true)).toThrow(DomainError);
  });
});

describe('increments', () => {
  it('is due a month after the joining anniversary, after a full year', () => {
    expect(isIncrementDue('2023-03-10', 2026, 4)).toBe(true);
    expect(isIncrementDue('2026-03-10', 2026, 4)).toBe(false);
    expect(isIncrementDue('2023-12-05', 2027, 1)).toBe(true);
    expect(isIncrementDue('2023-04-10', 2026, 4)).toBe(false);
  });

  it('pays arrear for the anniversary month from the joining day', () => {
    // Joined 10 March: 22 days of March, divided by March's 31 days.
    expect(incrementArrear(3_100, '2023-03-10', 2026, 4)).toBe(2_200);
    expect(incrementArrear(1_000, '2023-12-01', 2027, 1)).toBe(1_000);
  });

  it('works out what each method gives, applies it and undoes it exactly', () => {
    const salary = StaffSalary.create({ staffId: 's1', gross: 30_000, settings, terms, now });
    expect(salary.incrementDue()).toBe(2_880);
    salary.revise({ settings: { incrementMethod: 'fixed', fixedIncrement: 1_500 } }, terms, now);
    expect(salary.incrementDue()).toBe(1_500);
    salary.revise({ settings: { incrementMethod: 'individual' } }, terms, now);
    expect(salary.incrementDue()).toBeNull();

    const before = salary.increase(3_000, terms, now);
    expect(salary.toSnapshot()).toMatchObject({ gross: 33_000, basic: 19_800, version: 4 });
    salary.undo(before, now);
    expect(salary.toSnapshot()).toMatchObject({ gross: 30_000, basic: 18_000, pf: 1_800, version: 5 });
    expect(() => salary.increase(0, terms, now)).toThrow(/more than 0/);
  });
});
