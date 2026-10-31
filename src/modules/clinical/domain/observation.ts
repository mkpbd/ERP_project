import { DomainError } from '../../../shared/domain/errors.js';
import { text } from './prescription.js';

/** Alert, responds to voice, to pain, unresponsive. */
export const CONSCIOUSNESS = ['alert', 'voice', 'pain', 'unresponsive'] as const;
export type Consciousness = (typeof CONSCIOUSNESS)[number];

/** What a nurse measures at an observation round (old follow-up sheet's dynamic form, as fixed fields). */
export interface Vitals {
  /** °F, as the wards read it. */
  readonly temperatureF: number | null;
  readonly pulse: number | null;
  readonly respRate: number | null;
  readonly systolic: number | null;
  readonly diastolic: number | null;
  readonly spo2: number | null;
  /** 0 (none) to 10 (worst). */
  readonly painScore: number | null;
  /** mmol/L. */
  readonly bloodSugar: number | null;
  readonly intakeMl: number | null;
  readonly outputMl: number | null;
  readonly consciousness: Consciousness | null;
}

export interface ObservationInput extends Vitals {
  readonly note: string | null;
}

/** Plausible bounds: a value outside is a typing mistake, not a reading. */
const BOUNDS: Record<Exclude<keyof Vitals, 'consciousness'>, [number, number, string]> = {
  temperatureF: [86, 113, 'Temperature (°F)'],
  pulse: [20, 250, 'Pulse'],
  respRate: [4, 80, 'Respiratory rate'],
  systolic: [40, 300, 'Systolic pressure'],
  diastolic: [20, 200, 'Diastolic pressure'],
  spo2: [40, 100, 'SpO2'],
  painScore: [0, 10, 'Pain score'],
  bloodSugar: [1, 40, 'Blood sugar (mmol/L)'],
  intakeMl: [0, 20_000, 'Intake (ml)'],
  outputMl: [0, 20_000, 'Output (ml)'],
};
const WHOLE: readonly (keyof Vitals)[] = [
  'pulse',
  'respRate',
  'systolic',
  'diastolic',
  'spo2',
  'painScore',
  'intakeMl',
  'outputMl',
];

/** An observation as it may be kept: each value within its bounds, at least something measured or written. */
export function checkedObservation(input: ObservationInput): ObservationInput {
  for (const [key, [low, high, label]] of Object.entries(BOUNDS) as [keyof typeof BOUNDS, [number, number, string]][]) {
    const value = input[key];
    if (value === null) continue;
    if (!Number.isFinite(value) || value < low || value > high) {
      throw new DomainError('invalid_vitals', `${label} is ${low} to ${high}`);
    }
    if (WHOLE.includes(key) && !Number.isInteger(value)) {
      throw new DomainError('invalid_vitals', `${label} is a whole number`);
    }
  }
  if ((input.systolic === null) !== (input.diastolic === null)) {
    throw new DomainError('invalid_vitals', 'Give both pressures, systolic and diastolic');
  }
  if (input.systolic !== null && input.diastolic !== null && input.diastolic >= input.systolic) {
    throw new DomainError('invalid_vitals', 'The diastolic pressure is below the systolic');
  }
  const note = text(input.note, 1000, 'note');
  const measured = (Object.keys(BOUNDS) as (keyof Vitals)[]).some((key) => input[key] !== null);
  if (!measured && input.consciousness === null && !note) {
    throw new DomainError('invalid_vitals', 'Record a reading or a note');
  }
  return {
    ...input,
    temperatureF: input.temperatureF === null ? null : Math.round(input.temperatureF * 10) / 10,
    bloodSugar: input.bloodSugar === null ? null : Math.round(input.bloodSugar * 10) / 10,
    note,
  };
}

export type VitalFlag =
  | 'fever'
  | 'hypothermia'
  | 'tachycardia'
  | 'bradycardia'
  | 'tachypnoea'
  | 'bradypnoea'
  | 'low_spo2'
  | 'hypotension'
  | 'hypertension'
  | 'hypoglycaemia'
  | 'hyperglycaemia'
  | 'not_alert';

/** Readings a nurse should tell the doctor about (common ward thresholds, not a score). */
export function vitalFlags(vitals: Vitals): VitalFlag[] {
  const flags: VitalFlag[] = [];
  const add = (flag: VitalFlag, when: boolean) => {
    if (when) flags.push(flag);
  };
  const { temperatureF: t, pulse, respRate, spo2, systolic, diastolic, bloodSugar } = vitals;
  add('fever', t !== null && t >= 100.4);
  add('hypothermia', t !== null && t < 95);
  add('tachycardia', pulse !== null && pulse > 120);
  add('bradycardia', pulse !== null && pulse < 50);
  add('tachypnoea', respRate !== null && respRate > 24);
  add('bradypnoea', respRate !== null && respRate < 10);
  add('low_spo2', spo2 !== null && spo2 < 92);
  add('hypotension', systolic !== null && systolic < 90);
  add('hypertension', (systolic !== null && systolic >= 180) || (diastolic !== null && diastolic >= 110));
  add('hypoglycaemia', bloodSugar !== null && bloodSugar < 3.9);
  add('hyperglycaemia', bloodSugar !== null && bloodSugar > 16.7);
  add('not_alert', vitals.consciousness !== null && vitals.consciousness !== 'alert');
  return flags;
}

export interface ObservationRound {
  readonly id: string;
  readonly name: string;
  /** HH:MM, the organisation's time. */
  readonly startTime: string;
  /** HH:MM; at or before the start: the next day (a night round). */
  readonly endTime: string;
}

/** The minutes after midnight of an HH:MM time. */
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Whether a local time of day falls in a round's window (a night round wraps past midnight). */
export function inRound(round: ObservationRound, time: string): boolean {
  const at = minutes(time);
  const start = minutes(round.startTime);
  const end = minutes(round.endTime);
  return end > start ? at >= start && at < end : at >= start || at < end;
}

export type RoundState = 'done' | 'due' | 'missed' | 'upcoming';

/** A round of a day: done when an observation answers it, else upcoming, due (its window open) or missed. */
export function roundState(done: boolean, windowStart: Date, windowEnd: Date, now: Date): RoundState {
  if (done) return 'done';
  if (now.getTime() < windowStart.getTime()) return 'upcoming';
  return now.getTime() < windowEnd.getTime() ? 'due' : 'missed';
}
