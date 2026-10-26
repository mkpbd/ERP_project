import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { AppointmentReadRepository } from '../../application/appointment.messages.js';
import { uhidLabel } from '../../domain/patient.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

const VISIT_LABELS = { first: 'First visit', new: 'New', follow_up: 'Follow-up', report: 'Report showing' } as const;
const STATUS_LABELS = { booked: 'Booked', arrived: 'Arrived', no_show: 'No-show', cancelled: 'Cancelled' } as const;

/** Old PrintPatientAppointmentDocument: a doctor's bookings on a day, by serial, for the chamber door. */
export function doctorAppointmentsReport(
  read: AppointmentReadRepository,
  organization: OrganizationProfile,
): ReportDefinition {
  return defineReport({
    key: 'hospital.doctor-appointments',
    title: 'Doctor appointments',
    group: 'Hospital',
    description: "A doctor's appointments on a day by serial: time, patient, UHID, mobile, visit type and status.",
    params: z.strictObject({ doctorId: z.uuid(), date: z.iso.date() }),
    async load(params) {
      const doctor = await read.doctorCard(params.doctorId);
      if (!doctor) throw new NotFoundError('doctor');
      const prefix = await organization.patientIdPrefix();
      const rows = (await read.ofDay(params.doctorId, params.date)).map((row) => ({
        ...row,
        uhidLabel: row.uhid === null ? null : uhidLabel(prefix, row.uhid),
        visit: VISIT_LABELS[row.visitType],
        state: STATUS_LABELS[row.status],
      }));
      return { doctor, date: params.date, rows };
    },
    describe: (_params, data) =>
      `${data.doctor.name}${data.doctor.roomNo ? ` · room ${data.doctor.roomNo}` : ''} · ${data.date}`,
    pdf: { engine: 'html', template: template('doctor-appointments') },
    xlsx: (data) => ({
      columns: [
        { key: 'serial', header: 'Serial', format: 'integer' },
        { key: 'slotTime', header: 'Time', width: 8 },
        { key: 'uhidLabel', header: 'UHID', width: 14 },
        { key: 'patientName', header: 'Patient', width: 28 },
        { key: 'mobileNo', header: 'Mobile', width: 14 },
        { key: 'visit', header: 'Visit', width: 14 },
        { key: 'fee', header: 'Fee', format: 'money' },
        { key: 'state', header: 'Status', width: 10 },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}

/** Old CP patient sticker / appointment SMS text: the slip a patient keeps (80 mm roll). */
export function appointmentSlipReport(
  read: AppointmentReadRepository,
  organization: OrganizationProfile,
): ReportDefinition {
  return defineReport({
    key: 'hospital.appointment-slip',
    title: 'Appointment slip',
    group: 'Hospital',
    description: 'The slip given at booking: doctor, room, date, serial and time, patient and fee.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const appointment = await read.get(params.id);
      if (!appointment) throw new NotFoundError('appointment');
      const prefix = await organization.patientIdPrefix();
      return {
        organization: report.header.organizationName,
        appointment: {
          ...appointment,
          uhidLabel: appointment.uhid === null ? null : uhidLabel(prefix, appointment.uhid),
          visit: VISIT_LABELS[appointment.visitType],
          state: STATUS_LABELS[appointment.status],
        },
      };
    },
    describe: (_params, data) => `${data.appointment.doctorName} · serial ${data.appointment.serial}`,
    pdf: {
      engine: 'html',
      template: template('appointment-slip'),
      bare: true,
      paper: { width: '80mm', height: '120mm' },
    },
  });
}
