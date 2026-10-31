import { Command, CommandHandler, Query, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  DiagnosticBookings,
  type BookableTestOffer,
  type HomeCollectionOffer,
  type HomeCollectionRequest,
  type PatientHomeCollection,
  type PatientTestAppointment,
  type TestAppointmentRequest,
  type WindowAvailability,
} from '../../../shared/application/contracts/diagnostic-bookings.js';
import type { PortalClaims } from './portal.ports.js';

export class PortalTestCatalogueQuery extends Query<BookableTestOffer[]> {
  constructor(readonly text: string | null) {
    super();
  }
}

export class PortalWindowsQuery extends Query<WindowAvailability[]> {
  constructor(
    readonly date: string,
    readonly departmentId: string | null,
  ) {
    super();
  }
}

export class PortalHomeCollectionOfferQuery extends Query<HomeCollectionOffer> {}

export class PortalBookingsQuery extends Query<{
  appointments: PatientTestAppointment[];
  homeCollections: PatientHomeCollection[];
}> {
  constructor(readonly patient: PortalClaims) {
    super();
  }
}

export class PortalBookAppointmentCommand extends Command<{ id: string; number: string; serial: number }> {
  constructor(
    readonly patient: PortalClaims,
    readonly request: TestAppointmentRequest,
  ) {
    super();
  }
}

export class PortalBookHomeCollectionCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly patient: PortalClaims,
    readonly request: HomeCollectionRequest,
  ) {
    super();
  }
}

export class PortalCancelBookingCommand extends Command<void> {
  constructor(
    readonly patient: PortalClaims,
    readonly kind: 'appointment' | 'home_collection',
    readonly id: string,
  ) {
    super();
  }
}

/** The tests a patient may book, with their rates (no sign-in needed), through DiagnosticBookings. */
@QueryHandler(PortalTestCatalogueQuery)
export class PortalTestCatalogueHandler implements IQueryHandler<PortalTestCatalogueQuery> {
  constructor(private readonly bookings: DiagnosticBookings) {}

  execute({ text }: PortalTestCatalogueQuery) {
    return this.bookings.catalogue(text);
  }
}

@QueryHandler(PortalWindowsQuery)
export class PortalWindowsHandler implements IQueryHandler<PortalWindowsQuery> {
  constructor(private readonly bookings: DiagnosticBookings) {}

  execute({ date, departmentId }: PortalWindowsQuery) {
    return this.bookings.appointmentDay(date, departmentId);
  }
}

@QueryHandler(PortalHomeCollectionOfferQuery)
export class PortalHomeCollectionOfferHandler implements IQueryHandler<PortalHomeCollectionOfferQuery> {
  constructor(private readonly bookings: DiagnosticBookings) {}

  execute() {
    return this.bookings.homeCollectionOffer();
  }
}

/** The signed-in patient's test appointments and home collections (old: the app's "my bookings"). */
@QueryHandler(PortalBookingsQuery)
export class PortalBookingsHandler implements IQueryHandler<PortalBookingsQuery> {
  constructor(private readonly bookings: DiagnosticBookings) {}

  async execute({ patient }: PortalBookingsQuery) {
    const [appointments, homeCollections] = await Promise.all([
      this.bookings.appointments(patient.patientId),
      this.bookings.homeCollections(patient.patientId),
    ]);
    return { appointments, homeCollections };
  }
}

@CommandHandler(PortalBookAppointmentCommand)
export class PortalBookAppointmentHandler implements ICommandHandler<PortalBookAppointmentCommand> {
  constructor(private readonly bookings: DiagnosticBookings) {}

  execute({ patient, request }: PortalBookAppointmentCommand) {
    return this.bookings.bookAppointment(patient.patientId, request);
  }
}

@CommandHandler(PortalBookHomeCollectionCommand)
export class PortalBookHomeCollectionHandler implements ICommandHandler<PortalBookHomeCollectionCommand> {
  constructor(private readonly bookings: DiagnosticBookings) {}

  execute({ patient, request }: PortalBookHomeCollectionCommand) {
    return this.bookings.bookHomeCollection(patient.patientId, request);
  }
}

@CommandHandler(PortalCancelBookingCommand)
export class PortalCancelBookingHandler implements ICommandHandler<PortalCancelBookingCommand> {
  constructor(private readonly bookings: DiagnosticBookings) {}

  execute({ patient, kind, id }: PortalCancelBookingCommand) {
    return kind === 'appointment'
      ? this.bookings.cancelAppointment(patient.patientId, id)
      : this.bookings.cancelHomeCollection(patient.patientId, id);
  }
}

export const PORTAL_BOOKING_HANDLERS = [
  PortalTestCatalogueHandler,
  PortalWindowsHandler,
  PortalHomeCollectionOfferHandler,
  PortalBookingsHandler,
  PortalBookAppointmentHandler,
  PortalBookHomeCollectionHandler,
  PortalCancelBookingHandler,
];
