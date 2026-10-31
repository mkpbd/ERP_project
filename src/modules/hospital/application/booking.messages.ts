import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type {
  BookableTestOffer,
  BookedTest,
  HomeCollectionOffer,
  HomeCollectionRequest,
  TestAppointmentRequest,
  WindowAvailability,
} from '../../../shared/application/contracts/diagnostic-bookings.js';
import type { BookedVia, HomeCollectionStatus, TestAppointmentStatus } from '../domain/diagnostic-booking.js';

/** A board covers at most a month. */
export const MAX_BOARD_DAYS = 31;

export interface TestAppointmentView {
  readonly id: string;
  readonly number: string;
  readonly appointmentDate: string;
  readonly windowId: string;
  readonly windowLabel: string;
  readonly startTime: string;
  readonly endTime: string | null;
  readonly serial: number;
  readonly patientId: string | null;
  readonly uhid: number | null;
  readonly patientName: string;
  readonly mobileNo: string;
  readonly tests: readonly BookedTest[];
  readonly amount: number;
  readonly status: TestAppointmentStatus;
  readonly statusReason: string | null;
  readonly billId: string | null;
  readonly billNumber: string | null;
  readonly remarks: string | null;
  readonly bookedVia: BookedVia;
  readonly bookedByName: string | null;
  readonly createdAt: Date;
  readonly version: number;
}

export interface HomeCollectionView {
  readonly id: string;
  readonly number: string;
  readonly collectionDate: string;
  readonly windowId: string;
  readonly windowLabel: string;
  readonly areaId: string;
  readonly areaName: string;
  readonly address: string;
  readonly landmark: string | null;
  readonly patientId: string | null;
  readonly uhid: number | null;
  readonly patientName: string;
  readonly mobileNo: string;
  readonly tests: readonly BookedTest[];
  readonly amount: number;
  readonly charge: number;
  /** The tests and the visit, as quoted. */
  readonly total: number;
  readonly status: HomeCollectionStatus;
  readonly statusReason: string | null;
  readonly collectorId: string | null;
  readonly collectorName: string | null;
  readonly assignedAt: Date | null;
  readonly collectedAt: Date | null;
  readonly collectedByName: string | null;
  readonly collectionNote: string | null;
  readonly billId: string | null;
  readonly billNumber: string | null;
  /** What is still owed on the bill, once billed. */
  readonly billDue: number | null;
  readonly patientNote: string | null;
  readonly bookedVia: BookedVia;
  readonly bookedByName: string | null;
  readonly createdAt: Date;
  readonly version: number;
}

export interface BookingFilter {
  readonly from: string;
  readonly to: string;
  readonly status?: string | undefined;
  readonly patientId?: string | undefined;
}

export interface TestAppointmentFilter extends BookingFilter {
  /** Bookings with a test of the department. */
  readonly departmentId?: string | undefined;
  readonly windowId?: string | undefined;
}

export interface HomeCollectionFilter extends BookingFilter {
  readonly areaId?: string | undefined;
  readonly collectorId?: string | undefined;
}

/** Counts of a board's bookings under one heading (a department, a test, a window …). */
export interface BoardCount {
  readonly key: string;
  readonly live: number;
  readonly cancelled: number;
}

export interface TestAppointmentBoard {
  readonly items: readonly TestAppointmentView[];
  readonly summary: {
    readonly total: number;
    readonly booked: number;
    readonly billed: number;
    readonly noShow: number;
    readonly cancelled: number;
    /** What the bookings not cancelled were quoted. */
    readonly amount: number;
    readonly byDepartment: readonly BoardCount[];
    readonly byTest: readonly BoardCount[];
    readonly byWindow: readonly BoardCount[];
  };
}

export interface HomeCollectionBoard {
  readonly items: readonly HomeCollectionView[];
  readonly summary: {
    readonly total: number;
    readonly booked: number;
    readonly assigned: number;
    readonly collected: number;
    readonly cancelled: number;
    /** Not cancelled and not billed yet. */
    readonly unbilled: number;
    /** What the bookings not cancelled were quoted, the visits included. */
    readonly amount: number;
    readonly byArea: readonly BoardCount[];
    readonly byCollector: readonly BoardCount[];
    readonly byWindow: readonly BoardCount[];
  };
}

export abstract class DiagnosticBookingReadRepository {
  abstract catalogue(text: string | null, limit: number): Promise<BookableTestOffer[]>;
  /** The active windows (for a department: its own and those of any department) with their places taken that day. */
  abstract windowsOn(date: string, departmentId: string | null): Promise<Omit<WindowAvailability, 'left' | 'over'>[]>;
  abstract homeCollectionOffer(): Promise<HomeCollectionOffer>;
  abstract appointments(filter: TestAppointmentFilter): Promise<TestAppointmentView[]>;
  abstract appointment(id: string): Promise<TestAppointmentView | null>;
  abstract homeCollections(filter: HomeCollectionFilter): Promise<HomeCollectionView[]>;
  abstract homeCollection(id: string): Promise<HomeCollectionView | null>;
}

/** The patient: registered, or a name and mobile number until they register. */
export interface DeskPatient {
  readonly patientId: string | null;
  readonly patientName: string | null;
  readonly mobileNo: string | null;
}

export class BookTestAppointmentCommand extends Command<{ id: string; number: string; serial: number }> {
  constructor(
    readonly actor: Actor,
    readonly patient: DeskPatient,
    readonly request: TestAppointmentRequest,
  ) {
    super();
  }
}

export type TestAppointmentChange =
  | { readonly kind: 'no_show' }
  | { readonly kind: 'cancel'; readonly reason: string }
  | { readonly kind: 'attach'; readonly patientId: string };

export class ChangeTestAppointmentCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly change: TestAppointmentChange,
  ) {
    super();
  }
}

export class BookHomeCollectionCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly patient: DeskPatient,
    readonly request: HomeCollectionRequest,
  ) {
    super();
  }
}

export type HomeCollectionChange =
  | { readonly kind: 'assign'; readonly collectorId: string }
  | { readonly kind: 'collected'; readonly note: string | null }
  | { readonly kind: 'cancel'; readonly reason: string }
  | { readonly kind: 'attach'; readonly patientId: string };

export class ChangeHomeCollectionCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly change: HomeCollectionChange,
  ) {
    super();
  }
}

export class GetWindowAvailabilityQuery extends Query<WindowAvailability[]> {
  constructor(
    readonly actor: Actor,
    readonly date: string,
    readonly departmentId: string | null,
  ) {
    super();
  }
}

export class GetTestAppointmentBoardQuery extends Query<TestAppointmentBoard> {
  constructor(
    readonly actor: Actor,
    readonly filter: Partial<TestAppointmentFilter>,
  ) {
    super();
  }
}

export class GetTestAppointmentQuery extends Query<TestAppointmentView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class GetHomeCollectionBoardQuery extends Query<HomeCollectionBoard> {
  constructor(
    readonly actor: Actor,
    /** `collectorId: 'me'` is the signed-in collector's own. */
    readonly filter: Partial<HomeCollectionFilter>,
  ) {
    super();
  }
}

/** The active users who take samples at homes (diag:collect), to give a home collection to. */
export class ListCollectorsQuery extends Query<{ id: string; displayName: string }[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class GetHomeCollectionQuery extends Query<HomeCollectionView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
