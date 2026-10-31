import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  DiagnosticBookings,
  type HomeCollectionRequest,
  type PatientHomeCollection,
  type PatientTestAppointment,
  type TestAppointmentRequest,
  type WindowAvailability,
} from '../../../shared/application/contracts/diagnostic-bookings.js';
import { UserDirectory } from '../../../shared/application/contracts/user-directory.js';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  chooseWindowSerial,
  HomeCollection,
  TestAppointment,
  windowOver,
  type BookedVia,
  type BookingPatient,
  type QuotedTest,
} from '../domain/diagnostic-booking.js';
import { normalMobile } from '../domain/patient.js';
import { DiagnosticBookingRepository, type BookableTest } from '../domain/repositories.js';
import {
  BookHomeCollectionCommand,
  BookTestAppointmentCommand,
  ChangeHomeCollectionCommand,
  ChangeTestAppointmentCommand,
  DiagnosticBookingReadRepository,
  GetHomeCollectionBoardQuery,
  GetHomeCollectionQuery,
  GetTestAppointmentBoardQuery,
  GetTestAppointmentQuery,
  GetWindowAvailabilityQuery,
  ListCollectorsQuery,
  MAX_BOARD_DAYS,
  type BoardCount,
  type DeskPatient,
  type HomeCollectionBoard,
  type HomeCollectionView,
  type TestAppointmentBoard,
  type TestAppointmentView,
} from './booking.messages.js';
import { DIAG_BOOK, DIAG_COLLECT, DIAG_READ } from './hospital.constants.js';
import { OpdDesk } from './opd.handlers.js';

/** Bookings a patient may hold at once from the portal, of each kind (the desk is not limited). */
export const MAX_PORTAL_BOOKINGS = 3;

interface Booker {
  readonly via: BookedVia;
  /** The desk's user; null for the patient on the portal. */
  readonly userId: string | null;
}

const paisa = (value: number) => Math.round(value * 100);
const dayCount = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

/** Counts under each heading, the busiest first. */
function countBy<T extends { status: string }>(rows: readonly T[], keys: (row: T) => readonly string[]): BoardCount[] {
  const counts = new Map<string, { live: number; cancelled: number }>();
  for (const row of rows) {
    for (const key of new Set(keys(row))) {
      const count = counts.get(key) ?? { live: 0, cancelled: 0 };
      if (row.status === 'cancelled') count.cancelled += 1;
      else count.live += 1;
      counts.set(key, count);
    }
  }
  return [...counts]
    .map(([key, count]) => ({ key, ...count }))
    .sort((a, b) => b.live - a.live || a.key.localeCompare(b.key));
}

/** What the desk and the portal share: the patient, the tests quoted, the window's places and the audit. */
@Injectable()
export class BookingDesk {
  constructor(
    readonly opd: OpdDesk,
    readonly bookings: DiagnosticBookingRepository,
    readonly read: DiagnosticBookingReadRepository,
    readonly users: UserDirectory,
  ) {}

  /** The time of day where the hospital is, as HH:MM. */
  timeNow(): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: this.opd.settings.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(this.opd.clock.now());
  }

  record(
    action: string,
    actorUserId: string | null,
    resource: string,
    id: string,
    metadata: Record<string, string | number | null>,
  ) {
    return this.opd.audit.record({
      action: `hospital.${resource}_${action}`,
      actorUserId,
      resourceType: resource,
      resourceId: id,
      metadata,
    });
  }

  async registered(patientId: string) {
    const patient = await this.opd.appointments.patientContact(patientId);
    if (!patient) throw new NotFoundError('patient');
    return patient;
  }

  async patient(input: DeskPatient): Promise<BookingPatient> {
    if (input.patientId) {
      const patient = await this.registered(input.patientId);
      return { patientId: patient.id, patientName: patient.fullName, mobileNo: patient.mobileNo };
    }
    if (!input.patientName || !input.mobileNo) {
      throw new DomainError('patient_needed', 'Give a registered patient, or the name and mobile number');
    }
    return { patientId: null, patientName: input.patientName, mobileNo: normalMobile(input.mobileNo) };
  }

  /** The tests at their rates now: active, and tests rather than services. */
  async quote(testIds: readonly string[]): Promise<{ quoted: QuotedTest[]; tests: BookableTest[] }> {
    const found = await this.bookings.tests(testIds);
    const tests = testIds.map((id) => {
      const test = found.get(id);
      if (!test) throw new NotFoundError('diagnostic_test');
      if (!test.isActive) throw new DomainError('inactive_test', `${test.name} is not done now`);
      if (test.departmentKind === 'other') {
        throw new DomainError('not_bookable_test', `${test.name} is a service, not a test to book`);
      }
      return test;
    });
    return { quoted: tests.map((test) => ({ testId: test.id, rate: test.rate })), tests };
  }

  async bookAppointment(patient: BookingPatient, request: TestAppointmentRequest, by: Booker) {
    const { opd, bookings } = this;
    return opd.tx.run(async () => {
      const window = await bookings.appointmentWindow(request.windowId);
      if (!window) throw new NotFoundError('appointment_window');
      if (!window.isActive) throw new DomainError('window_closed', `${window.label} is not offered now`);
      const { quoted, tests } = await this.quote(request.testIds);
      if (window.departmentId) {
        const other = tests.find((test) => test.departmentId !== window.departmentId);
        if (other) throw new DomainError('wrong_window', `${other.name} is not booked in ${window.label}`);
      }
      const today = opd.today();
      if (request.appointmentDate === today && windowOver(window, this.timeNow())) {
        throw new DomainError('window_over', `${window.label} is over for today`);
      }
      await opd.tx.lock(`hospital:test-window:${window.id}:${request.appointmentDate}`);
      if (
        await bookings.bookedInWindow(window.id, request.appointmentDate, {
          id: patient.patientId,
          mobileNo: patient.mobileNo,
        })
      ) {
        throw new ConflictError('already_booked', `The patient is booked in ${window.label} that day already`);
      }
      const serial = chooseWindowSerial(
        window.capacity,
        await bookings.takenSerials(window.id, request.appointmentDate),
      );
      const appointment = TestAppointment.book({
        id: randomUUID(),
        number: await opd.number('TA', today),
        patient,
        appointmentDate: request.appointmentDate,
        window,
        serial,
        tests: quoted,
        remarks: request.remarks,
        bookedVia: by.via,
        bookedBy: by.userId,
        today,
        now: opd.clock.now(),
      });
      await bookings.insertAppointment(appointment);
      await this.record('booked', by.userId, 'test_appointment', appointment.id, {
        number: appointment.number,
        date: request.appointmentDate,
        serial,
        via: by.via,
      });
      return { id: appointment.id, number: appointment.number, serial };
    });
  }

  async bookHomeCollection(patient: BookingPatient, request: HomeCollectionRequest, by: Booker) {
    const { opd, bookings } = this;
    return opd.tx.run(async () => {
      const area = await bookings.area(request.areaId);
      if (!area) throw new NotFoundError('collection_area');
      if (!area.isActive) throw new DomainError('area_closed', `${area.name} is not served now`);
      const window = await bookings.collectionWindow(request.windowId);
      if (!window) throw new NotFoundError('collection_window');
      if (!window.isActive) throw new DomainError('window_closed', `${window.label} is not offered now`);
      const { quoted, tests } = await this.quote(request.testIds);
      const away = tests.find((test) => test.departmentKind !== 'lab');
      if (away) throw new DomainError('not_home_test', `${away.name} is not collected at home`);
      await opd.tx.lock(`hospital:home-collection:${patient.patientId ?? patient.mobileNo}`);
      if (
        await bookings.collectionBooked(request.collectionDate, { id: patient.patientId, mobileNo: patient.mobileNo })
      ) {
        throw new ConflictError('already_booked', 'The patient has a home collection that day already');
      }
      const today = opd.today();
      const collection = HomeCollection.book({
        id: randomUUID(),
        number: await opd.number('HC', today),
        patient,
        area,
        address: request.address,
        landmark: request.landmark,
        collectionDate: request.collectionDate,
        window,
        tests: quoted,
        patientNote: request.note,
        bookedVia: by.via,
        bookedBy: by.userId,
        today,
        now: opd.clock.now(),
      });
      await bookings.insertHomeCollection(collection);
      await this.record('booked', by.userId, 'home_collection', collection.id, {
        number: collection.number,
        date: request.collectionDate,
        area: area.name,
        via: by.via,
      });
      return { id: collection.id, number: collection.number };
    });
  }

  async availability(date: string, departmentId: string | null): Promise<WindowAvailability[]> {
    const today = this.opd.today();
    const timeNow = this.timeNow();
    return (await this.read.windowsOn(date, departmentId)).map((window) => ({
      ...window,
      left: Math.max(0, window.capacity - window.booked),
      over: date < today || (date === today && windowOver(window, timeNow)),
    }));
  }

  /** From–to, today when left out; at most a month, never backwards. */
  period(filter: { from?: string | undefined; to?: string | undefined }): { from: string; to: string } {
    const from = filter.from ?? filter.to ?? this.opd.today();
    const to = filter.to ?? from;
    if (to < from) throw new DomainError('invalid_period', 'The period ends before it starts');
    if (dayCount(from, to) > MAX_BOARD_DAYS) {
      throw new DomainError('period_too_long', `A board covers at most ${MAX_BOARD_DAYS} days`);
    }
    return { from, to };
  }

  /** The portal's limit on bookings held at once. */
  async assertPortalRoom(patientId: string, kind: 'appointments' | 'homeCollections'): Promise<void> {
    const live = await this.bookings.liveBookings(patientId, this.opd.today());
    if (live[kind] >= MAX_PORTAL_BOOKINGS) {
      throw new ConflictError(
        'booking_limit',
        `You have ${live[kind]} bookings waiting; call the hospital to book more, or cancel one`,
      );
    }
  }
}

/** Old: bookings came only from the mobile app. The desk books for a call or a walk-in, for a registered patient or not. */
@CommandHandler(BookTestAppointmentCommand)
export class BookTestAppointmentHandler implements ICommandHandler<BookTestAppointmentCommand> {
  constructor(private readonly desk: BookingDesk) {}

  async execute({ actor, patient, request }: BookTestAppointmentCommand) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [DIAG_BOOK] });
    return this.desk.bookAppointment(await this.desk.patient(patient), request, { via: 'desk', userId: actor.userId });
  }
}

@CommandHandler(ChangeTestAppointmentCommand)
export class ChangeTestAppointmentHandler implements ICommandHandler<ChangeTestAppointmentCommand> {
  constructor(private readonly desk: BookingDesk) {}

  async execute({ actor, id, version, change }: ChangeTestAppointmentCommand): Promise<void> {
    const { desk } = this;
    const { opd } = desk;
    await opd.access.authorize(actor.userId, { permissions: [DIAG_BOOK] });
    await opd.tx.run(async () => {
      const appointment = await desk.bookings.appointmentForUpdate(id);
      if (!appointment) throw new NotFoundError('test_appointment');
      appointment.assertVersion(version);
      const now = opd.clock.now();
      if (change.kind === 'no_show') appointment.noShow(opd.today(), now);
      else if (change.kind === 'cancel') appointment.cancel(change.reason, now);
      else appointment.attach(await desk.registered(change.patientId), now);
      await desk.bookings.updateAppointment(appointment);
      await desk.record(
        { no_show: 'no_show', cancel: 'cancelled', attach: 'attached' }[change.kind],
        actor.userId,
        'test_appointment',
        id,
        {
          number: appointment.number,
          reason: change.kind === 'cancel' ? change.reason : null,
        },
      );
    });
  }
}

@CommandHandler(BookHomeCollectionCommand)
export class BookHomeCollectionHandler implements ICommandHandler<BookHomeCollectionCommand> {
  constructor(private readonly desk: BookingDesk) {}

  async execute({ actor, patient, request }: BookHomeCollectionCommand) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [DIAG_BOOK] });
    return this.desk.bookHomeCollection(await this.desk.patient(patient), request, {
      via: 'desk',
      userId: actor.userId,
    });
  }
}

/**
 * The desk gives a home collection its collector (a user who takes samples at homes, diag:collect), cancels it or
 * attaches the registered patient; the collector records the samples as taken (or the desk does it for them).
 */
@CommandHandler(ChangeHomeCollectionCommand)
export class ChangeHomeCollectionHandler implements ICommandHandler<ChangeHomeCollectionCommand> {
  constructor(private readonly desk: BookingDesk) {}

  async execute({ actor, id, version, change }: ChangeHomeCollectionCommand): Promise<void> {
    const { desk } = this;
    const { opd } = desk;
    const isDesk = await opd.access.isAllowed(actor.userId, { permissions: [DIAG_BOOK] });
    if (change.kind !== 'collected' || !isDesk) {
      await opd.access.authorize(actor.userId, {
        permissions: [change.kind === 'collected' ? DIAG_COLLECT : DIAG_BOOK],
      });
    }
    await opd.tx.run(async () => {
      const collection = await desk.bookings.homeCollectionForUpdate(id);
      if (!collection) throw new NotFoundError('home_collection');
      collection.assertVersion(version);
      const now = opd.clock.now();
      switch (change.kind) {
        case 'assign': {
          const [collector] = await desk.users.findSummaries([change.collectorId]);
          if (!collector) throw new NotFoundError('user');
          if (!collector.isActive) throw new DomainError('inactive_user', `${collector.displayName} is not active`);
          if (!(await opd.access.isAllowed(collector.id, { permissions: [DIAG_COLLECT] }))) {
            throw new DomainError('not_a_collector', `${collector.displayName} does not take samples at homes`);
          }
          collection.assign(collector.id, now);
          break;
        }
        case 'collected':
          if (!isDesk && collection.collectorId !== actor.userId) {
            throw new ForbiddenError('not_your_collection', 'The home collection is given to another collector');
          }
          collection.collected(actor.userId, change.note, now);
          break;
        case 'cancel':
          collection.cancel(change.reason, now);
          break;
        case 'attach':
          collection.attach(await desk.registered(change.patientId), now);
          break;
      }
      await desk.bookings.updateHomeCollection(collection);
      await desk.record(
        { assign: 'assigned', collected: 'collected', cancel: 'cancelled', attach: 'attached' }[change.kind],
        actor.userId,
        'home_collection',
        id,
        {
          number: collection.number,
          collectorId: change.kind === 'assign' ? change.collectorId : null,
          reason: change.kind === 'cancel' ? change.reason : null,
        },
      );
    });
  }
}

/** Old app's window list (hidden once full or past): every window of the day with its places. */
@QueryHandler(GetWindowAvailabilityQuery)
export class GetWindowAvailabilityHandler implements IQueryHandler<GetWindowAvailabilityQuery> {
  constructor(private readonly desk: BookingDesk) {}

  async execute({ actor, date, departmentId }: GetWindowAvailabilityQuery) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [DIAG_READ] });
    return this.desk.availability(date, departmentId);
  }
}

/** Old test appointment dashboard: the bookings of the days, with counts by department, test and window. */
@QueryHandler(GetTestAppointmentBoardQuery)
export class GetTestAppointmentBoardHandler implements IQueryHandler<GetTestAppointmentBoardQuery> {
  constructor(private readonly desk: BookingDesk) {}

  async execute({ actor, filter }: GetTestAppointmentBoardQuery): Promise<TestAppointmentBoard> {
    const { desk } = this;
    await desk.opd.access.authorize(actor.userId, { permissions: [DIAG_READ] });
    const items = await desk.read.appointments({ ...filter, ...desk.period(filter) });
    const live = items.filter((item) => item.status !== 'cancelled');
    const status = (value: TestAppointmentView['status']) => items.filter((item) => item.status === value).length;
    return {
      items,
      summary: {
        total: items.length,
        booked: status('booked'),
        billed: status('billed'),
        noShow: status('no_show'),
        cancelled: status('cancelled'),
        amount: live.reduce((total, item) => total + paisa(item.amount), 0) / 100,
        // A booking with tests of two departments counts under each: both desks want to know it is coming.
        byDepartment: countBy(items, (item) => item.tests.map((test) => test.departmentName)),
        byTest: countBy(items, (item) => item.tests.map((test) => test.testName)),
        byWindow: countBy(items, (item) => [`${item.appointmentDate} ${item.windowLabel}`]),
      },
    };
  }
}

@QueryHandler(GetTestAppointmentQuery)
export class GetTestAppointmentHandler implements IQueryHandler<GetTestAppointmentQuery> {
  constructor(private readonly desk: BookingDesk) {}

  async execute({ actor, id }: GetTestAppointmentQuery) {
    await this.desk.opd.access.authorize(actor.userId, { permissions: [DIAG_READ] });
    const appointment = await this.desk.read.appointment(id);
    if (!appointment) throw new NotFoundError('test_appointment');
    return appointment;
  }
}

/** The home collections of the days; a collector without diag:read sees only their own. */
@QueryHandler(GetHomeCollectionBoardQuery)
export class GetHomeCollectionBoardHandler implements IQueryHandler<GetHomeCollectionBoardQuery> {
  constructor(private readonly desk: BookingDesk) {}

  async execute({ actor, filter }: GetHomeCollectionBoardQuery): Promise<HomeCollectionBoard> {
    const { desk } = this;
    const { access } = desk.opd;
    await access.authorize(actor.userId, { permissions: [DIAG_READ, DIAG_COLLECT], mode: 'any' });
    const reader = await access.isAllowed(actor.userId, { permissions: [DIAG_READ] });
    const collectorId = !reader || filter.collectorId === 'me' ? actor.userId : filter.collectorId;
    const items = await desk.read.homeCollections({ ...filter, collectorId, ...desk.period(filter) });
    const live = items.filter((item) => item.status !== 'cancelled');
    const status = (value: HomeCollectionView['status']) => items.filter((item) => item.status === value).length;
    return {
      items,
      summary: {
        total: items.length,
        booked: status('booked'),
        assigned: status('assigned'),
        collected: status('collected'),
        cancelled: status('cancelled'),
        unbilled: live.filter((item) => item.billId === null).length,
        amount: live.reduce((total, item) => total + paisa(item.total), 0) / 100,
        byArea: countBy(items, (item) => [item.areaName]),
        byCollector: countBy(items, (item) => [item.collectorName ?? 'Not given']),
        byWindow: countBy(items, (item) => [`${item.collectionDate} ${item.windowLabel}`]),
      },
    };
  }
}

@QueryHandler(GetHomeCollectionQuery)
export class GetHomeCollectionHandler implements IQueryHandler<GetHomeCollectionQuery> {
  constructor(private readonly desk: BookingDesk) {}

  async execute({ actor, id }: GetHomeCollectionQuery) {
    const { access } = this.desk.opd;
    await access.authorize(actor.userId, { permissions: [DIAG_READ, DIAG_COLLECT], mode: 'any' });
    const collection = await this.desk.read.homeCollection(id);
    const mine = collection?.collectorId === actor.userId;
    if (!collection || (!mine && !(await access.isAllowed(actor.userId, { permissions: [DIAG_READ] })))) {
      throw new NotFoundError('home_collection');
    }
    return collection;
  }
}

@QueryHandler(ListCollectorsQuery)
export class ListCollectorsHandler implements IQueryHandler<ListCollectorsQuery> {
  constructor(private readonly desk: BookingDesk) {}

  async execute({ actor }: ListCollectorsQuery) {
    const { access } = this.desk.opd;
    await access.authorize(actor.userId, { permissions: [DIAG_BOOK] });
    const ids = await access.usersWithPermission(DIAG_COLLECT);
    const users = ids.length ? await this.desk.users.findSummaries(ids) : [];
    return users
      .filter((user) => user.isActive)
      .map((user) => ({ id: user.id, displayName: user.displayName }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
}

/** The bookings as the portal offers them: the patient books, sees and cancels their own. */
@Injectable()
export class HospitalDiagnosticBookings extends DiagnosticBookings {
  constructor(private readonly desk: BookingDesk) {
    super();
  }

  async catalogue(text: string | null) {
    return this.desk.read.catalogue(text, 50);
  }

  appointmentDay(date: string, departmentId: string | null) {
    return this.desk.availability(date, departmentId);
  }

  homeCollectionOffer() {
    return this.desk.read.homeCollectionOffer();
  }

  preparations() {
    return this.desk.read.preparations();
  }

  async bookAppointment(patientId: string, request: TestAppointmentRequest) {
    const { desk } = this;
    await desk.assertPortalRoom(patientId, 'appointments');
    return desk.bookAppointment(await desk.patient({ patientId, patientName: null, mobileNo: null }), request, {
      via: 'portal',
      userId: null,
    });
  }

  async bookHomeCollection(patientId: string, request: HomeCollectionRequest) {
    const { desk } = this;
    await desk.assertPortalRoom(patientId, 'homeCollections');
    return desk.bookHomeCollection(await desk.patient({ patientId, patientName: null, mobileNo: null }), request, {
      via: 'portal',
      userId: null,
    });
  }

  async appointments(patientId: string): Promise<PatientTestAppointment[]> {
    const rows = await this.desk.read.appointments({ from: '0001-01-01', to: '9999-12-31', patientId });
    return rows
      .sort((a, b) => b.appointmentDate.localeCompare(a.appointmentDate) || a.startTime.localeCompare(b.startTime))
      .map((row) => ({
        id: row.id,
        number: row.number,
        appointmentDate: row.appointmentDate,
        windowLabel: row.windowLabel,
        startTime: row.startTime,
        endTime: row.endTime,
        serial: row.serial,
        tests: row.tests,
        amount: row.amount,
        status: row.status,
        statusReason: row.statusReason,
      }));
  }

  async homeCollections(patientId: string): Promise<PatientHomeCollection[]> {
    const rows = await this.desk.read.homeCollections({ from: '0001-01-01', to: '9999-12-31', patientId });
    return rows
      .sort((a, b) => b.collectionDate.localeCompare(a.collectionDate))
      .map((row) => ({
        id: row.id,
        number: row.number,
        collectionDate: row.collectionDate,
        windowLabel: row.windowLabel,
        areaName: row.areaName,
        address: row.address,
        landmark: row.landmark,
        tests: row.tests,
        amount: row.amount,
        charge: row.charge,
        status: row.status,
        statusReason: row.statusReason,
      }));
  }

  async cancelAppointment(patientId: string, id: string): Promise<void> {
    const { desk } = this;
    await desk.opd.tx.run(async () => {
      const appointment = await desk.bookings.appointmentForUpdate(id);
      if (!appointment || appointment.patientId !== patientId) throw new NotFoundError('test_appointment');
      appointment.cancel('Cancelled by the patient', desk.opd.clock.now());
      await desk.bookings.updateAppointment(appointment);
      await desk.record('cancelled', null, 'test_appointment', id, { number: appointment.number, via: 'portal' });
    });
  }

  async cancelHomeCollection(patientId: string, id: string): Promise<void> {
    const { desk } = this;
    await desk.opd.tx.run(async () => {
      const collection = await desk.bookings.homeCollectionForUpdate(id);
      if (!collection || collection.patientId !== patientId) throw new NotFoundError('home_collection');
      collection.cancel('Cancelled by the patient', desk.opd.clock.now());
      await desk.bookings.updateHomeCollection(collection);
      await desk.record('cancelled', null, 'home_collection', id, { number: collection.number, via: 'portal' });
    });
  }
}

export const BOOKING_HANDLERS = [
  BookingDesk,
  BookTestAppointmentHandler,
  ChangeTestAppointmentHandler,
  BookHomeCollectionHandler,
  ChangeHomeCollectionHandler,
  GetWindowAvailabilityHandler,
  GetTestAppointmentBoardHandler,
  GetTestAppointmentHandler,
  GetHomeCollectionBoardHandler,
  GetHomeCollectionHandler,
  ListCollectorsHandler,
];
