import { roundTaka, type SalaryBreakdown } from './salary.js';

/** Hours in a working day, used to turn overtime hours into money (old @PerDayHour). */
export const HOURS_PER_DAY = 8;

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** Everything one person's salary line is worked out from. */
export interface SalaryLineInput {
  readonly salary: SalaryBreakdown;
  readonly joiningDate: string;
  /** Sum of overtime hours paid this month. */
  readonly overtimeHours: number;
  /** Sum of fixed overtime amounts paid this month. */
  readonly overtimeAmount: number;
  readonly lwpDays: number;
  readonly otherDeduction: number;
  readonly punishment: number;
  /** Arrear records plus increment arrears payable this month. */
  readonly arrear: number;
  /** Allowance payments this month (old AllowancePayments.OtherAllowance). */
  readonly allowance: number;
  readonly specialAllowance: number;
  readonly advance: number;
  readonly paid: number;
  /** Step 5c. */
  readonly festivalBonus: number;
  /** Step 5d. */
  readonly incomeTax: number;
}

export interface SalaryLineAmounts {
  readonly basic: number;
  readonly houseRent: number;
  readonly medical: number;
  readonly conveyance: number;
  readonly otherAllowance: number;
  /** basic + house rent + medical + conveyance + other allowance (old GrossTotal / GTotal). */
  readonly gross: number;
  readonly allowance: number;
  readonly specialAllowance: number;
  readonly overtime: number;
  readonly festivalBonus: number;
  readonly arrear: number;
  readonly totalPayable: number;
  readonly pf: number;
  readonly incomeTax: number;
  readonly lwpDays: number;
  readonly lwp: number;
  /** Punishments plus other deductions (old PunishmentAmount). */
  readonly punishment: number;
  readonly totalDeduction: number;
  readonly netPayable: number;
  /** Shown only; neither is subtracted (as in the old sheet). */
  readonly advance: number;
  readonly paid: number;
}

/** Whether a person is on the month's sheet at all: joined by the end of the month. */
export function joinedBy(joiningDate: string, year: number, month: number): boolean {
  return (
    joiningDate <= `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth(year, month)).padStart(2, '0')}`
  );
}

/**
 * Old Payroll.spGetHrSalarySheet, one line:
 * - overtime = gross ÷ (days of the previous month × 8) × hours + fixed overtime amounts
 * - LWP = gross × LWP days ÷ days of the month
 * - someone who joined during the month has the days before joining taken off through the arrear
 * - net = everything payable − (punishments and other deductions + LWP + PF + income tax), never below 0.
 * Every amount is whole taka.
 */
export function salaryLine(input: SalaryLineInput, year: number, month: number): SalaryLineAmounts {
  const days = daysInMonth(year, month);
  const previousDays = month === 1 ? daysInMonth(year - 1, 12) : daysInMonth(year, month - 1);
  const salary = input.salary;
  const basic = roundTaka(salary.basic);
  const houseRent = roundTaka(salary.houseRent);
  const medical = roundTaka(salary.medical);
  const conveyance = roundTaka(salary.conveyance);
  const otherAllowance = roundTaka(salary.otherAllowance);
  const gross = basic + houseRent + medical + conveyance + otherAllowance;

  const overtime = roundTaka(
    (salary.gross / (previousDays * HOURS_PER_DAY)) * input.overtimeHours + input.overtimeAmount,
  );
  const lwp = roundTaka((salary.gross * input.lwpDays) / days);
  const punishment = roundTaka(roundTaka(input.punishment) + input.otherDeduction);

  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const joiningShortfall =
    input.joiningDate > firstDay ? roundTaka((salary.gross / days) * (Number(input.joiningDate.slice(8, 10)) - 1)) : 0;
  const arrear = roundTaka(input.arrear) - joiningShortfall;

  const allowance = roundTaka(input.allowance);
  const specialAllowance = roundTaka(input.specialAllowance);
  const festivalBonus = roundTaka(input.festivalBonus);
  const pf = roundTaka(salary.pf);
  const incomeTax = roundTaka(input.incomeTax);

  const totalPayable = gross + allowance + specialAllowance + arrear + overtime + festivalBonus;
  const totalDeduction = punishment + lwp + pf + incomeTax;
  return {
    basic,
    houseRent,
    medical,
    conveyance,
    otherAllowance,
    gross,
    allowance,
    specialAllowance,
    overtime,
    festivalBonus,
    arrear,
    totalPayable,
    pf,
    incomeTax,
    lwpDays: input.lwpDays,
    lwp,
    punishment,
    totalDeduction,
    netPayable: Math.max(0, totalPayable - totalDeduction),
    advance: roundTaka(input.advance),
    paid: roundTaka(input.paid),
  };
}

export type SalarySheetStatus = 'approved' | 'committed';
