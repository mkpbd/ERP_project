import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { Appointment, chooseSerial, feeFor, slotTime, weekdayOf } from '../domain/appointment.js';
import { suggestedVisit } from '../domain/opd-bill.js';
import { normalMobile } from '../domain/patient.js';
import { AppointmentRepository, OpdBillRepository } from '../domain/repositories.js';
import {
  AppointmentReadRepository,
  BookAppointmentCommand,
  ChangeAppointmentCommand,
  GetAppointmentQuery,
  GetDoctorDayQuery,
  ListAppointmentsQuery,
} from './appointment.messages.js';
import { OPD_BOOK, OPD_READ } from './hospital.constants.js';
import { HOSPITAL_SETTINGS, localToday, type HospitalSettings } from './patient.handlers.js';

@Injectable()
export class AppointmentDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly appointments: AppointmentRepository,
    readonly bills: OpdBillRepository,
    readonly read: AppointmentReadRepository,
    @Inject(HOSPITAL_SETTINGS) readonly settings: HospitalSettings,
  ) {}

  today(): string {
    return localToday(this.clock.now(), this.settings.timeZone);
  }

  record(action: string, actor: Actor, id: string, metadata: Record<string, string | number | null> = {}) {
    return this.audit.record({
      action: `hospital.appointment_${action}`,
      actorUserId: actor.userId,
      resourceType: 'appointment',
      resourceId: id,
      metadata,
    });
  }

  async patient(id: string) {
    const patient = await this.appointments.patientContact(id);
    if (!patient) throw new NotFoundError('patient');
    return patient;
  }
}

/**
 * Old AddEditDoctorAppointmentCommand: a serial with a consultant on a day they sit. The serial is taken under a lock
 * on the doctor's day (the old page held slots in memory per server and checked again with unique indexes); the fee
 * is the doctor's for the visit type. The old page sent an SMS before knowing the save worked; no message is sent
 * here.
 */
@CommandHandler(BookAppointmentCommand)
export class BookAppointmentHandler implements ICommandHandler<BookAppointmentCommand> {
  constructor(private readonly desk: AppointmentDesk) {}

  async execute({ actor, input }: BookAppointmentCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [OPD_BOOK] });
    return desk.tx.run(async () => {
      const doctor = await desk.appointments.doctor(input.doctorId);
      if (!doctor) throw new NotFoundError('doctor');
      if (!doctor.isActive || !doctor.isConsultant) {
        throw new DomainError('not_bookable', `${doctor.name} does not see patients here`);
      }
      if (input.referredById) {
        const referrer = await desk.appointments.doctor(input.referredById);
        if (!referrer) throw new NotFoundError('referring_doctor');
      }
      const closure = await desk.appointments.closure(doctor.id, input.appointmentDate);
      if (closure) {
        throw new DomainError(
          'doctor_off',
          `${doctor.name} does not sit that day${closure.reason ? `: ${closure.reason}` : ''}`,
        );
      }
      const sitting = await desk.appointments.sitting(doctor.id, weekdayOf(input.appointmentDate));
      if (!sitting) throw new DomainError('doctor_off', `${doctor.name} does not sit on that weekday`);

      const patient = input.patientId ? await desk.patient(input.patientId) : null;
      if (!patient && (!input.patientName || !input.mobileNo)) {
        throw new DomainError('patient_needed', 'Give a registered patient, or the name and mobile number');
      }
      await desk.tx.lock(`hospital:appointments:${doctor.id}:${input.appointmentDate}`);
      const taken = await desk.appointments.takenSerials(doctor.id, input.appointmentDate);
      const serial = chooseSerial(sitting, taken, input.serial);
      const visitType =
        input.visitType ??
        suggestedVisit(
          patient ? await desk.bills.lastVisitOn(patient.id, doctor.id) : null,
          input.appointmentDate,
          (await desk.bills.policy()).followUpDays,
        );
      const appointment = Appointment.book({
        id: randomUUID(),
        doctorId: doctor.id,
        appointmentDate: input.appointmentDate,
        serial,
        slotTime: slotTime(sitting, serial),
        visitType,
        patientId: patient?.id ?? null,
        patientName: patient?.fullName ?? input.patientName!,
        mobileNo: patient?.mobileNo ?? normalMobile(input.mobileNo!),
        referredById: input.referredById,
        fee: feeFor(doctor, visitType),
        remarks: input.remarks,
        bookedBy: actor.userId,
        today: desk.today(),
        now: desk.clock.now(),
      });
      await desk.appointments.insert(appointment);
      const booked = appointment.toSnapshot();
      await desk.record('booked', actor, booked.id, {
        doctorId: doctor.id,
        date: booked.appointmentDate,
        serial: booked.serial,
      });
      return { id: booked.id, serial: booked.serial, slotTime: booked.slotTime, fee: booked.fee };
    });
  }
}

@CommandHandler(ChangeAppointmentCommand)
export class ChangeAppointmentHandler implements ICommandHandler<ChangeAppointmentCommand> {
  constructor(private readonly desk: AppointmentDesk) {}

  async execute({ actor, id, version, change }: ChangeAppointmentCommand): Promise<void> {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [OPD_BOOK] });
    await desk.tx.run(async () => {
      const appointment = await desk.appointments.findForUpdate(id);
      if (!appointment) throw new NotFoundError('appointment');
      appointment.assertVersion(version);
      const now = desk.clock.now();
      switch (change.kind) {
        case 'arrive':
          appointment.arrive(desk.today(), now);
          break;
        case 'no_show':
          appointment.noShow(desk.today(), now);
          break;
        case 'cancel':
          appointment.cancel(change.reason, now);
          break;
        case 'attach':
          appointment.attach(await desk.patient(change.patientId), now);
          break;
      }
      await desk.appointments.update(appointment);
      await desk.record(
        change.kind === 'arrive' ? 'arrived' : change.kind === 'attach' ? 'attached' : change.kind,
        actor,
        id,
        {
          reason: change.kind === 'cancel' ? change.reason : null,
          patientId: appointment.patientId,
        },
      );
    });
  }
}

@QueryHandler(ListAppointmentsQuery)
export class ListAppointmentsHandler implements IQueryHandler<ListAppointmentsQuery> {
  constructor(private readonly desk: AppointmentDesk) {}

  async execute({ actor, filter }: ListAppointmentsQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [OPD_READ] });
    return this.desk.read.list(filter);
  }
}

@QueryHandler(GetAppointmentQuery)
export class GetAppointmentHandler implements IQueryHandler<GetAppointmentQuery> {
  constructor(private readonly desk: AppointmentDesk) {}

  async execute({ actor, id }: GetAppointmentQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [OPD_READ] });
    const appointment = await this.desk.read.get(id);
    if (!appointment) throw new NotFoundError('appointment');
    return appointment;
  }
}

/** Old doctor board and slot list (start + interval × i): every serial of the day, booked or free. */
@QueryHandler(GetDoctorDayQuery)
export class GetDoctorDayHandler implements IQueryHandler<GetDoctorDayQuery> {
  constructor(private readonly desk: AppointmentDesk) {}

  async execute({ actor, doctorId, date }: GetDoctorDayQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [OPD_READ] });
    const doctor = await desk.read.doctorCard(doctorId);
    if (!doctor) throw new NotFoundError('doctor');
    const [sitting, closure, booked] = await Promise.all([
      desk.appointments.sitting(doctorId, weekdayOf(date)),
      desk.appointments.closure(doctorId, date),
      desk.read.ofDay(doctorId, date),
    ]);
    const bySerial = new Map(booked.map((appointment) => [appointment.serial, appointment]));
    const slots = sitting
      ? Array.from({ length: sitting.maxPatients }, (_, index) => ({
          serial: index + 1,
          time: slotTime(sitting, index + 1),
          appointment: bySerial.get(index + 1) ?? null,
        }))
      : [];
    return {
      doctorId,
      doctorName: doctor.name,
      roomNo: doctor.roomNo,
      date,
      sitting,
      closed: closure ?? null,
      slots,
      others: booked.filter((appointment) => !sitting || appointment.serial > sitting.maxPatients),
    };
  }
}

export const APPOINTMENT_HANDLERS = [
  AppointmentDesk,
  BookAppointmentHandler,
  ChangeAppointmentHandler,
  ListAppointmentsHandler,
  GetAppointmentHandler,
  GetDoctorDayHandler,
];
