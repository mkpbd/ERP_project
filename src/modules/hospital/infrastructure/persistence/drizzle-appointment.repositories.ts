import { Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, count, desc, eq, gte, lte, ne } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  AppointmentReadRepository,
  type AppointmentFilter,
  type AppointmentView,
} from '../../application/appointment.messages.js';
import { Appointment, type Sitting } from '../../domain/appointment.js';
import { AppointmentRepository, type BookableDoctor } from '../../domain/repositories.js';
import { appointments, doctorClosures, doctors, doctorSchedules, patients } from './hospital.schema.js';

@Injectable()
export class DrizzleAppointmentRepository extends AppointmentRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<Appointment | null> {
    const [row] = await this.context.db.select().from(appointments).where(eq(appointments.id, id)).for('update');
    return row ? Appointment.restore(row) : null;
  }

  async insert(appointment: Appointment): Promise<void> {
    await this.context.db.insert(appointments).values(appointment.toSnapshot());
  }

  async update(appointment: Appointment): Promise<void> {
    const { id, ...row } = appointment.toSnapshot();
    await this.context.db.update(appointments).set(row).where(eq(appointments.id, id));
  }

  async doctor(id: string): Promise<BookableDoctor | null> {
    const [row] = await this.context.db
      .select({
        id: doctors.id,
        name: doctors.name,
        isActive: doctors.isActive,
        isConsultant: doctors.isConsultant,
        firstVisitFee: doctors.firstVisitFee,
        newVisitFee: doctors.newVisitFee,
        followUpFee: doctors.followUpFee,
        reportFee: doctors.reportFee,
      })
      .from(doctors)
      .where(eq(doctors.id, id));
    return row ?? null;
  }

  async sitting(doctorId: string, dayOfWeek: number): Promise<Sitting | null> {
    const [row] = await this.context.db
      .select({
        startTime: doctorSchedules.startTime,
        slotMinutes: doctorSchedules.slotMinutes,
        maxPatients: doctorSchedules.maxPatients,
      })
      .from(doctorSchedules)
      .where(
        and(
          eq(doctorSchedules.doctorId, doctorId),
          eq(doctorSchedules.dayOfWeek, dayOfWeek),
          eq(doctorSchedules.isActive, true),
        ),
      );
    return row ?? null;
  }

  async closure(doctorId: string, date: string): Promise<{ reason: string | null } | undefined> {
    const [row] = await this.context.db
      .select({ reason: doctorClosures.reason })
      .from(doctorClosures)
      .where(and(eq(doctorClosures.doctorId, doctorId), eq(doctorClosures.closedOn, date)));
    return row;
  }

  async takenSerials(doctorId: string, date: string): Promise<Set<number>> {
    const rows = await this.context.db
      .select({ serial: appointments.serial })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          eq(appointments.appointmentDate, date),
          ne(appointments.status, 'cancelled'),
        ),
      );
    return new Set(rows.map((row) => row.serial));
  }

  async patientContact(id: string): Promise<{ id: string; fullName: string; mobileNo: string } | null> {
    const [row] = await this.context.db
      .select({
        id: patients.id,
        fullName: patients.fullName,
        mobileNo: patients.mobileNo,
        contactMobileNo: patients.contactMobileNo,
      })
      .from(patients)
      .where(and(eq(patients.id, id), eq(patients.isActive, true)));
    if (!row) return null;
    return { id: row.id, fullName: row.fullName, mobileNo: (row.mobileNo ?? row.contactMobileNo)! };
  }
}

const referrers = aliasedTable(doctors, 'referrers');

@Injectable()
export class DrizzleAppointmentReadRepository extends AppointmentReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private views() {
    return this.context.db
      .select({
        id: appointments.id,
        doctorId: appointments.doctorId,
        doctorName: doctors.name,
        roomNo: doctors.roomNo,
        appointmentDate: appointments.appointmentDate,
        serial: appointments.serial,
        slotTime: appointments.slotTime,
        visitType: appointments.visitType,
        patientId: appointments.patientId,
        uhid: patients.uhid,
        patientName: appointments.patientName,
        mobileNo: appointments.mobileNo,
        referredById: appointments.referredById,
        referredByName: referrers.name,
        fee: appointments.fee,
        status: appointments.status,
        statusReason: appointments.statusReason,
        remarks: appointments.remarks,
        bookedBy: appointments.bookedBy,
        createdAt: appointments.createdAt,
        version: appointments.version,
      })
      .from(appointments)
      .innerJoin(doctors, eq(doctors.id, appointments.doctorId))
      .leftJoin(referrers, eq(referrers.id, appointments.referredById))
      .leftJoin(patients, eq(patients.id, appointments.patientId));
  }

  async list(filter: AppointmentFilter): Promise<Page<AppointmentView>> {
    const where = and(
      filter.doctorId ? eq(appointments.doctorId, filter.doctorId) : undefined,
      filter.patientId ? eq(appointments.patientId, filter.patientId) : undefined,
      filter.from ? gte(appointments.appointmentDate, filter.from) : undefined,
      filter.to ? lte(appointments.appointmentDate, filter.to) : undefined,
      filter.status ? eq(appointments.status, filter.status) : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.views()
        .where(where)
        .orderBy(desc(appointments.appointmentDate), asc(doctors.name), asc(appointments.serial))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(appointments).where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async get(id: string): Promise<AppointmentView | null> {
    const [row] = await this.views().where(eq(appointments.id, id));
    return row ?? null;
  }

  async ofDay(doctorId: string, date: string): Promise<AppointmentView[]> {
    return this.views()
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          eq(appointments.appointmentDate, date),
          ne(appointments.status, 'cancelled'),
        ),
      )
      .orderBy(asc(appointments.serial));
  }

  async doctorCard(id: string): Promise<{ name: string; roomNo: string | null } | null> {
    const [row] = await this.context.db
      .select({ name: doctors.name, roomNo: doctors.roomNo })
      .from(doctors)
      .where(eq(doctors.id, id));
    return row ?? null;
  }
}
