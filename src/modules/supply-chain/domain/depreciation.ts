import { DomainError } from '../../../shared/domain/errors.js';
import { paisa, taka } from './documents.js';

export type Frequency = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';
export const FREQUENCY_MONTHS: Record<Frequency, number> = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

export type DepreciationStatus = 'active' | 'fully_depreciated' | 'suspended' | 'disposed';

const DAY = 86_400_000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/** The last day of the calendar block (month, quarter, half year or year from January) holding `date`. */
export function periodEnd(date: string, frequency: Frequency): string {
  const months = FREQUENCY_MONTHS[frequency];
  const [year, month] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  const lastMonth = Math.ceil(month / months) * months;
  return toDate(Date.UTC(year, lastMonth, 0));
}

/** The first day of the block ending on `end`. */
function periodStart(end: string, frequency: Frequency): string {
  const months = FREQUENCY_MONTHS[frequency];
  const [year, month] = [Number(end.slice(0, 4)), Number(end.slice(5, 7))];
  return toDate(Date.UTC(year, month - months, 1));
}

const nextPeriodEnd = (end: string, frequency: Frequency) => periodEnd(toDate(toTime(end) + DAY), frequency);

export interface DepreciationTerms {
  readonly frequency: Frequency;
  readonly lifeMonths: number;
  readonly cost: number;
  readonly residual: number;
  /** Depreciation runs from this day; a start inside a period is charged by days, with a closing stub. */
  readonly startDate: string;
}

export interface SchedulePeriod {
  readonly index: number;
  readonly periodEnd: string;
  /** Share of a full period (1, or less for the first and closing stub periods). */
  readonly weight: number;
}

export function validTerms(terms: DepreciationTerms): DepreciationTerms {
  const months = FREQUENCY_MONTHS[terms.frequency];
  if (!months) throw new DomainError('invalid_depreciation', 'Unknown depreciation frequency');
  if (!Number.isInteger(terms.lifeMonths) || terms.lifeMonths < 1 || terms.lifeMonths > 1200) {
    throw new DomainError('invalid_depreciation', 'The useful life is 1 to 1200 months');
  }
  if (terms.lifeMonths % months !== 0) {
    throw new DomainError(
      'invalid_depreciation',
      `The useful life must be whole ${terms.frequency.replace('_', ' ')} periods`,
    );
  }
  if (!(terms.cost >= 0) || !(terms.residual >= 0) || terms.residual > terms.cost) {
    throw new DomainError('invalid_depreciation', 'The residual value is 0 up to the cost');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(terms.startDate) || Number.isNaN(toTime(terms.startDate))) {
    throw new DomainError('invalid_depreciation', 'The start date is not a date');
  }
  return terms;
}

/**
 * Old DepreciationEngine: calendar-aligned periods from the start date. A start inside a period is charged by
 * the days left in it, and the life gets a closing stub period for the rest.
 */
export function schedule(terms: DepreciationTerms): SchedulePeriod[] {
  const full = terms.lifeMonths / FREQUENCY_MONTHS[terms.frequency];
  const firstEnd = periodEnd(terms.startDate, terms.frequency);
  const firstStart = periodStart(firstEnd, terms.frequency);
  const days = (toTime(firstEnd) - toTime(firstStart)) / DAY + 1;
  const first = firstStart === terms.startDate ? 1 : ((toTime(firstEnd) - toTime(terms.startDate)) / DAY + 1) / days;
  const periods: SchedulePeriod[] = [];
  let end = firstEnd;
  for (let index = 0; index < full; index += 1) {
    periods.push({ index, periodEnd: end, weight: index === 0 ? first : 1 });
    end = nextPeriodEnd(end, terms.frequency);
  }
  if (first < 1) periods.push({ index: full, periodEnd: end, weight: 1 - first });
  return periods;
}

export interface DepreciationState {
  /** Periods charged so far (the next one to charge is this index). */
  readonly periodsDone: number;
  readonly accumulated: number;
}

export interface Charge {
  readonly index: number;
  readonly periodEnd: string;
  readonly amount: number;
}

/**
 * The charges for the periods ending on or before `asOf`, straight line: each period takes its weight's share of
 * what remains to depreciate over the weight still to come, rounded to the paisa; the last period takes exactly
 * what is left, so rounding never leaves a remainder.
 */
export function dueCharges(terms: DepreciationTerms, state: DepreciationState, asOf: string): Charge[] {
  const periods = schedule(terms);
  const charges: Charge[] = [];
  let remaining = paisa(terms.cost - terms.residual) - paisa(state.accumulated);
  for (const period of periods.slice(state.periodsDone)) {
    if (period.periodEnd > asOf || remaining <= 0) break;
    const weightLeft = periods.slice(period.index).reduce((sum, entry) => sum + entry.weight, 0);
    const last = period.index === periods.length - 1;
    const amount = last
      ? remaining
      : Math.min(remaining, Math.max(0, Math.round((remaining * period.weight) / weightLeft)));
    charges.push({ index: period.index, periodEnd: period.periodEnd, amount: taka(amount) });
    remaining -= amount;
  }
  return charges;
}

/** The state after the opening periods (old "opening as of"): periods ending by `asOf` count as done. */
export function openingState(terms: DepreciationTerms, accumulated: number, asOf: string): DepreciationState {
  const periods = schedule(terms);
  if (!periods.some((period) => period.periodEnd === asOf)) {
    throw new DomainError('invalid_opening', 'The opening date must be the end of a depreciation period');
  }
  if (accumulated < 0 || paisa(accumulated) > paisa(terms.cost - terms.residual)) {
    throw new DomainError('invalid_opening', 'The opening depreciation is 0 up to cost less residual');
  }
  return { periodsDone: periods.filter((period) => period.periodEnd <= asOf).length, accumulated };
}

/** Old default: the receive date when it is the 1st of a month, otherwise the 1st of the next month. */
export function defaultStartDate(acquiredOn: string): string {
  if (acquiredOn.endsWith('-01')) return acquiredOn;
  const [year, month] = [Number(acquiredOn.slice(0, 4)), Number(acquiredOn.slice(5, 7))];
  return toDate(Date.UTC(year, month, 1));
}

export function statusAfter(terms: DepreciationTerms, accumulated: number): DepreciationStatus {
  return paisa(accumulated) >= paisa(terms.cost - terms.residual) ? 'fully_depreciated' : 'active';
}

/**
 * Old disposal close: the periods due up to the disposal date, then the period it falls in charged by the days
 * up to and including that date. Returns the charges; the last one ends on the disposal date.
 */
export function disposalCharges(terms: DepreciationTerms, state: DepreciationState, disposedOn: string): Charge[] {
  const charges = dueCharges(terms, state, disposedOn);
  const periods = schedule(terms);
  const current = periods[state.periodsDone + charges.length];
  if (!current || disposedOn < terms.startDate) return charges;
  const accumulated = paisa(state.accumulated) + charges.reduce((sum, charge) => sum + paisa(charge.amount), 0);
  const remaining = paisa(terms.cost - terms.residual) - accumulated;
  if (remaining <= 0) return charges;
  const start = periodStart(current.periodEnd, terms.frequency);
  const from = start > terms.startDate ? start : terms.startDate;
  const elapsed = (toTime(disposedOn) - toTime(from)) / DAY + 1;
  const length = (toTime(current.periodEnd) - toTime(from)) / DAY + 1;
  const weightLeft = periods.slice(current.index).reduce((sum, entry) => sum + entry.weight, 0);
  const share = (current.weight * Math.min(1, elapsed / length)) / weightLeft;
  const amount = Math.min(remaining, Math.max(0, Math.round(remaining * share)));
  return amount > 0 ? [...charges, { index: current.index, periodEnd: disposedOn, amount: taka(amount) }] : charges;
}
