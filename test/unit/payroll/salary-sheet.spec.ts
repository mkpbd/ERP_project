import { describe, expect, it } from 'vitest';
import { joinedBy, salaryLine, type SalaryLineInput } from '../../../src/modules/payroll/domain/salary-sheet.js';

const input = (overrides: Partial<SalaryLineInput> = {}): SalaryLineInput => ({
  salary: {
    gross: 30_000,
    basic: 18_000,
    houseRent: 9_000,
    medical: 1_800,
    conveyance: 1_200,
    otherAllowance: 0,
    pf: 1_800,
    cpf: 1_800,
  },
  joiningDate: '2020-01-01',
  overtimeHours: 0,
  overtimeAmount: 0,
  lwpDays: 0,
  otherDeduction: 0,
  punishment: 0,
  arrear: 0,
  allowance: 0,
  specialAllowance: 0,
  advance: 0,
  paid: 0,
  festivalBonus: 0,
  incomeTax: 0,
  ...overrides,
});

describe('salary sheet line (old spGetHrSalarySheet)', () => {
  it('adds earnings and takes off LWP, punishments and PF', () => {
    // April 2026 has 30 days; overtime is priced on March's 31 days.
    const line = salaryLine(
      input({
        overtimeHours: 10,
        overtimeAmount: 500,
        lwpDays: 2,
        punishment: 300,
        otherDeduction: 200,
        arrear: 1_000,
        allowance: 700,
        specialAllowance: 300,
        advance: 5_000,
      }),
      2026,
      4,
    );
    expect(line).toMatchObject({
      gross: 30_000,
      overtime: 1_710,
      lwp: 2_000,
      punishment: 500,
      arrear: 1_000,
      totalPayable: 33_710,
      totalDeduction: 4_300,
      netPayable: 29_410,
      advance: 5_000,
    });
  });

  it('takes the days before joining off through the arrear, and never goes below zero', () => {
    expect(salaryLine(input({ joiningDate: '2026-04-11' }), 2026, 4)).toMatchObject({
      arrear: -10_000,
      netPayable: 18_200,
    });
    expect(salaryLine(input({ lwpDays: 30 }), 2026, 4).netPayable).toBe(0);
    expect(joinedBy('2026-04-30', 2026, 4)).toBe(true);
    expect(joinedBy('2026-05-01', 2026, 4)).toBe(false);
  });

  it('prices January overtime on December', () => {
    expect(salaryLine(input({ overtimeHours: 8 }), 2027, 1).overtime).toBe(968);
  });
});
