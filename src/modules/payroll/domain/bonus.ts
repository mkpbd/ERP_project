import { roundTaka } from './salary.js';

/** Old Payroll.FestivalBonus procedure: the percentage of last month's basic, whole taka. */
export function festivalBonusAmount(basic: number, percentOfBasic: number): number {
  return roundTaka((basic * percentOfBasic) / 100);
}

/** The month whose saved salary sheet a bonus paid in (year, month) is based on. */
export function bonusBaseMonth(year: number, month: number): { year: number; month: number } {
  // The old procedure took the year of the pay month with the month before it, so a January bonus read
  // December of the same (future) year; this uses the real previous month.
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

export const DEFAULT_YEARLY_LEAVE_DAYS = 24;
/** Days the old procedure divided the gross by to price a leave day. */
export const DAYS_PER_MONTH_FOR_LEAVE = 30;

export interface LeaveEncashmentAmounts {
  readonly entitledDays: number;
  readonly remainingDays: number;
  readonly perDay: number;
  readonly amount: number;
}

/**
 * Old Payroll.LeaveIncashment: the year's leave (pro rata by months from joining when joined during the
 * year), less leave taken, paid at gross ÷ 30 a day. Null when nothing is left (or not yet joined).
 */
export function leaveEncashment(params: {
  gross: number;
  joiningDate: string;
  takenDays: number;
  leaveYear: number;
  yearlyLeaveDays: number;
}): LeaveEncashmentAmounts | null {
  const joinedYear = Number(params.joiningDate.slice(0, 4));
  const joinedMonth = Number(params.joiningDate.slice(5, 7));
  const months = (params.leaveYear - joinedYear) * 12 + (12 - joinedMonth) + 1;
  if (months <= 0) return null;
  const entitledDays = months < 12 ? (params.yearlyLeaveDays / 12) * months : params.yearlyLeaveDays;
  const remainingDays = Math.round((entitledDays - params.takenDays) * 100) / 100;
  if (remainingDays <= 0) return null;
  const perDay = Math.round((params.gross / DAYS_PER_MONTH_FOR_LEAVE) * 100) / 100;
  return {
    entitledDays,
    remainingDays,
    perDay,
    amount: roundTaka((params.gross / DAYS_PER_MONTH_FOR_LEAVE) * remainingDays),
  };
}
