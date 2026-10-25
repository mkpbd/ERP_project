import { describe, expect, it } from 'vitest';
import {
  computeAttendance,
  localToday,
  type AttendanceFacts,
} from '../../../src/modules/hr/application/attendance.read-models.js';
import {
  attendanceDay,
  isWeeklyHoliday,
  manualDayErrors,
  manualDayWarnings,
  ManualAttendance,
  punchWindow,
  validManualTimes,
  type AttendanceActor,
} from '../../../src/modules/hr/domain/attendance.js';
import { shiftInterval, zonedInstant } from '../../../src/modules/hr/domain/roster.js';
import { DomainError, ForbiddenError } from '../../../src/shared/domain/errors.js';

const TZ = 'Asia/Dhaka';
const at = (date: string, time: string) => zonedInstant(date, time, TZ);
const morning = {
  code: 'M',
  ...shiftInterval('2026-11-10', { id: 'm', departmentId: 'd', code: 'M', startTime: '08:00', endTime: '14:00' }, TZ),
};
const night = {
  code: 'N',
  ...shiftInterval('2026-11-10', { id: 'n', departmentId: 'd', code: 'N', startTime: '20:00', endTime: '08:00' }, TZ),
};
const day = (overrides: Partial<Parameters<typeof attendanceDay>[0]> = {}) =>
  attendanceDay({
    date: '2026-11-10',
    shifts: [morning],
    dayOff: false,
    holiday: null,
    leave: null,
    punches: [],
    manual: null,
    lateGraceMinutes: 10,
    ...overrides,
  });

describe('daily attendance status', () => {
  it('is present within the grace period and late after it', () => {
    expect(day({ punches: [at('2026-11-10', '08:07'), at('2026-11-10', '14:30')] })).toMatchObject({
      status: 'present',
      lateMinutes: 7,
      workMinutes: 383,
      overtimeMinutes: 23,
      source: 'device',
    });
    expect(day({ punches: [at('2026-11-10', '08:25'), at('2026-11-10', '13:30')] })).toMatchObject({
      status: 'late',
      lateMinutes: 25,
      earlyOutMinutes: 30,
    });
  });

  it('gives leave, days off and holidays precedence; absent without times', () => {
    expect(day({ leave: 'Casual leave', punches: [at('2026-11-10', '08:00')] })).toMatchObject({
      status: 'leave',
      note: 'Casual leave',
    });
    expect(day({ dayOff: true })).toMatchObject({ status: 'day-off' });
    expect(day({ shifts: [], holiday: 'Victory Day' })).toMatchObject({ status: 'holiday' });
    expect(day({ holiday: 'Victory Day' })).toMatchObject({ status: 'absent', note: 'Victory Day' });
    expect(day()).toMatchObject({ status: 'absent', inAt: null });
  });

  it('lets an approved manual entry replace the punches', () => {
    const result = day({
      punches: [at('2026-11-10', '09:30')],
      manual: { inAt: at('2026-11-10', '08:00'), outAt: at('2026-11-10', '14:00') },
    });
    expect(result).toMatchObject({ status: 'present', source: 'manual', lateMinutes: 0, workMinutes: 360 });
  });

  it("counts a night shift's morning punch for the night it started", () => {
    const window = punchWindow('2026-11-10', [night], TZ);
    const punches = [at('2026-11-10', '19:55'), at('2026-11-11', '08:05')].filter(
      (p) => p >= window.from && p < window.to,
    );
    expect(day({ shifts: [night], punches })).toMatchObject({ status: 'present', workMinutes: 730 });
    const calendar = punchWindow('2026-11-10', [], TZ);
    expect([calendar.from.toISOString(), calendar.to.toISOString()]).toEqual([
      '2026-11-09T18:00:00.000Z',
      '2026-11-10T18:00:00.000Z',
    ]);
  });

  it('reads weekly holidays from the old free text', () => {
    expect(isWeeklyHoliday('Friday', '2026-11-13')).toBe(true);
    expect(isWeeklyHoliday('Fri, Sat', '2026-11-14')).toBe(true);
    expect(isWeeklyHoliday('Friday', '2026-11-12')).toBe(false);
    expect(isWeeklyHoliday(null, '2026-11-13')).toBe(false);
  });

  it('works across people and dates', () => {
    const facts: AttendanceFacts = {
      staff: [
        {
          id: 's',
          employeeNo: 'N-1',
          fullName: 'Jane',
          departmentName: 'Nursing',
          designationName: 'Nurse',
          weeklyHoliday: 'Friday',
          lateGraceMinutes: 0,
        },
      ],
      duties: [{ staffId: 's', dutyDate: '2026-11-10', ...morning }],
      daysOff: [],
      holidays: [],
      leaves: [{ staffId: 's', from: '2026-11-11', to: '2026-11-11', name: 'CL' }],
      punches: [{ staffId: 's', punchedAt: at('2026-11-10', '08:01') }],
      manual: [],
    };
    expect(computeAttendance(facts, '2026-11-10', '2026-11-13', TZ).map((row) => row.status)).toEqual([
      'late',
      'leave',
      'absent',
      'day-off',
    ]);
    expect(localToday(new Date('2026-11-10T19:00:00Z'), TZ)).toBe('2026-11-11');
  });
});

describe('manual attendance rules', () => {
  const clerk: AttendanceActor = { userId: 'u-clerk', staffId: 'clerk', canEnter: true, canApprove: false };
  const boss: AttendanceActor = { userId: 'u-boss', staffId: 'boss', canEnter: true, canApprove: true };
  const now = new Date('2026-11-10T10:00:00Z');
  const create = (actor = clerk) =>
    ManualAttendance.create({
      id: 'm1',
      staffId: 'jane',
      attendanceDate: '2026-11-09',
      times: { inTime: '08:00', outTime: '14:00', reason: ' Device was down ' },
      actor,
      now,
    });

  it('validates the times like the old ValidateEntry', () => {
    expect(() => validManualTimes({ inTime: null, outTime: null, reason: 'x' })).toThrow(
      /in time, the out time or both/,
    );
    expect(() => validManualTimes({ inTime: '14:00', outTime: '08:00', reason: 'x' })).toThrow(/overnight/);
    expect(() => validManualTimes({ inTime: '8:00', outTime: null, reason: 'x' })).toThrow(DomainError);
    expect(validManualTimes({ inTime: '08:00', outTime: null, reason: '  late punch ' }).reason).toBe('late punch');
  });

  it('walks draft → pending → approved and blocks self-review', () => {
    const entry = create();
    expect(entry.toSnapshot()).toMatchObject({ status: 'draft', reason: 'Device was down', version: 1 });
    entry.submit(clerk, now);
    expect(() => entry.approve(clerk, undefined, now)).toThrow(ForbiddenError);
    const self = create(boss);
    self.submit(boss, now);
    expect(() => self.approve(boss, undefined, now)).toThrow(/entered or submitted/);
    const own = create();
    own.submit(clerk, now);
    expect(() => own.approve({ ...boss, staffId: 'jane' }, undefined, now)).toThrow(/your own/);

    entry.approve(boss, 'Checked with ward', now);
    expect(entry.toSnapshot()).toMatchObject({
      status: 'approved',
      decidedBy: 'u-boss',
      decisionRemarks: 'Checked with ward',
      version: 3,
    });
    expect(() => entry.edit({ inTime: '07:00' }, clerk, now)).toThrow(/cannot be edited/);
  });

  it('needs reasons to reject and cancel; revoking an approved entry needs an approver', () => {
    const entry = create();
    entry.submit(clerk, now);
    expect(() => entry.reject(boss, '', now)).toThrow(/reason for rejecting/);
    entry.reject(boss, 'Wrong day', now);
    entry.edit({ inTime: '08:30' }, clerk, now);
    entry.submit(clerk, now);
    entry.approve(boss, undefined, now);
    expect(() => entry.cancel(clerk, 'oops', now)).toThrow(ForbiddenError);
    entry.cancel(boss, 'Entered twice', now);
    expect(entry.status).toBe('cancelled');
  });

  it('lists the day checks of the old context procedure', () => {
    const base = {
      staffActive: true,
      isFuture: false,
      leave: null,
      otherEntryStatus: null,
      hasPunches: false,
      isDayOff: false,
    };
    expect(manualDayErrors(base)).toEqual([]);
    expect(
      manualDayErrors({ ...base, staffActive: false, isFuture: true, leave: 'CL', otherEntryStatus: 'pending' }),
    ).toHaveLength(4);
    expect(manualDayWarnings({ ...base, hasPunches: true, isDayOff: true })).toHaveLength(2);
  });
});
