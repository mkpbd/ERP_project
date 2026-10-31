import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import type { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import type { DiagnosticBookingReadRepository } from '../../application/booking.messages.js';
import { uhidLabel } from '../../domain/patient.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

const APPOINTMENT_STATES = { booked: 'Booked', billed: 'Billed', no_show: 'No-show', cancelled: 'Cancelled' } as const;
const COLLECTION_STATES = {
  booked: 'Booked',
  assigned: 'Collector given',
  collected: 'Collected',
  cancelled: 'Cancelled',
} as const;

/** Old app's booking confirmation: the slip a patient keeps (80 mm roll), with the serial and the tests quoted. */
export function testAppointmentSlipReport(
  read: DiagnosticBookingReadRepository,
  organization: OrganizationProfile,
): ReportDefinition {
  return defineReport({
    key: 'hospital.test-appointment-slip',
    title: 'Test appointment slip',
    group: 'Hospital',
    description: 'The slip given at booking: the day, window and serial, the patient and the tests quoted.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const appointment = await read.appointment(params.id);
      if (!appointment) throw new NotFoundError('test_appointment');
      const prefix = await organization.patientIdPrefix();
      return {
        organization: report.header.organizationName,
        appointment: {
          ...appointment,
          uhidLabel: appointment.uhid === null ? null : uhidLabel(prefix, appointment.uhid),
          state: APPOINTMENT_STATES[appointment.status],
        },
      };
    },
    describe: (_params, data) => `${data.appointment.number} · serial ${data.appointment.serial}`,
    pdf: {
      engine: 'html',
      template: template('test-appointment-slip'),
      bare: true,
      paper: { width: '80mm', height: '150mm' },
    },
  });
}

/**
 * The collector's run sheet (the old app handed the window's label to the collector and nothing else): a day's home
 * collections by collector and window, with the address, the tests and what to collect, and a column to sign.
 */
export function homeCollectionSheetReport(
  read: DiagnosticBookingReadRepository,
  organization: OrganizationProfile,
  users: UserDirectory,
): ReportDefinition {
  return defineReport({
    key: 'hospital.home-collection-sheet',
    title: 'Home collection sheet',
    group: 'Hospital',
    description:
      "A day's home collections by collector and window: patient, mobile, address, tests and what to collect.",
    params: z.strictObject({ date: z.iso.date(), collectorId: z.uuid().optional() }),
    async load(params) {
      const prefix = await organization.patientIdPrefix();
      const [collector] = params.collectorId ? await users.findSummaries([params.collectorId]) : [];
      if (params.collectorId && !collector) throw new NotFoundError('user');
      const rows = (await read.homeCollections({ from: params.date, to: params.date, collectorId: params.collectorId }))
        .filter((row) => row.status !== 'cancelled')
        .map((row) => ({
          ...row,
          uhidLabel: row.uhid === null ? null : uhidLabel(prefix, row.uhid),
          testNames: row.tests.map((test) => test.testName).join(', '),
          state: COLLECTION_STATES[row.status],
          collector: row.collectorName ?? 'No collector yet',
          toCollect: row.billDue ?? row.total,
        }));
      const groups = [...new Set(rows.map((row) => row.collector))].map((name) => {
        const own = rows.filter((row) => row.collector === name);
        return {
          collector: name,
          rows: own,
          visits: own.length === 1 ? '1 visit' : `${own.length} visits`,
          total: own.reduce((sum, row) => sum + Math.round(row.toCollect * 100), 0) / 100,
        };
      });
      return { date: params.date, collectorName: collector?.displayName ?? null, groups, count: rows.length };
    },
    describe: (_params, data) => `${data.date}${data.collectorName ? ` · ${data.collectorName}` : ''}`,
    pdf: { engine: 'html', template: template('home-collection-sheet'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'collector', header: 'Collector', width: 20 },
        { key: 'windowLabel', header: 'Window', width: 18 },
        { key: 'number', header: 'Booking', width: 16 },
        { key: 'uhidLabel', header: 'UHID', width: 14 },
        { key: 'patientName', header: 'Patient', width: 24 },
        { key: 'mobileNo', header: 'Mobile', width: 14 },
        { key: 'areaName', header: 'Area', width: 16 },
        { key: 'address', header: 'Address', width: 36 },
        { key: 'landmark', header: 'Landmark', width: 20 },
        { key: 'testNames', header: 'Tests', width: 36 },
        { key: 'toCollect', header: 'To collect', format: 'money' },
        { key: 'billNumber', header: 'Bill', width: 16 },
        { key: 'state', header: 'Status', width: 14 },
      ],
      rows: data.groups.flatMap((group) => group.rows.map((row) => ({ ...row }))),
    }),
  });
}
