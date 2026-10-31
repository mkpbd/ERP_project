import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, exists, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type {
  BookableTestOffer,
  BookedTest,
  HomeCollectionOffer,
} from '../../../../shared/application/contracts/diagnostic-bookings.js';
import { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import {
  DiagnosticBookingReadRepository,
  type HomeCollectionFilter,
  type HomeCollectionView,
  type TestAppointmentFilter,
  type TestAppointmentView,
} from '../../application/booking.messages.js';
import { HomeCollection, TestAppointment } from '../../domain/diagnostic-booking.js';
import {
  DiagnosticBookingRepository,
  type AppointmentWindow,
  type BookableTest,
  type CollectionArea,
} from '../../domain/repositories.js';
import {
  diagnosticBills,
  diagnosticDepartments,
  diagnosticTests,
  homeCollectionAreas,
  homeCollections,
  homeCollectionTests,
  homeCollectionWindows,
  patients,
  testAppointments,
  testAppointmentTests,
  testAppointmentWindows,
  testPreparations,
} from './hospital.schema.js';

const LIVE_APPOINTMENT = ['booked', 'billed'] as const;
const LIVE_COLLECTION = ['booked', 'assigned', 'collected'] as const;

/** The patient by id when registered, else by the mobile number given. */
const samePatient = (
  table: typeof testAppointments | typeof homeCollections,
  patient: { id: string | null; mobileNo: string },
) =>
  patient.id ? eq(table.patientId, patient.id) : and(isNull(table.patientId), eq(table.mobileNo, patient.mobileNo));

@Injectable()
export class DrizzleDiagnosticBookingRepository extends DiagnosticBookingRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async tests(ids: readonly string[]): Promise<Map<string, BookableTest>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        id: diagnosticTests.id,
        name: diagnosticTests.name,
        rate: diagnosticTests.rate,
        isActive: diagnosticTests.isActive,
        departmentId: diagnosticTests.departmentId,
        departmentName: diagnosticDepartments.name,
        departmentKind: diagnosticDepartments.kind,
      })
      .from(diagnosticTests)
      .innerJoin(diagnosticDepartments, eq(diagnosticDepartments.id, diagnosticTests.departmentId))
      .where(inArray(diagnosticTests.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async appointmentWindow(id: string): Promise<AppointmentWindow | null> {
    const [row] = await this.context.db
      .select({
        id: testAppointmentWindows.id,
        label: testAppointmentWindows.label,
        startTime: testAppointmentWindows.startTime,
        endTime: testAppointmentWindows.endTime,
        capacity: testAppointmentWindows.capacity,
        departmentId: testAppointmentWindows.departmentId,
        isActive: testAppointmentWindows.isActive,
      })
      .from(testAppointmentWindows)
      .where(eq(testAppointmentWindows.id, id));
    return row ?? null;
  }

  async takenSerials(windowId: string, date: string): Promise<Set<number>> {
    const rows = await this.context.db
      .select({ serial: testAppointments.serial })
      .from(testAppointments)
      .where(
        and(
          eq(testAppointments.windowId, windowId),
          eq(testAppointments.appointmentDate, date),
          ne(testAppointments.status, 'cancelled'),
        ),
      );
    return new Set(rows.map((row) => row.serial));
  }

  async bookedInWindow(windowId: string, date: string, patient: { id: string | null; mobileNo: string }) {
    const [row] = await this.context.db
      .select({ id: testAppointments.id })
      .from(testAppointments)
      .where(
        and(
          eq(testAppointments.windowId, windowId),
          eq(testAppointments.appointmentDate, date),
          inArray(testAppointments.status, LIVE_APPOINTMENT),
          samePatient(testAppointments, patient),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async liveBookings(patientId: string, from: string) {
    const [[appointments], [collections]] = await Promise.all([
      this.context.db
        .select({ n: count() })
        .from(testAppointments)
        .where(
          and(
            eq(testAppointments.patientId, patientId),
            eq(testAppointments.status, 'booked'),
            gte(testAppointments.appointmentDate, from),
          ),
        ),
      this.context.db
        .select({ n: count() })
        .from(homeCollections)
        .where(
          and(
            eq(homeCollections.patientId, patientId),
            inArray(homeCollections.status, ['booked', 'assigned']),
            gte(homeCollections.collectionDate, from),
          ),
        ),
    ]);
    return { appointments: appointments?.n ?? 0, homeCollections: collections?.n ?? 0 };
  }

  async insertAppointment(appointment: TestAppointment): Promise<void> {
    const { tests, ...row } = appointment.toSnapshot();
    await this.context.db.insert(testAppointments).values(row);
    await this.context.db
      .insert(testAppointmentTests)
      .values(tests.map((test, index) => ({ appointmentId: row.id, position: index + 1, ...test })));
  }

  async appointmentForUpdate(id: string): Promise<TestAppointment | null> {
    const [row] = await this.context.db
      .select()
      .from(testAppointments)
      .where(eq(testAppointments.id, id))
      .for('update');
    if (!row) return null;
    const tests = await this.context.db
      .select({ testId: testAppointmentTests.testId, rate: testAppointmentTests.rate })
      .from(testAppointmentTests)
      .where(eq(testAppointmentTests.appointmentId, id))
      .orderBy(asc(testAppointmentTests.position));
    return TestAppointment.restore({ ...row, tests });
  }

  async updateAppointment(appointment: TestAppointment): Promise<void> {
    const { id, tests: _tests, ...row } = appointment.toSnapshot();
    await this.context.db.update(testAppointments).set(row).where(eq(testAppointments.id, id));
  }

  async area(id: string): Promise<CollectionArea | null> {
    const [row] = await this.context.db
      .select({
        id: homeCollectionAreas.id,
        name: homeCollectionAreas.name,
        charge: homeCollectionAreas.charge,
        minimumOrder: homeCollectionAreas.minimumOrder,
        days: homeCollectionAreas.days,
        isActive: homeCollectionAreas.isActive,
      })
      .from(homeCollectionAreas)
      .where(eq(homeCollectionAreas.id, id));
    return row ?? null;
  }

  async collectionWindow(id: string) {
    const [row] = await this.context.db
      .select({
        id: homeCollectionWindows.id,
        label: homeCollectionWindows.label,
        isActive: homeCollectionWindows.isActive,
      })
      .from(homeCollectionWindows)
      .where(eq(homeCollectionWindows.id, id));
    return row ?? null;
  }

  async collectionBooked(date: string, patient: { id: string | null; mobileNo: string }) {
    const [row] = await this.context.db
      .select({ id: homeCollections.id })
      .from(homeCollections)
      .where(
        and(
          eq(homeCollections.collectionDate, date),
          inArray(homeCollections.status, LIVE_COLLECTION),
          samePatient(homeCollections, patient),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async insertHomeCollection(collection: HomeCollection): Promise<void> {
    const { tests, ...row } = collection.toSnapshot();
    await this.context.db.insert(homeCollections).values(row);
    await this.context.db
      .insert(homeCollectionTests)
      .values(tests.map((test, index) => ({ homeCollectionId: row.id, position: index + 1, ...test })));
  }

  async homeCollectionForUpdate(id: string): Promise<HomeCollection | null> {
    const [row] = await this.context.db.select().from(homeCollections).where(eq(homeCollections.id, id)).for('update');
    if (!row) return null;
    const tests = await this.context.db
      .select({ testId: homeCollectionTests.testId, rate: homeCollectionTests.rate })
      .from(homeCollectionTests)
      .where(eq(homeCollectionTests.homeCollectionId, id))
      .orderBy(asc(homeCollectionTests.position));
    return HomeCollection.restore({ ...row, tests });
  }

  async updateHomeCollection(collection: HomeCollection): Promise<void> {
    const { id, tests: _tests, ...row } = collection.toSnapshot();
    await this.context.db.update(homeCollections).set(row).where(eq(homeCollections.id, id));
  }
}

@Injectable()
export class DrizzleDiagnosticBookingReadRepository extends DiagnosticBookingReadRepository {
  constructor(
    private readonly context: DbContext,
    private readonly users: UserDirectory,
  ) {
    super();
  }

  async catalogue(text: string | null, limit: number): Promise<BookableTestOffer[]> {
    const pattern = text ? `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.context.db
      .select({
        id: diagnosticTests.id,
        name: diagnosticTests.name,
        rate: diagnosticTests.rate,
        departmentId: diagnosticTests.departmentId,
        departmentName: diagnosticDepartments.name,
        departmentKind: diagnosticDepartments.kind,
      })
      .from(diagnosticTests)
      .innerJoin(diagnosticDepartments, eq(diagnosticDepartments.id, diagnosticTests.departmentId))
      .where(
        and(
          eq(diagnosticTests.isActive, true),
          ne(diagnosticDepartments.kind, 'other'),
          pattern
            ? or(
                ilike(diagnosticTests.name, pattern),
                ilike(diagnosticTests.shortName, pattern),
                ilike(diagnosticTests.code, pattern),
              )
            : undefined,
        ),
      )
      .orderBy(asc(diagnosticTests.name))
      .limit(limit);
    return rows.map((row) => ({ ...row, departmentKind: row.departmentKind === 'imaging' ? 'imaging' : 'lab' }));
  }

  async windowsOn(date: string, departmentId: string | null) {
    const booked = this.context.db
      .select({ windowId: testAppointments.windowId, n: count().as('n') })
      .from(testAppointments)
      .where(and(eq(testAppointments.appointmentDate, date), ne(testAppointments.status, 'cancelled')))
      .groupBy(testAppointments.windowId)
      .as('booked');
    const rows = await this.context.db
      .select({
        id: testAppointmentWindows.id,
        label: testAppointmentWindows.label,
        startTime: testAppointmentWindows.startTime,
        endTime: testAppointmentWindows.endTime,
        departmentId: testAppointmentWindows.departmentId,
        departmentName: diagnosticDepartments.name,
        capacity: testAppointmentWindows.capacity,
        booked: sql<number>`coalesce(${booked.n}, 0)`.mapWith(Number),
      })
      .from(testAppointmentWindows)
      .leftJoin(diagnosticDepartments, eq(diagnosticDepartments.id, testAppointmentWindows.departmentId))
      .leftJoin(booked, eq(booked.windowId, testAppointmentWindows.id))
      .where(
        and(
          eq(testAppointmentWindows.isActive, true),
          departmentId
            ? or(eq(testAppointmentWindows.departmentId, departmentId), isNull(testAppointmentWindows.departmentId))
            : undefined,
        ),
      )
      .orderBy(asc(testAppointmentWindows.displayOrder), asc(testAppointmentWindows.startTime));
    return rows;
  }

  async homeCollectionOffer(): Promise<HomeCollectionOffer> {
    const [areas, windows] = await Promise.all([
      this.context.db
        .select({
          id: homeCollectionAreas.id,
          name: homeCollectionAreas.name,
          charge: homeCollectionAreas.charge,
          minimumOrder: homeCollectionAreas.minimumOrder,
          days: homeCollectionAreas.days,
        })
        .from(homeCollectionAreas)
        .where(eq(homeCollectionAreas.isActive, true))
        .orderBy(asc(homeCollectionAreas.name)),
      this.context.db
        .select({ id: homeCollectionWindows.id, label: homeCollectionWindows.label })
        .from(homeCollectionWindows)
        .where(eq(homeCollectionWindows.isActive, true))
        .orderBy(asc(homeCollectionWindows.displayOrder), asc(homeCollectionWindows.label)),
    ]);
    return { areas, windows };
  }

  async preparations() {
    return this.context.db
      .select({
        id: testPreparations.id,
        departmentId: testPreparations.departmentId,
        departmentName: diagnosticDepartments.name,
        testId: testPreparations.testId,
        testName: diagnosticTests.name,
        title: testPreparations.title,
        titleBn: testPreparations.titleBn,
        instructions: testPreparations.instructions,
        instructionsBn: testPreparations.instructionsBn,
        videoUrl: testPreparations.videoUrl,
      })
      .from(testPreparations)
      .leftJoin(diagnosticDepartments, eq(diagnosticDepartments.id, testPreparations.departmentId))
      .leftJoin(diagnosticTests, eq(diagnosticTests.id, testPreparations.testId))
      .where(eq(testPreparations.isActive, true))
      .orderBy(asc(testPreparations.displayOrder), asc(testPreparations.title));
  }

  /** The tests of each booking, in their order. */
  private async booked(
    table: typeof testAppointmentTests | typeof homeCollectionTests,
    owner: typeof testAppointmentTests.appointmentId | typeof homeCollectionTests.homeCollectionId,
    ids: readonly string[],
  ): Promise<Map<string, BookedTest[]>> {
    const byOwner = new Map<string, BookedTest[]>();
    if (ids.length === 0) return byOwner;
    const rows = await this.context.db
      .select({
        owner,
        testId: table.testId,
        testName: diagnosticTests.name,
        departmentName: diagnosticDepartments.name,
        rate: table.rate,
      })
      .from(table)
      .innerJoin(diagnosticTests, eq(diagnosticTests.id, table.testId))
      .innerJoin(diagnosticDepartments, eq(diagnosticDepartments.id, diagnosticTests.departmentId))
      .where(inArray(owner, [...ids]))
      .orderBy(asc(owner), asc(table.position));
    for (const { owner: id, ...test } of rows) byOwner.set(id, [...(byOwner.get(id) ?? []), test]);
    return byOwner;
  }

  private async names(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    return new Map((wanted.length ? await this.users.findSummaries(wanted) : []).map((u) => [u.id, u.displayName]));
  }

  private appointmentRows(where: SQL | undefined) {
    return this.context.db
      .select({ appointment: testAppointments, uhid: patients.uhid, billNumber: diagnosticBills.number })
      .from(testAppointments)
      .leftJoin(patients, eq(patients.id, testAppointments.patientId))
      .leftJoin(diagnosticBills, eq(diagnosticBills.id, testAppointments.billId))
      .where(where)
      .orderBy(
        asc(testAppointments.appointmentDate),
        asc(testAppointments.startTime),
        asc(testAppointments.windowLabel),
        asc(testAppointments.serial),
      );
  }

  private async appointmentViews(rows: Awaited<ReturnType<DrizzleDiagnosticBookingReadRepository['appointmentRows']>>) {
    const ids = rows.map(({ appointment }) => appointment.id);
    const [tests, names] = await Promise.all([
      this.booked(testAppointmentTests, testAppointmentTests.appointmentId, ids),
      this.names(rows.map(({ appointment }) => appointment.bookedBy)),
    ]);
    return rows.map(({ appointment, uhid, billNumber }): TestAppointmentView => {
      const { bookedBy, updatedAt: _updated, ...fields } = appointment;
      return {
        ...fields,
        uhid,
        billNumber,
        tests: tests.get(appointment.id) ?? [],
        bookedByName: bookedBy ? (names.get(bookedBy) ?? null) : null,
      };
    });
  }

  async appointments(filter: TestAppointmentFilter): Promise<TestAppointmentView[]> {
    const rows = await this.appointmentRows(
      and(
        gte(testAppointments.appointmentDate, filter.from),
        lte(testAppointments.appointmentDate, filter.to),
        filter.status ? eq(testAppointments.status, filter.status as TestAppointmentView['status']) : undefined,
        filter.patientId ? eq(testAppointments.patientId, filter.patientId) : undefined,
        filter.windowId ? eq(testAppointments.windowId, filter.windowId) : undefined,
        filter.departmentId
          ? exists(
              this.context.db
                .select({ one: sql`1` })
                .from(testAppointmentTests)
                .innerJoin(diagnosticTests, eq(diagnosticTests.id, testAppointmentTests.testId))
                .where(
                  and(
                    eq(testAppointmentTests.appointmentId, testAppointments.id),
                    eq(diagnosticTests.departmentId, filter.departmentId),
                  ),
                ),
            )
          : undefined,
      ),
    );
    return this.appointmentViews(rows);
  }

  async appointment(id: string): Promise<TestAppointmentView | null> {
    const [view] = await this.appointmentViews(await this.appointmentRows(eq(testAppointments.id, id)));
    return view ?? null;
  }

  private collectionRows(where: SQL | undefined) {
    return this.context.db
      .select({
        collection: homeCollections,
        areaName: homeCollectionAreas.name,
        uhid: patients.uhid,
        billNumber: diagnosticBills.number,
        billDue: sql<number | null>`${diagnosticBills.net} - ${diagnosticBills.cancelled} - ${diagnosticBills.paid}
          - ${diagnosticBills.collected} + ${diagnosticBills.refunded}`.mapWith((value: string | null) =>
          value === null ? null : Number(value),
        ),
      })
      .from(homeCollections)
      .innerJoin(homeCollectionAreas, eq(homeCollectionAreas.id, homeCollections.areaId))
      .leftJoin(homeCollectionWindows, eq(homeCollectionWindows.id, homeCollections.windowId))
      .leftJoin(patients, eq(patients.id, homeCollections.patientId))
      .leftJoin(diagnosticBills, eq(diagnosticBills.id, homeCollections.billId))
      .where(where)
      .orderBy(
        asc(homeCollections.collectionDate),
        asc(homeCollectionWindows.displayOrder),
        asc(homeCollections.windowLabel),
        asc(homeCollections.number),
      );
  }

  private async collectionViews(rows: Awaited<ReturnType<DrizzleDiagnosticBookingReadRepository['collectionRows']>>) {
    const ids = rows.map(({ collection }) => collection.id);
    const [tests, names] = await Promise.all([
      this.booked(homeCollectionTests, homeCollectionTests.homeCollectionId, ids),
      this.names(
        rows.flatMap(({ collection }) => [collection.bookedBy, collection.collectorId, collection.collectedBy]),
      ),
    ]);
    const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
    return rows.map(({ collection, areaName, uhid, billNumber, billDue }): HomeCollectionView => {
      const { bookedBy, collectedBy, updatedAt: _updated, ...fields } = collection;
      return {
        ...fields,
        areaName,
        uhid,
        billNumber,
        billDue,
        tests: tests.get(collection.id) ?? [],
        total: (Math.round(collection.amount * 100) + Math.round(collection.charge * 100)) / 100,
        collectorName: name(collection.collectorId),
        collectedByName: name(collectedBy),
        bookedByName: name(bookedBy),
      };
    });
  }

  async homeCollections(filter: HomeCollectionFilter): Promise<HomeCollectionView[]> {
    const rows = await this.collectionRows(
      and(
        gte(homeCollections.collectionDate, filter.from),
        lte(homeCollections.collectionDate, filter.to),
        filter.status ? eq(homeCollections.status, filter.status as HomeCollectionView['status']) : undefined,
        filter.patientId ? eq(homeCollections.patientId, filter.patientId) : undefined,
        filter.areaId ? eq(homeCollections.areaId, filter.areaId) : undefined,
        filter.collectorId ? eq(homeCollections.collectorId, filter.collectorId) : undefined,
      ),
    );
    return this.collectionViews(rows);
  }

  async homeCollection(id: string): Promise<HomeCollectionView | null> {
    const [view] = await this.collectionViews(await this.collectionRows(eq(homeCollections.id, id)));
    return view ?? null;
  }
}
