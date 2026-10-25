import { describe, expect, it } from 'vitest';
import { bonusBaseMonth, festivalBonusAmount, leaveEncashment } from '../../../src/modules/payroll/domain/bonus.js';

describe('festival bonus', () => {
  it("is a percentage of the previous month's basic, whole taka", () => {
    expect(festivalBonusAmount(18_000, 50)).toBe(9_000);
    expect(festivalBonusAmount(12_345, 100)).toBe(12_345);
    expect(festivalBonusAmount(10_001, 50)).toBe(5_001);
  });

  it('reads December of the year before for a January bonus', () => {
    expect(bonusBaseMonth(2027, 1)).toEqual({ year: 2026, month: 12 });
    expect(bonusBaseMonth(2026, 4)).toEqual({ year: 2026, month: 3 });
  });
});

describe('leave encashment (old LeaveIncashment)', () => {
  const base = { gross: 30_000, joiningDate: '2020-01-01', takenDays: 4, leaveYear: 2026, yearlyLeaveDays: 24 };

  it('pays the leave left at gross ÷ 30 a day', () => {
    expect(leaveEncashment(base)).toEqual({ entitledDays: 24, remainingDays: 20, perDay: 1_000, amount: 20_000 });
  });

  it('prorates the year for someone who joined during it, and pays nothing when none is left', () => {
    // Joined in April: 9 months → 18 days.
    expect(leaveEncashment({ ...base, joiningDate: '2026-04-15', takenDays: 0 })).toMatchObject({
      entitledDays: 18,
      amount: 18_000,
    });
    expect(leaveEncashment({ ...base, takenDays: 24 })).toBeNull();
    expect(leaveEncashment({ ...base, joiningDate: '2027-01-01' })).toBeNull();
  });
});
