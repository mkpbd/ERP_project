import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { AppointmentStatus, Sitting, VisitType } from '../domain/appointment.js';

export interface AppointmentFilter extends PageRequest {
  readonly doctorId?: string | undefined;
  readonly patientId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly status?: AppointmentStatus | undefined;
}

export interface AppointmentView {
  readonly id: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly roomNo: string | null;
  readonly appointmentDate: string;
  readonly serial: number;
  readonly slotTime: string;
  readonly visitType: VisitType;
  readonly patientId: string | null;
  readonly uhid: number | null;
  readonly patientName: string;
  readonly mobileNo: string;
  readonly referredById: string | null;
  readonly referredByName: string | null;
  readonly fee: number;
  readonly status: AppointmentStatus;
  readonly statusReason: string | null;
  readonly remarks: string | null;
  readonly bookedBy: string | null;
  readonly createdAt: Date;
  readonly version: number;
}

export interface DoctorDayView {
  readonly doctorId: string;
  readonly doctorName: string;
  readonly roomNo: string | null;
  readonly date: string;
  readonly sitting: Sitting | null;
  /** Set when the doctor is off that day. */
  readonly closed: { readonly reason: string | null } | null;
  readonly slots: {
    readonly serial: number;
    readonly time: string;
    readonly appointment: AppointmentView | null;
  }[];
  /** Bookings outside today's sitting (made before the sitting was changed). */
  readonly others: AppointmentView[];
}

export abstract class AppointmentReadRepository {
  abstract list(filter: AppointmentFilter): Promise<Page<AppointmentView>>;
  abstract get(id: string): Promise<AppointmentView | null>;
  /** The doctor's bookings that day that are not cancelled, by serial. */
  abstract ofDay(doctorId: string, date: string): Promise<AppointmentView[]>;
  abstract doctorCard(id: string): Promise<{ name: string; roomNo: string | null } | null>;
}

export interface BookingInput {
  readonly doctorId: string;
  readonly appointmentDate: string;
  /** Left out: a follow-up when the patient saw the doctor within the policy's days, else new. */
  readonly visitType: VisitType | null;
  /** A serial asked for; null takes the first free one. */
  readonly serial: number | null;
  readonly patientId: string | null;
  /** For a patient not registered yet. */
  readonly patientName: string | null;
  readonly mobileNo: string | null;
  readonly referredById: string | null;
  readonly remarks: string | null;
}

export class BookAppointmentCommand extends Command<{ id: string; serial: number; slotTime: string; fee: number }> {
  constructor(
    readonly actor: Actor,
    readonly input: BookingInput,
  ) {
    super();
  }
}

export type AppointmentChange =
  | { readonly kind: 'arrive' }
  | { readonly kind: 'no_show' }
  | { readonly kind: 'cancel'; readonly reason: string }
  | { readonly kind: 'attach'; readonly patientId: string };

export class ChangeAppointmentCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly change: AppointmentChange,
  ) {
    super();
  }
}

export class ListAppointmentsQuery extends Query<Page<AppointmentView>> {
  constructor(
    readonly actor: Actor,
    readonly filter: AppointmentFilter,
  ) {
    super();
  }
}

export class GetAppointmentQuery extends Query<AppointmentView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

/** Old doctor board / slot list: a doctor's sitting on a day, serial by serial, booked or free. */
export class GetDoctorDayQuery extends Query<DoctorDayView> {
  constructor(
    readonly actor: Actor,
    readonly doctorId: string,
    readonly date: string,
  ) {
    super();
  }
}
