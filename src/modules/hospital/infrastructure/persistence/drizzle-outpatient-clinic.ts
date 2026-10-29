import { Injectable } from '@nestjs/common';
import { aliasedTable, eq, inArray, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  OutpatientClinic,
  type ClinicAppointment,
  type ClinicDoctor,
} from '../../../../shared/application/contracts/outpatient-clinic.js';
import { appointments, doctors, specialities } from './hospital.schema.js';

const referrers = aliasedTable(doctors, 'referrers');

/** The doctors and chamber appointments as the clinical module sees them. */
@Injectable()
export class DrizzleOutpatientClinic extends OutpatientClinic {
  constructor(private readonly context: DbContext) {
    super();
  }

  private selectDoctors(where: SQL): Promise<ClinicDoctor[]> {
    return this.context.db
      .select({
        id: doctors.id,
        name: doctors.name,
        degrees: doctors.degrees,
        specialityName: specialities.name,
        isActive: doctors.isActive,
        userId: doctors.userId,
      })
      .from(doctors)
      .leftJoin(specialities, eq(specialities.id, doctors.specialityId))
      .where(where);
  }

  async doctorOfUser(userId: string): Promise<ClinicDoctor | null> {
    const [row] = await this.selectDoctors(eq(doctors.userId, userId));
    return row ?? null;
  }

  async doctors(ids: readonly string[]): Promise<Map<string, ClinicDoctor>> {
    if (ids.length === 0) return new Map();
    const rows = await this.selectDoctors(inArray(doctors.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async appointment(id: string): Promise<ClinicAppointment | null> {
    const [row] = await this.context.db
      .select({
        id: appointments.id,
        doctorId: appointments.doctorId,
        patientId: appointments.patientId,
        appointmentDate: appointments.appointmentDate,
        serial: appointments.serial,
        visitType: appointments.visitType,
        status: appointments.status,
        referredByName: referrers.name,
      })
      .from(appointments)
      .leftJoin(referrers, eq(referrers.id, appointments.referredById))
      .where(eq(appointments.id, id));
    return row ?? null;
  }
}
