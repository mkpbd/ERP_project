import { describe, expect, it } from 'vitest';
import {
  checkedObservation,
  inRound,
  roundState,
  vitalFlags,
  type ObservationInput,
} from '../../../src/modules/clinical/domain/observation.js';

const none: ObservationInput = {
  temperatureF: null,
  pulse: null,
  respRate: null,
  systolic: null,
  diastolic: null,
  spo2: null,
  painScore: null,
  bloodSugar: null,
  intakeMl: null,
  outputMl: null,
  consciousness: null,
  note: null,
};
const error = (run: () => unknown) => {
  try {
    run();
  } catch (caught) {
    return (caught as Error).message;
  }
  return null;
};

describe('an observation', () => {
  it('keeps readings within their bounds, both pressures, something recorded', () => {
    expect(checkedObservation({ ...none, temperatureF: 98.64, note: '  Comfortable ' })).toMatchObject({
      temperatureF: 98.6,
      note: 'Comfortable',
    });
    expect(error(() => checkedObservation(none))).toMatch(/a reading or a note/);
    expect(error(() => checkedObservation({ ...none, pulse: 300 }))).toMatch(/Pulse is 20 to 250/);
    expect(error(() => checkedObservation({ ...none, pulse: 80.5 }))).toMatch(/whole number/);
    expect(error(() => checkedObservation({ ...none, systolic: 120 }))).toMatch(/both pressures/);
    expect(error(() => checkedObservation({ ...none, systolic: 80, diastolic: 90 }))).toMatch(/below the systolic/);
    expect(checkedObservation({ ...none, consciousness: 'voice' }).consciousness).toBe('voice');
  });

  it('flags the readings a nurse reports', () => {
    expect(
      vitalFlags({ ...none, temperatureF: 100.4, pulse: 48, respRate: 26, spo2: 90, systolic: 85, diastolic: 50 }),
    ).toEqual(['fever', 'bradycardia', 'tachypnoea', 'low_spo2', 'hypotension']);
    expect(vitalFlags({ ...none, systolic: 150, diastolic: 112, bloodSugar: 3.5, consciousness: 'pain' })).toEqual([
      'hypertension',
      'hypoglycaemia',
      'not_alert',
    ]);
    expect(vitalFlags({ ...none, temperatureF: 98.6, pulse: 80, spo2: 98 })).toEqual([]);
  });
});

describe('a round', () => {
  const night = { id: 'n', name: 'Night', startTime: '22:00', endTime: '06:00' };
  const morning = { id: 'm', name: 'Morning', startTime: '06:00', endTime: '12:00' };

  it('holds the times of its window, a night round past midnight', () => {
    expect([inRound(morning, '06:00'), inRound(morning, '11:59'), inRound(morning, '12:00')]).toEqual([
      true,
      true,
      false,
    ]);
    expect([inRound(night, '23:30'), inRound(night, '02:00'), inRound(night, '06:00')]).toEqual([true, true, false]);
  });

  it('is done, to come, due while open, missed once closed', () => {
    const start = new Date('2026-10-31T00:00:00Z');
    const end = new Date('2026-10-31T06:00:00Z');
    expect(roundState(true, start, end, new Date('2026-10-30T00:00:00Z'))).toBe('done');
    expect(roundState(false, start, end, new Date('2026-10-30T23:00:00Z'))).toBe('upcoming');
    expect(roundState(false, start, end, new Date('2026-10-31T03:00:00Z'))).toBe('due');
    expect(roundState(false, start, end, new Date('2026-10-31T06:00:00Z'))).toBe('missed');
  });
});
