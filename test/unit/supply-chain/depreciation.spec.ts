import { describe, expect, it } from 'vitest';
import {
  defaultStartDate,
  disposalCharges,
  dueCharges,
  openingState,
  periodEnd,
  schedule,
  validTerms,
  type DepreciationTerms,
} from '../../../src/modules/supply-chain/domain/depreciation.js';

const terms = (extra: Partial<DepreciationTerms> = {}): DepreciationTerms => ({
  frequency: 'monthly',
  lifeMonths: 12,
  cost: 12_000,
  residual: 0,
  startDate: '2026-01-01',
  ...extra,
});
const total = (amounts: { amount: number }[]) =>
  Math.round(amounts.reduce((sum, charge) => sum + charge.amount * 100, 0)) / 100;

describe('depreciation periods', () => {
  it('are calendar blocks from January', () => {
    expect(periodEnd('2026-02-14', 'monthly')).toBe('2026-02-28');
    expect(periodEnd('2026-05-01', 'quarterly')).toBe('2026-06-30');
    expect(periodEnd('2026-07-01', 'half_yearly')).toBe('2026-12-31');
    expect(periodEnd('2028-02-29', 'yearly')).toBe('2028-12-31');
  });

  it('charge a start inside a period by days and add a closing stub', () => {
    const periods = schedule(terms({ lifeMonths: 3, cost: 3_000, startDate: '2026-01-16' }));
    expect(periods.map((period) => [period.periodEnd, Math.round(period.weight * 1000) / 1000])).toEqual([
      ['2026-01-31', 0.516],
      ['2026-02-28', 1],
      ['2026-03-31', 1],
      ['2026-04-30', 0.484],
    ]);
  });

  it('refuse a life that is not whole periods, or a residual above cost', () => {
    expect(() => validTerms(terms({ frequency: 'quarterly', lifeMonths: 10 }))).toThrow(/whole quarterly periods/);
    expect(() => validTerms(terms({ residual: 12_001 }))).toThrow(/residual/);
    expect(() => validTerms(terms({ lifeMonths: 0 }))).toThrow(/1 to 1200/);
  });
});

describe('dueCharges', () => {
  it('spreads cost less residual evenly and stops at the as-of date', () => {
    const charges = dueCharges(terms({ residual: 1_200 }), { periodsDone: 0, accumulated: 0 }, '2026-03-31');
    expect(charges).toEqual([
      { index: 0, periodEnd: '2026-01-31', amount: 900 },
      { index: 1, periodEnd: '2026-02-28', amount: 900 },
      { index: 2, periodEnd: '2026-03-31', amount: 900 },
    ]);
  });

  it('absorbs rounding in the last period, so the total is exact', () => {
    const odd = terms({ lifeMonths: 3, cost: 1_000, startDate: '2026-01-16' });
    const charges = dueCharges(odd, { periodsDone: 0, accumulated: 0 }, '2030-12-31');
    expect(charges).toHaveLength(4);
    expect(charges[0]!.amount).toBe(172.04);
    expect(total(charges)).toBe(1_000);
    const later = dueCharges(odd, { periodsDone: 2, accumulated: total(charges.slice(0, 2)) }, '2030-12-31');
    expect(later.map((charge) => charge.index)).toEqual([2, 3]);
    expect(total(later)).toBe(Math.round((1_000 - total(charges.slice(0, 2))) * 100) / 100);
  });

  it('continues from an opening balance over what is left of the life', () => {
    const state = openingState(terms(), 4_000, '2026-02-28');
    expect(state).toEqual({ periodsDone: 2, accumulated: 4_000 });
    const charges = dueCharges(terms(), state, '2026-12-31');
    expect(charges).toHaveLength(10);
    expect(charges[0]).toEqual({ index: 2, periodEnd: '2026-03-31', amount: 800 });
    expect(total(charges)).toBe(8_000);
    expect(() => openingState(terms(), 100, '2026-02-15')).toThrow(/end of a depreciation period/);
  });

  it('starts on the 1st of the month after the acquisition, as before', () => {
    expect(defaultStartDate('2026-03-01')).toBe('2026-03-01');
    expect(defaultStartDate('2026-12-15')).toBe('2027-01-01');
  });
});

describe('disposalCharges', () => {
  it('charges the due periods and the current one by days up to the disposal date', () => {
    const charges = disposalCharges(terms(), { periodsDone: 0, accumulated: 0 }, '2026-03-16');
    expect(charges.map((charge) => [charge.periodEnd, charge.amount])).toEqual([
      ['2026-01-31', 1_000],
      ['2026-02-28', 1_000],
      ['2026-03-16', 516.13],
    ]);
    expect(disposalCharges(terms(), { periodsDone: 12, accumulated: 12_000 }, '2027-02-01')).toEqual([]);
  });
});
