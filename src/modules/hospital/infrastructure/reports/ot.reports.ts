import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import type { OtReadRepository } from '../../application/ot.messages.js';
import { uhidLabel } from '../../domain/patient.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
/** The most operations one register prints. */
const MAX_ROWS = 5_000;
const STATUS_LABELS = {
  requested: 'Waiting for a room',
  scheduled: 'Scheduled',
  in_progress: 'Under way',
  done: 'Done',
  cancelled: 'Cancelled',
} as const;
const ROLE_LABELS = { assistant: 'Assistant', anaesthesia_assistant: 'Anaesthesia assistant' } as const;

/** Old OT Management's schedule tab (no dates, no status) and the booking calendar: operations over a period. */
export function otRegisterReport(read: OtReadRepository): ReportDefinition {
  return defineReport({
    key: 'hospital.ot-register',
    title: 'OT register',
    group: 'Hospital',
    description: 'Operations over a period: room and time, patient, operation, surgeon and how each stands.',
    params: z.strictObject({ from: day, to: day, roomId: z.uuid().optional() }),
    async load(params) {
      if (params.from > params.to) throw new DomainError('invalid_period', 'The start date is after the end date');
      const page = await read.list({
        page: 1,
        pageSize: MAX_ROWS,
        from: params.from,
        to: params.to,
        roomId: params.roomId,
      });
      const rows = [...page.items]
        .sort(
          (a, b) =>
            (a.scheduledFrom?.getTime() ?? Date.parse(a.requestedFor)) -
            (b.scheduledFrom?.getTime() ?? Date.parse(b.requestedFor)),
        )
        .map((row) => ({ ...row, state: STATUS_LABELS[row.status] }));
      const count = (status: keyof typeof STATUS_LABELS) => rows.filter((row) => row.status === status).length;
      return {
        rows,
        done: count('done'),
        cancelled: count('cancelled'),
        open: rows.length - count('done') - count('cancelled'),
      };
    },
    describe: (params, data) => `${params.from} to ${params.to} · ${data.rows.length} operations`,
    pdf: { engine: 'html', template: template('ot-register'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'number', header: 'Operation', width: 16 },
        { key: 'when', header: 'Booked', width: 18 },
        { key: 'room', header: 'Room', width: 14 },
        { key: 'uhid', header: 'UHID', format: 'integer' },
        { key: 'patientName', header: 'Patient', width: 26 },
        { key: 'operationName', header: 'Operation', width: 26 },
        { key: 'surgeonName', header: 'Surgeon', width: 24 },
        { key: 'state', header: 'Status', width: 16 },
      ],
      rows: data.rows.map((row) => ({
        number: row.number,
        when: row.scheduledFrom ? row.scheduledFrom.toISOString() : row.requestedFor,
        room: row.otRoomName,
        uhid: row.uhid,
        patientName: row.patientName,
        operationName: row.operationName,
        surgeonName: row.surgeonName,
        state: row.state,
      })),
    }),
  });
}

/** Old OT Note page's print: the operation note, marked when it is not signed yet. */
export function otNoteReport(read: OtReadRepository, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'hospital.ot-note',
    title: 'Operation note',
    group: 'Hospital',
    description: 'The operation, its team and times, and the surgeon’s note: incision, findings, procedure, specimen.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params) {
      const operation = await read.get(params.id);
      if (!operation) throw new NotFoundError('ot_case');
      return {
        operation: {
          ...operation,
          uhidLabel: uhidLabel(await organization.patientIdPrefix(), operation.uhid),
          state: STATUS_LABELS[operation.status],
          team: operation.team.map((member) => ({ ...member, roleLabel: ROLE_LABELS[member.role] })),
        },
      };
    },
    describe: (_params, data) => `${data.operation.number} · ${data.operation.patientName}`,
    pdf: { engine: 'html', template: template('ot-note') },
  });
}

/** Old "English consent" print of the OT schedule: the consent to the operation and anaesthesia, to sign. */
export function otConsentReport(read: OtReadRepository, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'hospital.ot-consent',
    title: 'Consent to operation',
    group: 'Hospital',
    description: 'The consent the patient or guardian signs: the operation, the surgeon and the anaesthesia.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const operation = await read.get(params.id);
      if (!operation) throw new NotFoundError('ot_case');
      if (operation.status === 'cancelled') throw new DomainError('ot_closed', `${operation.number} is cancelled`);
      return {
        operation: { ...operation, uhidLabel: uhidLabel(await organization.patientIdPrefix(), operation.uhid) },
        organization: report.header.organizationName,
      };
    },
    describe: (_params, data) => `${data.operation.number} · ${data.operation.patientName}`,
    pdf: { engine: 'html', template: template('ot-consent') },
  });
}
