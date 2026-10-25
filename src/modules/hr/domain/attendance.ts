import { DomainError, ForbiddenError } from '../../../shared/domain/errors.js';
import { addDays, clockMinutes, zonedInstant } from './roster.js';

// ---------------------------------------------------------------- daily status

export type AttendanceStatus = 'leave' | 'day-off' | 'holiday' | 'absent' | 'late' | 'present';

export interface ScheduledShift {
  readonly code: string;
  readonly startAt: Date;
  readonly endAt: Date;
}

export interface AttendanceDayInput {
  readonly date: string;
  readonly shifts: readonly ScheduledShift[];
  /** Roster day off, or the person's weekly holiday. */
  readonly dayOff: boolean;
  /** Name of a government holiday on this date. */
  readonly holiday: string | null;
  /** Name of approved leave covering this date. */
  readonly leave: string | null;
  /** Device punches that belong to this day (see punchWindow). */
  readonly punches: readonly Date[];
  /** Approved manual entry: replaces the punches (old rule). */
  readonly manual: { readonly inAt: Date | null; readonly outAt: Date | null } | null;
  /** Minutes after the shift start before someone counts as late (leave policy). */
  readonly lateGraceMinutes: number;
}

export interface AttendanceDay {
  readonly date: string;
  readonly status: AttendanceStatus;
  readonly shift: string | null;
  readonly inAt: Date | null;
  readonly outAt: Date | null;
  /** Minutes after the scheduled start (0 when on time), reported even within the grace period. */
  readonly lateMinutes: number;
  readonly earlyOutMinutes: number;
  readonly workMinutes: number;
  readonly overtimeMinutes: number;
  readonly source: 'device' | 'manual' | null;
  /** Leave or holiday name. */
  readonly note: string | null;
}

const minutesBetween = (from: Date, to: Date) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));

/**
 * One person's attendance for one day. Precedence: approved leave, day off, government holiday (unless
 * a shift was scheduled), then absent / late / present from the effective in and out times. An approved
 * manual entry replaces the device punches for the times it gives.
 */
export function attendanceDay(input: AttendanceDayInput): AttendanceDay {
  const shifts = [...input.shifts].sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const sorted = [...input.punches].sort((a, b) => a.getTime() - b.getTime());
  const devIn = sorted[0] ?? null;
  const devOut = sorted.length > 1 ? sorted[sorted.length - 1]! : null;
  const inAt = input.manual?.inAt ?? devIn;
  const outAt = input.manual?.outAt ?? devOut;
  const source = input.manual ? 'manual' : sorted.length > 0 ? 'device' : null;
  const shift = shifts.length > 0 ? shifts.map((s) => s.code).join('/') : null;
  const base = { date: input.date, shift, inAt, outAt, source } as const;
  const empty = { lateMinutes: 0, earlyOutMinutes: 0, workMinutes: 0, overtimeMinutes: 0 };

  if (input.leave) return { ...base, ...empty, status: 'leave', note: input.leave };
  if (input.dayOff) return { ...base, ...empty, status: 'day-off', note: null };
  if (input.holiday && shifts.length === 0) return { ...base, ...empty, status: 'holiday', note: input.holiday };
  if (!inAt && !outAt) return { ...base, ...empty, status: 'absent', note: input.holiday };

  const workMinutes = inAt && outAt ? minutesBetween(inAt, outAt) : 0;
  const start = shifts[0]?.startAt ?? null;
  const end = shifts.length > 0 ? shifts[shifts.length - 1]!.endAt : null;
  const scheduled = shifts.reduce((total, s) => total + minutesBetween(s.startAt, s.endAt), 0);
  const lateMinutes = start && inAt ? minutesBetween(start, inAt) : 0;
  return {
    ...base,
    status: lateMinutes > input.lateGraceMinutes ? 'late' : 'present',
    lateMinutes,
    earlyOutMinutes: end && outAt ? minutesBetween(outAt, end) : 0,
    workMinutes,
    overtimeMinutes: scheduled > 0 ? Math.max(0, workMinutes - scheduled) : 0,
    note: input.holiday,
  };
}

/**
 * Which punches belong to a day: for a rostered day, from 4 hours before the first shift until 6 hours
 * after the last (so a night shift's morning punch counts for the night it started); otherwise the local
 * calendar day.
 */
export function punchWindow(
  date: string,
  shifts: readonly ScheduledShift[],
  timeZone: string,
): { from: Date; to: Date } {
  if (shifts.length === 0) {
    return { from: zonedInstant(date, '00:00', timeZone), to: zonedInstant(addDays(date, 1), '00:00', timeZone) };
  }
  const first = Math.min(...shifts.map((s) => s.startAt.getTime()));
  const last = Math.max(...shifts.map((s) => s.endAt.getTime()));
  return { from: new Date(first - 4 * 3_600_000), to: new Date(last + 6 * 3_600_000) };
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * The old free-text `WeeklyHoliday` ("Friday", "Fri, Sat") names the person's weekly days off.
 */
export function isWeeklyHoliday(weeklyHoliday: string | null, date: string): boolean {
  if (!weeklyHoliday) return false;
  const day = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
  const words = weeklyHoliday.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.some((word) => word.length >= 3 && day.startsWith(word));
}

// ---------------------------------------------------------------- manual attendance

export type ManualStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Facts about the day that decide whether a manual entry may be made (old spGetManualAttendanceContext). */
export interface ManualDayContext {
  readonly staffActive: boolean;
  readonly isFuture: boolean;
  readonly leave: string | null;
  readonly otherEntryStatus: ManualStatus | null;
  readonly hasPunches: boolean;
  readonly isDayOff: boolean;
}

export function manualDayErrors(context: ManualDayContext): string[] {
  const errors: string[] = [];
  if (!context.staffActive) errors.push('The staff member is not active; attendance cannot be entered');
  if (context.isFuture) errors.push('Attendance can only be entered for today or earlier');
  if (context.leave) {
    errors.push(`Approved leave (${context.leave}) covers this day; cancel or shorten the leave first`);
  }
  if (context.otherEntryStatus) {
    errors.push(`A manual entry (${context.otherEntryStatus}) already exists for this day; edit or cancel that one`);
  }
  return errors;
}

export function manualDayWarnings(context: ManualDayContext): string[] {
  const warnings: string[] = [];
  if (context.hasPunches)
    warnings.push('Device punches exist for this day; once approved, the manual times replace them');
  if (context.isDayOff)
    warnings.push('This is a day off; it stays a day off in the reports and does not count as present');
  return warnings;
}

export interface ManualEntryTimes {
  readonly inTime: string | null;
  readonly outTime: string | null;
  readonly reason: string;
}

/** Old ManualAttendanceRules.ValidateEntry. Times are HH:mm on the attendance date (no overnight). */
export function validManualTimes(entry: ManualEntryTimes): ManualEntryTimes {
  if (entry.inTime === null && entry.outTime === null) {
    throw new DomainError('invalid_manual_attendance', 'Enter the in time, the out time or both');
  }
  if (entry.inTime !== null && entry.outTime !== null && clockMinutes(entry.outTime) <= clockMinutes(entry.inTime)) {
    throw new DomainError(
      'invalid_manual_attendance',
      'The out time must be later than the in time on the same day (an overnight shift cannot be one manual entry)',
    );
  }
  if (entry.inTime !== null) clockMinutes(entry.inTime);
  if (entry.outTime !== null) clockMinutes(entry.outTime);
  const reason = entry.reason.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new DomainError('invalid_manual_attendance', 'Give the reason for the manual entry (1-500 characters)');
  }
  return { ...entry, reason };
}

export interface ManualAttendanceProps {
  id: string;
  staffId: string;
  attendanceDate: string;
  inTime: string | null;
  outTime: string | null;
  reason: string;
  status: ManualStatus;
  createdBy: string | null;
  submittedBy: string | null;
  submittedAt: Date | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionRemarks: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Who is acting on a manual entry. */
export interface AttendanceActor {
  readonly userId: string;
  readonly staffId: string | null;
  readonly canEnter: boolean;
  readonly canApprove: boolean;
}

const remarksOf = (remarks: string | undefined, required: string | null): string | null => {
  const trimmed = remarks?.trim() ?? '';
  if (trimmed.length > 500) throw new DomainError('invalid_remarks', 'Remarks are longer than 500 characters');
  if (required && trimmed === '') throw new DomainError('remarks_required', required);
  return trimmed === '' ? null : trimmed;
};

/** A manual in/out entry for a day without (or with wrong) punches, approved by someone else. */
export class ManualAttendance {
  private constructor(private readonly props: ManualAttendanceProps) {}

  static create(params: {
    id: string;
    staffId: string;
    attendanceDate: string;
    times: ManualEntryTimes;
    actor: AttendanceActor;
    now: Date;
  }): ManualAttendance {
    if (!params.actor.canEnter) throw new ForbiddenError();
    const times = validManualTimes(params.times);
    return new ManualAttendance({
      id: params.id,
      staffId: params.staffId,
      attendanceDate: params.attendanceDate,
      ...times,
      status: 'draft',
      createdBy: params.actor.userId,
      submittedBy: null,
      submittedAt: null,
      decidedBy: null,
      decidedAt: null,
      decisionRemarks: null,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: ManualAttendanceProps): ManualAttendance {
    return new ManualAttendance({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get status(): ManualStatus {
    return this.props.status;
  }
  get staffId(): string {
    return this.props.staffId;
  }
  get attendanceDate(): string {
    return this.props.attendanceDate;
  }

  /** Only drafts and rejected entries can be edited (old IsEditable). */
  edit(times: Partial<ManualEntryTimes>, actor: AttendanceActor, now: Date): void {
    if (!actor.canEnter) throw new ForbiddenError();
    this.assertStatus(['draft', 'rejected'], 'edited');
    const next = validManualTimes({
      inTime: times.inTime === undefined ? this.props.inTime : times.inTime,
      outTime: times.outTime === undefined ? this.props.outTime : times.outTime,
      reason: times.reason ?? this.props.reason,
    });
    Object.assign(this.props, next);
    this.touch(now);
  }

  submit(actor: AttendanceActor, now: Date): void {
    if (!actor.canEnter) throw new ForbiddenError();
    this.assertStatus(['draft', 'rejected'], 'submitted');
    this.props.status = 'pending';
    this.props.submittedBy = actor.userId;
    this.props.submittedAt = now;
    this.touch(now);
  }

  approve(actor: AttendanceActor, remarks: string | undefined, now: Date): void {
    this.assertReviewer(actor);
    this.assertStatus(['pending'], 'approved');
    this.decide('approved', actor, remarksOf(remarks, null), now);
  }

  reject(actor: AttendanceActor, remarks: string | undefined, now: Date): void {
    this.assertReviewer(actor);
    this.assertStatus(['pending'], 'rejected');
    this.decide('rejected', actor, remarksOf(remarks, 'Give the reason for rejecting'), now);
  }

  /** Cancelling an approved entry revokes it and needs an approver; anything else needs an entry clerk. */
  cancel(actor: AttendanceActor, remarks: string | undefined, now: Date): void {
    if (this.props.status === 'cancelled') throw new DomainError('manual_attendance_closed', 'Already cancelled');
    if (this.props.status === 'approved') this.assertReviewer(actor);
    else if (!actor.canEnter) throw new ForbiddenError();
    this.decide('cancelled', actor, remarksOf(remarks, 'Give the reason for cancelling'), now);
  }

  toSnapshot(): Readonly<ManualAttendanceProps> {
    return { ...this.props };
  }

  private decide(status: ManualStatus, actor: AttendanceActor, remarks: string | null, now: Date): void {
    this.props.status = status;
    this.props.decidedBy = actor.userId;
    this.props.decidedAt = now;
    this.props.decisionRemarks = remarks;
    this.touch(now);
  }

  /** Old SelfReviewBlock: whoever entered, submitted or is the subject of the entry cannot review it. */
  private assertReviewer(actor: AttendanceActor): void {
    if (!actor.canApprove) throw new ForbiddenError();
    if (actor.userId === this.props.createdBy || actor.userId === this.props.submittedBy) {
      throw new ForbiddenError(
        'self_review',
        'You entered or submitted this attendance; another approver must review it',
      );
    }
    if (actor.staffId !== null && actor.staffId === this.props.staffId) {
      throw new ForbiddenError('self_review', 'You cannot review your own attendance');
    }
  }

  private assertStatus(allowed: ManualStatus[], action: string): void {
    if (!allowed.includes(this.props.status)) {
      throw new DomainError('manual_attendance_state', `This entry is ${this.props.status} and cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.updatedAt = now;
    this.props.version++;
  }
}
