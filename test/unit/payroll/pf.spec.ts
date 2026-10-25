import { describe, expect, it } from 'vitest';
import { allocateInterest, pfPosition, type PfMovements } from '../../../src/modules/payroll/domain/pf.js';

const movements: PfMovements = {
  staffId: 's1',
  deductions: [
    { date: '2024-11-30', amount: 1_000 },
    { date: '2024-12-31', amount: 1_000 },
    { date: '2025-01-31', amount: 1_200 },
    { date: '2025-02-28', amount: 1_200 },
  ],
  entries: [
    { date: '2024-07-01', type: 'opening', credit: 50_000, debit: 0 },
    { date: '2024-12-31', type: 'interest', credit: 1_500.5, debit: 0 },
    { date: '2025-01-15', type: 'contribution', credit: 300, debit: 0 },
    { date: '2025-01-20', type: 'withdrawal', credit: 0, debit: 2_000 },
    { date: '2025-01-25', type: 'adjustment', credit: 0, debit: 10.25 },
  ],
};

describe('pfPosition', () => {
  it('adds own PF, the employer match, interest and adjustments, less withdrawals', () => {
    const position = pfPosition(movements, '2025-01-31', 100);
    expect(position).toMatchObject({
      opening: 50_000,
      own: 3_500,
      employer: 3_500,
      interest: 1_500.5,
      adjustments: -10.25,
      withdrawn: 2_000,
      settled: 0,
      balance: 56_490.25,
    });
    expect(position.years).toEqual([
      { year: 2024, own: 2_000, employer: 2_000, interest: 1_500.5, withdrawn: 0 },
      { year: 2025, own: 1_500, employer: 1_500, interest: 0, withdrawn: 2_000 },
    ]);
  });

  it('leaves out what comes after the date and matches a share of own PF', () => {
    const position = pfPosition(movements, '2024-12-30', 50);
    expect(position).toMatchObject({ own: 1_000, employer: 500, interest: 0, balance: 51_500 });
  });

  it('is nothing after a full settlement', () => {
    const settled = pfPosition(
      {
        ...movements,
        entries: [...movements.entries, { date: '2025-03-01', type: 'settlement', credit: 0, debit: 58_890.25 }],
      },
      '2025-03-31',
      100,
    );
    expect(settled.balance).toBe(0);
  });
});

describe('allocateInterest', () => {
  it('shares in proportion to balances and gives leftover paisa to the largest remainders', () => {
    const shares = allocateInterest(100, [
      { staffId: 'a', balance: 1 },
      { staffId: 'b', balance: 1 },
      { staffId: 'c', balance: 1 },
    ]);
    expect(shares).toEqual([
      { staffId: 'a', amount: 33.34 },
      { staffId: 'b', amount: 33.33 },
      { staffId: 'c', amount: 33.33 },
    ]);
  });

  it('adds up to the total exactly and skips members with nothing', () => {
    const shares = allocateInterest(12_345.67, [
      { staffId: 'a', balance: 150_000.33 },
      { staffId: 'b', balance: 0 },
      { staffId: 'c', balance: 72_500 },
      { staffId: 'd', balance: -5 },
      { staffId: 'e', balance: 1_234_567.89 },
    ]);
    expect(shares.map((share) => share.staffId)).toEqual(['a', 'c', 'e']);
    expect(Math.round(shares.reduce((sum, share) => sum + share.amount * 100, 0))).toBe(1_234_567);
    expect(shares[1]?.amount).toBe(614.29);
  });

  it('refuses when nobody has a balance', () => {
    expect(() => allocateInterest(10, [{ staffId: 'a', balance: 0 }])).toThrow(/Nobody has a PF balance/);
  });
});
