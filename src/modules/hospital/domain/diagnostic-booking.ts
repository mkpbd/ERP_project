import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { text } from './patient.js';

/** By `getUTCDay()`: 0 = Sunday … 6 = Saturday. */
export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export const TEST_APPOINTMENT_STATUSES = ['booked', 'billed', 'no_show', 'cancelled'] as const;
export type TestAppointmentStatus = (typeof TEST_APPOINTMENT_STATUSES)[number];
export const HOME_COLLECTION_STATUSES = ['booked', 'assigned', 'collected', 'cancelled'] as const;
export type HomeCollectionStatus = (typeof HOME_COLLECTION_STATUSES)[number];
/** Who made the booking: the desk (a call, a walk-in) or the patient on the portal (old: the mobile app). */
export const BOOKED_VIA = ['desk', 'portal'] as const;
export type BookedVia = (typeof BOOKED_VIA)[number];

export const MAX_BOOKING_TESTS = 20;
/** How far ahead a day may be booked. */
export const BOOKING_DAYS_AHEAD = 60;

const paisa = (value: number) => Math.round(value * 100);
const taka = (paisas: number) => paisas / 100;

/** A test on a booking, at the rate it was quoted. */
export interface QuotedTest {
  readonly testId: string;
  readonly rate: number;
}

/** The booker's patient: registered (with an id), or a name and a mobile number until they are. */
export interface BookingPatient {
  readonly patientId: string | null;
  readonly patientName: string;
  readonly mobileNo: string;
}

const dayAfter = (isoDay: string, days: number) => {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const weekdayName = (isoDay: string): Weekday => WEEKDAYS[new Date(`${isoDay}T00:00:00Z`).getUTCDay()]!;

/** A day from today up to BOOKING_DAYS_AHEAD days on. */
export function assertBookableDay(isoDay: string, today: string): void {
  if (isoDay < today) throw new DomainError('invalid_date', 'A booking is not made for a day gone by');
  if (isoDay > dayAfter(today, BOOKING_DAYS_AHEAD)) {
    throw new DomainError('invalid_date', `Bookings are taken up to ${BOOKING_DAYS_AHEAD} days ahead`);
  }
}

/** The tests' total: 1 to MAX_BOOKING_TESTS tests, each once. */
export function quoteTotal(tests: readonly QuotedTest[]): number {
  if (tests.length === 0 || tests.length > MAX_BOOKING_TESTS) {
    throw new DomainError('invalid_lines', `A booking has 1 to ${MAX_BOOKING_TESTS} tests`);
  }
  if (new Set(tests.map((test) => test.testId)).size !== tests.length) {
    throw new DomainError('duplicate_test', 'A test is on the booking twice');
  }
  return taka(tests.reduce((total, test) => total + paisa(test.rate), 0));
}

/** A window of the day is over once its end (or, without one, its start) has come. */
export const windowOver = (window: { startTime: string; endTime: string | null }, timeNow: string) =>
  (window.endTime ?? window.startTime) <= timeNow;

/**
 * Old serial: the count of live bookings in the window plus one. Here the first serial free (a cancelled booking frees
 * its own), within the window's daily capacity, chosen under a lock on the window's day.
 */
export function chooseWindowSerial(capacity: number, taken: ReadonlySet<number>): number {
  for (let serial = 1; serial <= capacity; serial += 1) if (!taken.has(serial)) return serial;
  throw new DomainError('fully_booked', `All ${capacity} places of the window are booked`);
}

/** Old AvailableDays: blank means every day. */
export const servesOn = (days: readonly Weekday[], isoDay: string) =>
  days.length === 0 || days.includes(weekdayName(isoDay));

function patientOf(patient: BookingPatient): BookingPatient {
  const patientName = text(patient.patientName, 150, 'name');
  if (!patientName) throw new DomainError('invalid_name', "Give the patient's name");
  return { patientId: patient.patientId, patientName, mobileNo: patient.mobileNo };
}

interface Billable {
  patientId: string | null;
  patientName: string;
  mobileNo: string;
  billId: string | null;
}

/** The booking's patient becomes the bill's: a booking made before registering takes the registered patient. */
function linkBill(props: Billable, billId: string, patient: { id: string; fullName: string; mobileNo: string }) {
  if (props.billId !== null) throw new DomainError('booking_billed', 'The booking is billed already');
  if (props.patientId !== null && props.patientId !== patient.id) {
    throw new DomainError('booking_patient_mismatch', 'The booking is of another patient');
  }
  props.patientId = patient.id;
  props.patientName = patient.fullName;
  props.mobileNo = patient.mobileNo;
  props.billId = billId;
}

function reasonOf(reason: string): string {
  const why = text(reason, 300, 'reason');
  if (!why) throw new DomainError('invalid_remarks', 'Give a reason');
  return why;
}

const assertVersionOf = (props: { version: number }, version: number) => {
  if (version !== props.version) {
    throw new ConflictError('stale_booking', 'The booking was changed by someone else; reload it');
  }
};

export interface TestAppointmentProps extends Billable {
  id: string;
  number: string;
  appointmentDate: string;
  windowId: string;
  /** The window as booked: a window changed later does not move the bookings in it. */
  windowLabel: string;
  startTime: string;
  endTime: string | null;
  serial: number;
  tests: QuotedTest[];
  amount: number;
  status: TestAppointmentStatus;
  statusReason: string | null;
  remarks: string | null;
  bookedVia: BookedVia;
  bookedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old Diag.TestAppointments (booked from the mobile app, worked on the test appointment dashboard): tests booked for a
 * day in a window, with a serial within the window's capacity. The tests are quoted, not paid: on the day the patient
 * is billed for them (then the booking is billed), or misses the day, or cancels.
 */
export class TestAppointment {
  private constructor(private readonly props: TestAppointmentProps) {}

  static book(params: {
    id: string;
    number: string;
    patient: BookingPatient;
    appointmentDate: string;
    window: { id: string; label: string; startTime: string; endTime: string | null };
    serial: number;
    tests: readonly QuotedTest[];
    remarks: string | null;
    bookedVia: BookedVia;
    bookedBy: string | null;
    today: string;
    now: Date;
  }): TestAppointment {
    assertBookableDay(params.appointmentDate, params.today);
    const amount = quoteTotal(params.tests);
    return new TestAppointment({
      id: params.id,
      number: params.number,
      ...patientOf(params.patient),
      appointmentDate: params.appointmentDate,
      windowId: params.window.id,
      windowLabel: params.window.label,
      startTime: params.window.startTime,
      endTime: params.window.endTime,
      serial: params.serial,
      tests: [...params.tests],
      amount,
      status: 'booked',
      statusReason: null,
      billId: null,
      remarks: text(params.remarks, 300, 'remarks'),
      bookedVia: params.bookedVia,
      bookedBy: params.bookedBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: TestAppointmentProps): TestAppointment {
    return new TestAppointment({ ...props, tests: [...props.tests] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get patientId(): string | null {
    return this.props.patientId;
  }
  get status(): TestAppointmentStatus {
    return this.props.status;
  }

  /** The patient came on the day and was billed (old: Arrived, then Completed). */
  billed(billId: string, patient: { id: string; fullName: string; mobileNo: string }, today: string, now: Date) {
    this.assertBooked('billed');
    if (this.props.appointmentDate !== today) {
      throw new DomainError('invalid_date', 'A test appointment is billed on its day');
    }
    linkBill(this.props, billId, patient);
    this.props.status = 'billed';
    this.touch(now);
  }

  /** The day went by without the patient. */
  noShow(today: string, now: Date): void {
    this.assertBooked('marked a no-show');
    if (this.props.appointmentDate > today) {
      throw new DomainError('invalid_date', 'A patient misses an appointment only on or after its day');
    }
    this.props.status = 'no_show';
    this.touch(now);
  }

  cancel(reason: string, now: Date): void {
    this.assertBooked('cancelled');
    this.props.status = 'cancelled';
    this.props.statusReason = reasonOf(reason);
    this.touch(now);
  }

  /** The patient registered after booking. */
  attach(patient: { id: string; fullName: string; mobileNo: string }, now: Date): void {
    this.assertBooked('changed');
    this.props.patientId = patient.id;
    this.props.patientName = patient.fullName;
    this.props.mobileNo = patient.mobileNo;
    this.touch(now);
  }

  assertVersion(version: number): void {
    assertVersionOf(this.props, version);
  }

  toSnapshot(): Readonly<TestAppointmentProps> {
    return { ...this.props, tests: [...this.props.tests] };
  }

  private assertBooked(action: string): void {
    if (this.props.status !== 'booked') {
      throw new DomainError(
        'booking_state',
        `A ${this.props.status.replace('_', '-')} appointment cannot be ${action}`,
      );
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}

export interface HomeCollectionProps extends Billable {
  id: string;
  number: string;
  areaId: string;
  address: string;
  landmark: string | null;
  collectionDate: string;
  windowId: string;
  /** The window as booked (old: the label stored on the booking and handed to the collector). */
  windowLabel: string;
  tests: QuotedTest[];
  amount: number;
  /** The area's charge for the visit when booked. */
  charge: number;
  status: HomeCollectionStatus;
  statusReason: string | null;
  collectorId: string | null;
  assignedAt: Date | null;
  collectedAt: Date | null;
  collectedBy: string | null;
  collectionNote: string | null;
  patientNote: string | null;
  bookedVia: BookedVia;
  bookedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old Diag.HomeSampleCollections (booked from the mobile app; the old desk had no screen for them): a collector sent
 * to the patient's address in an area on a day and window, for tests whose samples are taken at home. The area sets
 * the visit's charge, the smallest order it takes and the days it is served. The desk gives it a collector, who
 * records the samples as taken; the bill (the tests and the charge) is made before the visit or after it.
 */
export class HomeCollection {
  private constructor(private readonly props: HomeCollectionProps) {}

  static book(params: {
    id: string;
    number: string;
    patient: BookingPatient;
    area: { id: string; name: string; charge: number; minimumOrder: number; days: readonly Weekday[] };
    address: string;
    landmark: string | null;
    collectionDate: string;
    window: { id: string; label: string };
    tests: readonly QuotedTest[];
    patientNote: string | null;
    bookedVia: BookedVia;
    bookedBy: string | null;
    today: string;
    now: Date;
  }): HomeCollection {
    assertBookableDay(params.collectionDate, params.today);
    const { area } = params;
    if (!servesOn(area.days, params.collectionDate)) {
      const day = weekdayName(params.collectionDate);
      throw new DomainError('area_closed', `${area.name} is not served on ${day[0]!.toUpperCase()}${day.slice(1)}`);
    }
    const amount = quoteTotal(params.tests);
    if (amount < area.minimumOrder) {
      throw new DomainError(
        'below_minimum',
        `The tests come to ${amount.toFixed(2)}; a home collection in ${area.name} starts at ` +
          `${area.minimumOrder.toFixed(2)} (${taka(paisa(area.minimumOrder) - paisa(amount)).toFixed(2)} short)`,
      );
    }
    const address = text(params.address, 300, 'address');
    if (!address) throw new DomainError('invalid_address', 'Give the address to collect from');
    return new HomeCollection({
      id: params.id,
      number: params.number,
      ...patientOf(params.patient),
      areaId: area.id,
      address,
      landmark: text(params.landmark, 150, 'landmark'),
      collectionDate: params.collectionDate,
      windowId: params.window.id,
      windowLabel: params.window.label,
      tests: [...params.tests],
      amount,
      charge: area.charge,
      status: 'booked',
      statusReason: null,
      collectorId: null,
      assignedAt: null,
      collectedAt: null,
      collectedBy: null,
      collectionNote: null,
      billId: null,
      patientNote: text(params.patientNote, 300, 'note'),
      bookedVia: params.bookedVia,
      bookedBy: params.bookedBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: HomeCollectionProps): HomeCollection {
    return new HomeCollection({ ...props, tests: [...props.tests] });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get patientId(): string | null {
    return this.props.patientId;
  }
  get status(): HomeCollectionStatus {
    return this.props.status;
  }
  get charge(): number {
    return this.props.charge;
  }
  get collectorId(): string | null {
    return this.props.collectorId;
  }

  /** A collector sent (or another sent instead) before the samples are taken. */
  assign(collectorId: string, now: Date): void {
    if (this.props.status !== 'booked' && this.props.status !== 'assigned') {
      throw new DomainError('booking_state', `A ${this.props.status} home collection cannot be given a collector`);
    }
    this.props.status = 'assigned';
    this.props.collectorId = collectorId;
    this.props.assignedAt = now;
    this.touch(now);
  }

  /** The collector took the samples at the address. */
  collected(by: string, note: string | null, now: Date): void {
    if (this.props.status !== 'assigned') {
      throw new DomainError(
        'booking_state',
        this.props.status === 'booked'
          ? 'Give the home collection a collector first'
          : `A ${this.props.status} home collection cannot be collected`,
      );
    }
    this.props.status = 'collected';
    this.props.collectedAt = now;
    this.props.collectedBy = by;
    this.props.collectionNote = text(note, 300, 'note');
    this.touch(now);
  }

  /** Billed once, before the visit (the labels go with the collector) or after it. */
  billed(billId: string, patient: { id: string; fullName: string; mobileNo: string }, now: Date): void {
    if (this.props.status === 'cancelled') {
      throw new DomainError('booking_state', 'A cancelled home collection cannot be billed');
    }
    linkBill(this.props, billId, patient);
    this.touch(now);
  }

  /** Called off before the samples are taken and before it is billed (a billed visit is undone on its bill). */
  cancel(reason: string, now: Date): void {
    if (this.props.status !== 'booked' && this.props.status !== 'assigned') {
      throw new DomainError('booking_state', `A ${this.props.status} home collection cannot be cancelled`);
    }
    if (this.props.billId !== null) {
      throw new DomainError('booking_billed', 'The home collection is billed; cancel its tests on the bill');
    }
    this.props.status = 'cancelled';
    this.props.statusReason = reasonOf(reason);
    this.touch(now);
  }

  attach(patient: { id: string; fullName: string; mobileNo: string }, now: Date): void {
    if (this.props.status === 'cancelled' || this.props.billId !== null) {
      throw new DomainError('booking_state', 'A cancelled or billed home collection cannot be changed');
    }
    this.props.patientId = patient.id;
    this.props.patientName = patient.fullName;
    this.props.mobileNo = patient.mobileNo;
    this.touch(now);
  }

  assertVersion(version: number): void {
    assertVersionOf(this.props, version);
  }

  toSnapshot(): Readonly<HomeCollectionProps> {
    return { ...this.props, tests: [...this.props.tests] };
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}
