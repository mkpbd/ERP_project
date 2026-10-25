import { describe, expect, it } from 'vitest';
import { cellVersion } from '../../../src/modules/hr/application/roster.read-models.js';
import {
  addDays,
  clockMinutes,
  planRosterDay,
  shiftInterval,
  zonedInstant,
  type Duty,
  type RosterEntry,
  type ShiftType,
} from '../../../src/modules/hr/domain/roster.js';
import { DomainError } from '../../../src/shared/domain/errors.js';

const TZ = 'Asia/Dhaka';
const morning: ShiftType = { id: 'm', departmentId: 'nursing', code: 'M', startTime: '08:00', endTime: '14:00' };
const evening: ShiftType = { id: 'e', departmentId: 'nursing', code: 'E', startTime: '14:00', endTime: '20:00' };
const night: ShiftType = { id: 'n', departmentId: 'nursing', code: 'N', startTime: '20:00', endTime: '08:00' };
const long: ShiftType = { id: 'l', departmentId: 'nursing', code: 'L', startTime: '12:00', endTime: '22:00' };
const lateNight: ShiftType = { id: 'ln', departmentId: 'nursing', code: 'LN', startTime: '22:00', endTime: '09:00' };
const other: ShiftType = { id: 'x', departmentId: 'pharmacy', code: 'X', startTime: '09:00', endTime: '17:00' };
const types = new Map([morning, evening, night, long, lateNight, other].map((type) => [type.id, type]));
const scope = { departmentId: 'nursing', subDepartmentId: 'icu', firstDay: '2026-11-01', lastDay: '2026-11-30' };
const placed = { active: true, departmentId: 'nursing', subDepartmentId: 'icu' };

function duty(type: ShiftType, date: string, id = `${type.id}-${date}`): Duty {
  return {
    id,
    staffId: 'jane',
    dutyDate: date,
    shiftTypeId: type.id,
    code: type.code,
    ...shiftInterval(date, type, TZ),
    remarks: null,
  };
}

function entry(overrides: Partial<RosterEntry> = {}): RosterEntry {
  return { staffId: 'jane', date: '2026-11-10', shifts: [], dayOff: false, dayOffRemarks: null, ...overrides };
}

function plan(input: {
  entry: RosterEntry;
  duties?: Duty[];
  otherDuties?: Duty[];
  dayOff?: { remarks: string | null } | null;
}) {
  return planRosterDay({
    entry: input.entry,
    current: { duties: input.duties ?? [], dayOff: input.dayOff ?? null },
    staff: placed,
    scope,
    shiftTypes: types,
    otherDuties: input.otherDuties ?? [],
    timeZone: TZ,
  });
}

describe('time arithmetic', () => {
  it('parses 24-hour clock times', () => {
    expect(clockMinutes('20:30')).toBe(1230);
    expect(() => clockMinutes('8:00')).toThrow(DomainError);
    expect(() => clockMinutes('24:00')).toThrow(DomainError);
  });

  it('places wall-clock times in the organization time zone', () => {
    expect(zonedInstant('2026-11-10', '08:00', TZ).toISOString()).toBe('2026-11-10T02:00:00.000Z');
    expect(zonedInstant('2026-11-10', '02:00', TZ).toISOString()).toBe('2026-11-09T20:00:00.000Z');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('lets night shifts end the next day', () => {
    const interval = shiftInterval('2026-11-10', night, TZ);
    expect(interval.startAt.toISOString()).toBe('2026-11-10T14:00:00.000Z');
    expect(interval.endAt.toISOString()).toBe('2026-11-11T02:00:00.000Z');
  });
});

describe('planning a roster cell', () => {
  it('adds back-to-back shifts', () => {
    const result = plan({
      entry: entry({
        shifts: [
          { shiftTypeId: 'm', remarks: null },
          { shiftTypeId: 'e', remarks: ' Ward 3 ' },
        ],
      }),
    });
    expect('plan' in result && result.plan.inserts.map((insert) => [insert.code, insert.remarks])).toEqual([
      ['M', null],
      ['E', 'Ward 3'],
    ]);
  });

  it('refuses overlapping shifts, including a night shift from the day before', () => {
    // A night shift ending exactly when the next starts only touches it.
    expect(
      'plan' in
        plan({
          entry: entry({ shifts: [{ shiftTypeId: 'm', remarks: null }] }),
          otherDuties: [duty(night, '2026-11-09')],
        }),
    ).toBe(true);
    expect(
      plan({
        entry: entry({
          shifts: [
            { shiftTypeId: 'm', remarks: null },
            { shiftTypeId: 'l', remarks: null },
          ],
        }),
      }),
    ).toEqual({
      errors: ['Shift L overlaps shift M on 2026-11-10'],
    });
    const result = plan({
      entry: entry({ shifts: [{ shiftTypeId: 'm', remarks: null }] }),
      otherDuties: [duty(lateNight, '2026-11-09')],
    });
    expect(result).toEqual({ errors: ['Shift M overlaps shift LN on 2026-11-09'] });
  });

  it('keeps existing duties, updates their remarks and removes the rest', () => {
    const existing = [duty(morning, '2026-11-10'), duty(evening, '2026-11-10')];
    const result = plan({ entry: entry({ shifts: [{ shiftTypeId: 'm', remarks: 'cover' }] }), duties: existing });
    expect('plan' in result && result.plan).toMatchObject({
      inserts: [],
      remarkUpdates: [{ id: 'm-2026-11-10', remarks: 'cover' }],
      deletes: ['e-2026-11-10'],
      dayOff: 'keep',
    });
  });

  it('never mixes a duty and a day off', () => {
    expect(plan({ entry: entry({ dayOff: true, shifts: [{ shiftTypeId: 'm', remarks: null }] }) })).toEqual({
      errors: ['A day cannot hold both a duty and a day off'],
    });
    const off = plan({ entry: entry({ dayOff: true, dayOffRemarks: 'Weekly off' }) });
    expect('plan' in off && off.plan).toMatchObject({ dayOff: 'set', dayOffRemarks: 'Weekly off' });
    const cleared = plan({ entry: entry(), dayOff: { remarks: null } });
    expect('plan' in cleared && cleared.plan.dayOff).toBe('clear');
  });

  it('checks the month, the department and who may be rostered', () => {
    expect(plan({ entry: entry({ date: '2026-12-01', shifts: [{ shiftTypeId: 'm', remarks: null }] }) })).toMatchObject(
      {
        errors: ['The date is outside the roster month'],
      },
    );
    expect(plan({ entry: entry({ shifts: [{ shiftTypeId: 'x', remarks: null }] }) })).toEqual({
      errors: ['That shift type is not set up for this department'],
    });
    const inactive = planRosterDay({
      entry: entry({ shifts: [{ shiftTypeId: 'm', remarks: null }] }),
      current: { duties: [], dayOff: null },
      staff: { ...placed, active: false },
      scope,
      shiftTypes: types,
      otherDuties: [],
      timeZone: TZ,
    });
    expect(inactive).toEqual({ errors: ['The staff member is not active; new duties or days off cannot be added'] });
  });
});

describe('cell versions', () => {
  it('is empty for an empty cell and changes with the content', () => {
    expect(cellVersion([], null)).toBe('');
    const a = cellVersion([duty(morning, '2026-11-10')], null);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(cellVersion([{ ...duty(morning, '2026-11-10'), remarks: 'x' }], null)).not.toBe(a);
  });
});
