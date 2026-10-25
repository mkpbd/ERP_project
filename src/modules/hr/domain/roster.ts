import { DomainError } from '../../../shared/domain/errors.js';

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `HH:mm` (24-hour) → minutes after midnight. */
export function clockMinutes(value: string): number {
  const match = CLOCK.exec(value);
  if (!match) throw new DomainError('invalid_time', `'${value}' is not a time (HH:mm, 24-hour)`);
  return Number(match[1]) * 60 + Number(match[2]);
}

export function assertShiftTimes(startTime: string, endTime: string): void {
  if (clockMinutes(startTime) === clockMinutes(endTime)) {
    throw new DomainError('invalid_shift_times', 'Start and end are the same, so the shift length is ambiguous');
  }
}

/**
 * The instant at which the wall clock in `timeZone` shows `date` `time`.
 * (Correct for zones without daylight saving, like Asia/Dhaka; around a DST
 * change the earlier instant wins.)
 */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const minutes = clockMinutes(time);
  const naive = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    Math.floor(minutes / 60),
    minutes % 60,
  );
  const offsetAt = (instant: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
        .formatToParts(new Date(instant))
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<string, number>;
    const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day, parts.hour, parts.minute);
    return wall - instant;
  };
  const guess = naive - offsetAt(naive);
  return new Date(naive - offsetAt(guess));
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export interface ShiftType {
  readonly id: string;
  readonly departmentId: string;
  readonly code: string;
  readonly startTime: string;
  readonly endTime: string;
}

/** A shift on a date: starts that day; ends the next day when it runs past midnight. */
export function shiftInterval(date: string, type: ShiftType, timeZone: string): { startAt: Date; endAt: Date } {
  assertShiftTimes(type.startTime, type.endTime);
  const overnight = clockMinutes(type.endTime) < clockMinutes(type.startTime);
  return {
    startAt: zonedInstant(date, type.startTime, timeZone),
    endAt: zonedInstant(overnight ? addDays(date, 1) : date, type.endTime, timeZone),
  };
}

export interface Duty {
  readonly id: string;
  readonly staffId: string;
  readonly dutyDate: string;
  readonly shiftTypeId: string;
  readonly code: string;
  readonly startAt: Date;
  readonly endAt: Date;
  remarks: string | null;
}

export interface RosterDay {
  readonly duties: Duty[];
  readonly dayOff: { remarks: string | null } | null;
}

export interface RosterEntry {
  readonly staffId: string;
  readonly date: string;
  readonly shifts: ReadonlyArray<{ readonly shiftTypeId: string; readonly remarks: string | null }>;
  readonly dayOff: boolean;
  readonly dayOffRemarks: string | null;
}

export interface RosterScope {
  readonly departmentId: string;
  readonly subDepartmentId: string;
  readonly firstDay: string;
  readonly lastDay: string;
}

export interface StaffPlacement {
  readonly active: boolean;
  readonly departmentId: string;
  readonly subDepartmentId: string;
}

export interface DayPlan {
  readonly inserts: Array<Omit<Duty, 'id'>>;
  readonly remarkUpdates: Array<{ id: string; remarks: string | null }>;
  readonly deletes: string[];
  /** `set`: create or update the day off; `clear`: remove it; `keep`: no change. */
  readonly dayOff: 'set' | 'clear' | 'keep';
  readonly dayOffRemarks: string | null;
}

const REMARKS_MAX = 500;
const remarks = (value: string | null) => (value?.trim() ? value.trim() : null);

/**
 * Turns one requested cell of the roster grid (one person, one date) into changes, or errors.
 * Ported from the old RosterEntryPlanner: no duty and day off on the same date; new entries only
 * for active staff placed in this department/sub-department; no overlapping shifts for one person,
 * including overnight shifts from the day before or into the day after.
 */
export function planRosterDay(input: {
  entry: RosterEntry;
  current: RosterDay;
  staff: StaffPlacement | null;
  scope: RosterScope;
  shiftTypes: ReadonlyMap<string, ShiftType>;
  /** The person's other duties (other dates, any department) that could overlap. */
  otherDuties: readonly Duty[];
  timeZone: string;
}): { errors: string[] } | { plan: DayPlan } {
  const { entry, current, staff, scope } = input;
  const errors: string[] = [];
  const date = entry.date;
  if (date < scope.firstDay || date > scope.lastDay) errors.push('The date is outside the roster month');

  const desired = new Map<string, string | null>();
  for (const shift of entry.shifts) desired.set(shift.shiftTypeId, remarks(shift.remarks));
  const dayOffRemarks = remarks(entry.dayOffRemarks);
  if ([...desired.values(), dayOffRemarks].some((value) => (value?.length ?? 0) > REMARKS_MAX)) {
    errors.push(`Remarks are longer than ${REMARKS_MAX} characters`);
  }
  if (entry.dayOff && desired.size > 0) errors.push('A day cannot hold both a duty and a day off');

  const adds =
    [...desired.keys()].some((id) => !current.duties.some((duty) => duty.shiftTypeId === id)) ||
    (entry.dayOff && current.dayOff === null);
  if (adds) {
    if (!staff) errors.push('Staff record not found');
    else if (!staff.active) errors.push('The staff member is not active; new duties or days off cannot be added');
    else if (staff.departmentId !== scope.departmentId || staff.subDepartmentId !== scope.subDepartmentId) {
      errors.push('The staff member does not belong to this department / sub-department');
    }
  }

  const inserts: Array<Omit<Duty, 'id'>> = [];
  const remarkUpdates: Array<{ id: string; remarks: string | null }> = [];
  const kept: Duty[] = [];
  for (const [shiftTypeId, wanted] of desired) {
    const existing = current.duties.find((duty) => duty.shiftTypeId === shiftTypeId);
    if (existing) {
      if (existing.remarks !== wanted) remarkUpdates.push({ id: existing.id, remarks: wanted });
      kept.push(existing);
      continue;
    }
    const type = input.shiftTypes.get(shiftTypeId);
    if (!type || type.departmentId !== scope.departmentId) {
      errors.push('That shift type is not set up for this department');
      continue;
    }
    const interval = shiftInterval(date, type, input.timeZone);
    inserts.push({
      staffId: entry.staffId,
      dutyDate: date,
      shiftTypeId,
      code: type.code,
      ...interval,
      remarks: wanted,
    });
  }
  const deletes = current.duties.filter((duty) => !kept.includes(duty)).map((duty) => duty.id);

  const others = [...input.otherDuties, ...kept];
  inserts.forEach((added, index) => {
    for (const other of [...others, ...inserts.slice(0, index)]) {
      if (added.startAt < other.endAt && other.startAt < added.endAt) {
        errors.push(`Shift ${added.code} overlaps shift ${other.code} on ${other.dutyDate}`);
      }
    }
  });

  if (errors.length > 0) return { errors };
  const dayOff: DayPlan['dayOff'] = entry.dayOff
    ? current.dayOff === null || current.dayOff.remarks !== dayOffRemarks
      ? 'set'
      : 'keep'
    : current.dayOff === null
      ? 'keep'
      : 'clear';
  return { plan: { inserts, remarkUpdates, deletes, dayOff, dayOffRemarks } };
}

export function planHasChanges(plan: DayPlan): boolean {
  return plan.inserts.length + plan.remarkUpdates.length + plan.deletes.length > 0 || plan.dayOff !== 'keep';
}
