import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { text } from './prescription.js';

export const ROUTES = ['oral', 'iv', 'im', 'sc', 'topical', 'inhaled', 'rectal', 'other'] as const;
export type Route = (typeof ROUTES)[number];
export const SCHEDULES = ['times', 'interval', 'once', 'prn'] as const;
export type Schedule = (typeof SCHEDULES)[number];
export type OrderStatus = 'active' | 'held' | 'stopped';
export type OrderEventKind = 'start' | 'hold' | 'resume' | 'stop';

const HOUR = 3_600_000;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function offsetAt(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)!.value);
  const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
  return wall - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant a wall-clock time of a day is in the time zone. */
export function zonedInstant(day: string, time: string, timeZone: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetAt(new Date(wall), timeZone);
  const second = offsetAt(new Date(wall - first), timeZone);
  return new Date(wall - second);
}

export function nextDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** The day's first instant and the next day's, in the time zone. */
export function dayBounds(day: string, timeZone: string): [Date, Date] {
  return [zonedInstant(day, '00:00', timeZone), zonedInstant(nextDay(day), '00:00', timeZone)];
}

export interface OrderEvent {
  event: OrderEventKind;
  at: Date;
  note: string | null;
  by: string;
}

/** When the order was in force: from each start or resume to the next hold or stop (open while active). */
export function activePeriods(events: readonly OrderEvent[]): [Date, Date | null][] {
  const periods: [Date, Date | null][] = [];
  for (const entry of events) {
    if (entry.event === 'start' || entry.event === 'resume') periods.push([entry.at, null]);
    else if (periods.length && periods[periods.length - 1]![1] === null) periods[periods.length - 1]![1] = entry.at;
  }
  return periods;
}

export interface DoseSchedule {
  schedule: Schedule;
  times: readonly string[];
  intervalHours: number | null;
  startAt: Date;
}

/** Due times of the order within [from, to) while it was in force, oldest first. */
export function dueTimes(
  order: DoseSchedule,
  periods: readonly [Date, Date | null][],
  from: Date,
  to: Date,
  timeZone: string,
  dayOf: (at: Date) => string,
): Date[] {
  const inForce = (at: Date) =>
    periods.some(([start, end]) => at.getTime() >= start.getTime() && (end === null || at.getTime() < end.getTime()));
  const within = (at: Date) => at.getTime() >= from.getTime() && at.getTime() < to.getTime();
  const due: Date[] = [];
  if (order.schedule === 'once') {
    if (within(order.startAt) && inForce(order.startAt)) due.push(order.startAt);
  } else if (order.schedule === 'interval') {
    const step = order.intervalHours! * HOUR;
    const skip = Math.max(0, Math.ceil((from.getTime() - order.startAt.getTime()) / step));
    for (let at = order.startAt.getTime() + skip * step; at < to.getTime(); at += step) {
      const moment = new Date(at);
      if (within(moment) && inForce(moment)) due.push(moment);
    }
  } else if (order.schedule === 'times') {
    for (let day = dayOf(from); day <= dayOf(new Date(to.getTime() - 1)); day = nextDay(day)) {
      for (const time of [...order.times].sort()) {
        const moment = zonedInstant(day, time, timeZone);
        if (within(moment) && moment.getTime() >= order.startAt.getTime() && inForce(moment)) due.push(moment);
      }
    }
  }
  return due;
}

export interface OrderProps extends DoseSchedule {
  id: string;
  admissionId: string;
  patientId: string;
  productId: string | null;
  drugName: string;
  dose: string;
  route: Route;
  note: string | null;
  status: OrderStatus;
  doctorId: string;
  orderedBy: string;
  events: OrderEvent[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The schedule as given: set times for `times`, hours for `interval`, nothing for `once` and `prn`. */
export function checkedSchedule(input: Pick<DoseSchedule, 'schedule' | 'times' | 'intervalHours'>) {
  const times = [...new Set(input.times)].sort();
  if (input.schedule === 'times') {
    if (times.length === 0 || times.length > 12 || times.some((time) => !TIME.test(time))) {
      throw new DomainError('invalid_schedule', 'Give 1 to 12 times of day as HH:MM');
    }
  } else if (times.length > 0) {
    throw new DomainError('invalid_schedule', 'Times of day are for a schedule at set times only');
  }
  if (input.schedule === 'interval') {
    if (!Number.isInteger(input.intervalHours) || input.intervalHours! < 1 || input.intervalHours! > 72) {
      throw new DomainError('invalid_schedule', 'An interval is 1 to 72 hours');
    }
  } else if (input.intervalHours !== null) {
    throw new DomainError('invalid_schedule', 'Hours between doses are for a schedule every so many hours only');
  }
  return { schedule: input.schedule, times, intervalHours: input.intervalHours };
}

/**
 * Old RxIpdTreatment: a medicine ordered by the doctor for an admitted patient. It is in force from its start until
 * held or stopped; a held order is resumed; a stopped one is done. Each change is kept as an event with its note.
 */
export class TreatmentOrder {
  private constructor(private readonly props: OrderProps) {}

  static start(params: {
    id: string;
    admissionId: string;
    patientId: string;
    productId: string | null;
    drugName: string;
    dose: string;
    route: Route;
    schedule: Schedule;
    times: readonly string[];
    intervalHours: number | null;
    startAt: Date;
    note: string | null;
    doctorId: string;
    by: string;
    at: Date;
  }): TreatmentOrder {
    const drugName = text(params.drugName, 200, 'medicine');
    const dose = text(params.dose, 200, 'dose');
    if (!drugName || !dose) throw new DomainError('invalid_text', 'Give the medicine and its dose');
    return new TreatmentOrder({
      id: params.id,
      admissionId: params.admissionId,
      patientId: params.patientId,
      productId: params.productId,
      drugName,
      dose,
      route: params.route,
      ...checkedSchedule(params),
      startAt: params.startAt,
      note: text(params.note, 500, 'note'),
      status: 'active',
      doctorId: params.doctorId,
      orderedBy: params.by,
      events: [{ event: 'start', at: params.startAt, note: null, by: params.by }],
      version: 1,
      createdAt: params.at,
      updatedAt: params.at,
    });
  }

  static restore(props: OrderProps): TreatmentOrder {
    return new TreatmentOrder({ ...props, events: [...props.events] });
  }

  get id(): string {
    return this.props.id;
  }
  get admissionId(): string {
    return this.props.admissionId;
  }
  get status(): OrderStatus {
    return this.props.status;
  }
  get schedule(): Schedule {
    return this.props.schedule;
  }
  get periods(): [Date, Date | null][] {
    return activePeriods(this.props.events);
  }

  hold(reason: string, by: string, at: Date): void {
    this.change('active', 'held', 'hold', reason, by, at);
  }

  resume(by: string, at: Date): void {
    this.change('held', 'active', 'resume', null, by, at);
  }

  stop(reason: string, by: string, at: Date): void {
    if (this.props.status === 'stopped') throw new DomainError('order_state', 'The order is stopped');
    this.change(this.props.status, 'stopped', 'stop', reason, by, at);
  }

  /** In force at that moment (a dose may be given then). */
  inForceAt(at: Date): boolean {
    return this.periods.some(
      ([start, end]) => at.getTime() >= start.getTime() && (end === null || at.getTime() < end.getTime()),
    );
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_order', 'The order was changed meanwhile; reload it');
    }
  }

  toSnapshot(): Readonly<OrderProps> {
    return { ...this.props, events: [...this.props.events] };
  }

  private change(
    from: OrderStatus,
    to: OrderStatus,
    event: OrderEventKind,
    reason: string | null,
    by: string,
    at: Date,
  ): void {
    if (this.props.status !== from) throw new DomainError('order_state', `The order is ${this.props.status}`);
    const note = reason === null ? null : text(reason, 300, 'reason');
    if (reason !== null && !note) throw new DomainError('invalid_text', 'Give the reason');
    // Held or stopped before it started: from its start (nothing was due).
    const when = at.getTime() < this.props.startAt.getTime() ? this.props.startAt : at;
    this.props.events.push({ event, at: when, note, by });
    this.props.status = to;
    this.props.version += 1;
    this.props.updatedAt = at;
  }
}

export interface DischargeTreatment {
  productId: string | null;
  name: string;
  dose: string;
  duration: string | null;
}

export interface SummaryContent {
  diagnosis: string | null;
  course: string | null;
  conditionOnDischarge: string | null;
  treatment: DischargeTreatment[];
  diet: string | null;
  advice: string | null;
  followUpOn: string | null;
  followUpNote: string | null;
}

/** Old TreatmentOnDischarge / DietOnDischarge / advice: what the doctor writes for the patient going home. */
export function checkedSummary(content: SummaryContent, today: string): SummaryContent {
  if (content.treatment.length > 40) throw new DomainError('too_many_lines', 'At most 40 medicines');
  if (content.followUpOn !== null && content.followUpOn < today) {
    throw new DomainError('invalid_date', 'The follow-up is not in the past');
  }
  return {
    diagnosis: text(content.diagnosis, 1000, 'diagnosis'),
    course: text(content.course, 8000, 'course in hospital'),
    conditionOnDischarge: text(content.conditionOnDischarge, 500, 'condition on discharge'),
    treatment: content.treatment.map((line) => {
      const name = text(line.name, 200, 'medicine');
      const dose = text(line.dose, 300, 'dose');
      if (!name || !dose) throw new DomainError('invalid_text', 'Give each medicine and its dose');
      return { productId: line.productId, name, dose, duration: text(line.duration, 100, 'duration') };
    }),
    diet: text(content.diet, 1000, 'diet'),
    advice: text(content.advice, 2000, 'advice'),
    followUpOn: content.followUpOn,
    followUpNote: text(content.followUpNote, 300, 'follow-up note'),
  };
}
