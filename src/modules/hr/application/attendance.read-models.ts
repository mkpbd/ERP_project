import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import {
  attendanceDay,
  isWeeklyHoliday,
  punchWindow,
  type AttendanceDay,
  type ManualStatus,
  type ScheduledShift,
} from '../domain/attendance.js';
import { addDays, zonedInstant } from '../domain/roster.js';

/** Everything needed to work out attendance for some people over a date range. */
export interface AttendanceFacts {
  readonly staff: Array<{
    id: string;
    employeeNo: string;
    fullName: string;
    departmentName: string;
    designationName: string;
    weeklyHoliday: string | null;
    lateGraceMinutes: number;
  }>;
  readonly duties: Array<{ staffId: string; dutyDate: string } & ScheduledShift>;
  readonly daysOff: Array<{ staffId: string; date: string }>;
  readonly holidays: Array<{ date: string; name: string }>;
  readonly leaves: Array<{ staffId: string; from: string; to: string; name: string }>;
  readonly punches: Array<{ staffId: string; punchedAt: Date }>;
  readonly manual: Array<{ staffId: string; date: string; inTime: string | null; outTime: string | null }>;
}

export interface AttendanceScope {
  readonly staffIds?: readonly string[];
  readonly departmentId?: string;
  readonly subDepartmentId?: string;
}

export interface ManualAttendanceView {
  readonly id: string;
  readonly staffId: string;
  readonly employeeNo: string;
  readonly staffName: string;
  readonly departmentName: string;
  readonly attendanceDate: string;
  readonly inTime: string | null;
  readonly outTime: string | null;
  readonly reason: string;
  readonly status: ManualStatus;
  readonly createdBy: string | null;
  readonly submittedBy: string | null;
  readonly submittedAt: Date | null;
  readonly decidedBy: string | null;
  readonly decidedAt: Date | null;
  readonly decisionRemarks: string | null;
  readonly version: number;
  readonly createdAt: Date;
}

export interface ManualAttendanceFilter extends PageRequest {
  readonly status?: ManualStatus;
  readonly staffId?: string;
  readonly departmentId?: string;
  readonly from?: string;
  readonly to?: string;
}

export abstract class AttendanceReadRepository {
  /** Active staff in the scope (or the listed people, whatever their status). */
  abstract facts(scope: AttendanceScope, from: string, to: string, timeZone: string): Promise<AttendanceFacts>;
  abstract punches(staffId: string, from: Date, to: Date): Promise<Array<{ punchedAt: Date; machineNo: number }>>;
  abstract listManual(filter: ManualAttendanceFilter): Promise<Page<ManualAttendanceView>>;
  abstract getManual(id: string): Promise<ManualAttendanceView | null>;
}

export interface StaffAttendanceRow extends AttendanceDay {
  readonly staffId: string;
  readonly employeeNo: string;
  readonly fullName: string;
  readonly departmentName: string;
  readonly designationName: string;
}

/** Works out every person's attendance for every date in [from, to]. */
export function computeAttendance(
  facts: AttendanceFacts,
  from: string,
  to: string,
  timeZone: string,
): StaffAttendanceRow[] {
  const rows: StaffAttendanceRow[] = [];
  const holidays = new Map(facts.holidays.map((holiday) => [holiday.date, holiday.name]));
  for (const member of facts.staff) {
    const duties = facts.duties.filter((duty) => duty.staffId === member.id);
    const punches = facts.punches.filter((punch) => punch.staffId === member.id).map((punch) => punch.punchedAt);
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const shifts = duties.filter((duty) => duty.dutyDate === date);
      const window = punchWindow(date, shifts, timeZone);
      const manual = facts.manual.find((entry) => entry.staffId === member.id && entry.date === date);
      const leave = facts.leaves.find((entry) => entry.staffId === member.id && entry.from <= date && entry.to >= date);
      const day = attendanceDay({
        date,
        shifts,
        dayOff:
          facts.daysOff.some((off) => off.staffId === member.id && off.date === date) ||
          (shifts.length === 0 && isWeeklyHoliday(member.weeklyHoliday, date)),
        holiday: holidays.get(date) ?? null,
        leave: leave?.name ?? null,
        punches: punches.filter((at) => at >= window.from && at < window.to),
        manual: manual
          ? {
              inAt: manual.inTime ? zonedInstant(date, manual.inTime, timeZone) : null,
              outAt: manual.outTime ? zonedInstant(date, manual.outTime, timeZone) : null,
            }
          : null,
        lateGraceMinutes: member.lateGraceMinutes,
      });
      rows.push({
        ...day,
        staffId: member.id,
        employeeNo: member.employeeNo,
        fullName: member.fullName,
        departmentName: member.departmentName,
        designationName: member.designationName,
      });
    }
  }
  return rows;
}

/** Today's date in the organization time zone. */
export function localToday(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
