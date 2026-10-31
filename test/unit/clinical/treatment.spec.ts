import { describe, expect, it } from 'vitest';
import {
  activePeriods,
  checkedSchedule,
  checkedSummary,
  dayBounds,
  dueTimes,
  TreatmentOrder,
  zonedInstant,
} from '../../../src/modules/clinical/domain/treatment.js';

const zone = 'Asia/Dhaka';
const dayOf = (at: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const local = (day: string, time: string) => zonedInstant(day, time, zone);

function order(schedule: 'times' | 'interval' | 'once' | 'prn', extra: object = {}) {
  return TreatmentOrder.start({
    id: 'o',
    admissionId: 'a',
    patientId: 'p',
    kind: 'medicine',
    productId: null,
    drugName: 'Inj. Ceftriaxone 1 g',
    dose: '1 g',
    route: 'iv',
    schedule,
    times: schedule === 'times' ? ['20:00', '08:00'] : [],
    intervalHours: schedule === 'interval' ? 6 : null,
    startAt: local('2026-10-30', '07:00'),
    note: null,
    doctorId: 'd',
    by: 'doctor',
    at: local('2026-10-30', '07:00'),
    ...extra,
  });
}

describe('times in the organisation’s zone', () => {
  it('turns a local wall-clock time into the instant, and a day into its bounds', () => {
    expect(local('2026-10-30', '08:00').toISOString()).toBe('2026-10-30T02:00:00.000Z');
    expect(dayBounds('2026-10-30', zone).map((at) => at.toISOString())).toEqual([
      '2026-10-29T18:00:00.000Z',
      '2026-10-30T18:00:00.000Z',
    ]);
    expect(zonedInstant('2026-03-29', '12:00', 'Europe/London').toISOString()).toBe('2026-03-29T11:00:00.000Z');
  });
});

describe('a schedule', () => {
  it('is set times, hours apart, once or when needed — each with its own fields only', () => {
    expect(
      checkedSchedule({ schedule: 'times', times: ['20:00', '08:00', '08:00'], intervalHours: null }).times,
    ).toEqual(['08:00', '20:00']);
    expect(() => checkedSchedule({ schedule: 'times', times: ['8am'], intervalHours: null })).toThrow(/HH:MM/);
    expect(() => checkedSchedule({ schedule: 'interval', times: [], intervalHours: 0 })).toThrow(/1 to 72 hours/);
    expect(() => checkedSchedule({ schedule: 'prn', times: ['08:00'], intervalHours: null })).toThrow(/set times only/);
    expect(() => checkedSchedule({ schedule: 'once', times: [], intervalHours: 4 })).toThrow(/every so many hours/);
  });

  it('is due at its times while in force, not while held', () => {
    const ordered = order('times');
    ordered.hold('NPO for surgery', 'doctor', local('2026-10-31', '07:00'));
    ordered.resume('doctor', local('2026-10-31', '14:00'));
    const due = (day: string) => {
      const [from, to] = dayBounds(day, zone);
      return dueTimes(ordered.toSnapshot(), ordered.periods, from, to, zone, dayOf).map((at) => at.toISOString());
    };
    expect(due('2026-10-30')).toEqual(
      [local('2026-10-30', '08:00'), local('2026-10-30', '20:00')].map((at) => at.toISOString()),
    );
    expect(due('2026-10-31')).toEqual([local('2026-10-31', '20:00').toISOString()]);
  });

  it('counts hours from the start, and gives one dose once, none when needed', () => {
    const [from, to] = dayBounds('2026-10-31', zone);
    const every = order('interval');
    expect(dueTimes(every.toSnapshot(), every.periods, from, to, zone, dayOf).map(dayOf)).toHaveLength(4);
    expect(dueTimes(every.toSnapshot(), every.periods, from, to, zone, dayOf)[0]).toEqual(local('2026-10-31', '01:00'));
    const [today, tomorrow] = dayBounds('2026-10-30', zone);
    const once = order('once');
    expect(dueTimes(once.toSnapshot(), once.periods, today, tomorrow, zone, dayOf)).toEqual([
      local('2026-10-30', '07:00'),
    ]);
    const prn = order('prn');
    expect(dueTimes(prn.toSnapshot(), prn.periods, today, tomorrow, zone, dayOf)).toEqual([]);
  });
});

describe('an order', () => {
  it('is held with a reason and resumed, or stopped for good', () => {
    const ordered = order('times');
    expect(() => ordered.resume('doctor', local('2026-10-30', '09:00'))).toThrow(/is active/);
    expect(() => ordered.hold(' ', 'doctor', local('2026-10-30', '09:00'))).toThrow(/Give the reason/);
    ordered.hold('Vomiting', 'doctor', local('2026-10-30', '09:00'));
    expect(ordered.inForceAt(local('2026-10-30', '10:00'))).toBe(false);
    ordered.stop('Course complete', 'doctor', local('2026-10-30', '11:00'));
    expect(() => ordered.stop('Again', 'doctor', local('2026-10-30', '12:00'))).toThrow(/is stopped/);
    expect(ordered.toSnapshot().events.map((entry) => entry.event)).toEqual(['start', 'hold', 'stop']);
    expect(activePeriods(ordered.toSnapshot().events)).toEqual([
      [local('2026-10-30', '07:00'), local('2026-10-30', '09:00')],
    ]);
  });

  it('is nursing care with no medicine and no route, or a medicine with its dose and route', () => {
    const care = order('interval', { kind: 'care', drugName: ' Turn the patient ', dose: null, route: null });
    expect(care.toSnapshot()).toMatchObject({ kind: 'care', drugName: 'Turn the patient', dose: null, route: null });
    expect(() => order('once', { kind: 'care', drugName: 'Dressing', dose: null, route: 'iv' })).toThrow(/no route/);
    expect(() => order('once', { kind: 'care', drugName: ' ', dose: null, route: null })).toThrow(/care ordered/);
    expect(() => order('once', { route: null })).toThrow(/Give the route/);
  });
});

describe('a discharge summary', () => {
  it('needs a name and dose per medicine and a follow-up not in the past', () => {
    const base = {
      diagnosis: ' Community-acquired pneumonia ',
      course: null,
      conditionOnDischarge: null,
      treatment: [{ productId: null, name: 'Tab. Cefuroxime 500 mg', dose: '1+0+1', duration: '7 days' }],
      diet: null,
      advice: null,
      followUpOn: '2026-11-06',
      followUpNote: null,
    };
    expect(checkedSummary(base, '2026-10-30').diagnosis).toBe('Community-acquired pneumonia');
    expect(() => checkedSummary({ ...base, followUpOn: '2026-10-01' }, '2026-10-30')).toThrow(/not in the past/);
    expect(() => checkedSummary({ ...base, treatment: [{ ...base.treatment[0]!, dose: '' }] }, '2026-10-30')).toThrow(
      /each medicine and its dose/,
    );
  });
});
