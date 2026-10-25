import { createHash } from 'node:crypto';
import type { DayOff } from '../domain/repositories.js';
import type { Duty } from '../domain/roster.js';
import type { RosterDayView, RosterStaffView } from './roster.messages.js';

export abstract class RosterReadRepository {
  /** Active staff placed in the scope, plus anyone with duties there in the period. */
  abstract staff(departmentId: string, subDepartmentId: string, from: string, to: string): Promise<RosterStaffView[]>;
  abstract shiftTypes(
    departmentId: string,
  ): Promise<Array<{ id: string; code: string; name: string; startTime: string; endTime: string }>>;
  abstract govtHolidays(from: string, to: string): Promise<Array<{ date: string; name: string }>>;
}

/** Stable fingerprint of a cell; empty for an empty cell. */
export function cellVersion(duties: readonly Duty[], dayOff: DayOff | null): string {
  const parts = [...duties]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(
      (duty) =>
        `D|${duty.id}|${duty.shiftTypeId}|${duty.startAt.toISOString()}|${duty.endAt.toISOString()}|${duty.remarks ?? ''}`,
    );
  if (dayOff) parts.push(`O|${dayOff.remarks ?? ''}`);
  return parts.length === 0 ? '' : createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 16);
}

export function dayView(staffId: string, date: string, duties: readonly Duty[], dayOff: DayOff | null): RosterDayView {
  const own = duties
    .filter((duty) => duty.staffId === staffId && duty.dutyDate === date)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return {
    staffId,
    date,
    shifts: own.map(({ id, shiftTypeId, code, startAt, endAt, remarks }) => ({
      id,
      shiftTypeId,
      code,
      startAt,
      endAt,
      remarks,
    })),
    dayOff: dayOff !== null,
    dayOffRemarks: dayOff?.remarks ?? null,
    version: cellVersion(own, dayOff),
  };
}

/** Every non-empty cell of the given duties and days off. */
export function dayViews(duties: readonly Duty[], daysOff: readonly DayOff[]): RosterDayView[] {
  const keys = new Set([
    ...duties.map((duty) => `${duty.staffId}|${duty.dutyDate}`),
    ...daysOff.map((off) => `${off.staffId}|${off.date}`),
  ]);
  return [...keys].sort().map((key) => {
    const [staffId, date] = key.split('|') as [string, string];
    return dayView(staffId, date, duties, daysOff.find((off) => off.staffId === staffId && off.date === date) ?? null);
  });
}
