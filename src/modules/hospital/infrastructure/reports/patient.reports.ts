import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { LocationDirectory } from '../../../../shared/application/contracts/location-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { code39Svg } from '../../../../shared/infrastructure/reports/code39.js';
import { localToday } from '../../application/patient.handlers.js';
import type { PatientReadRepository } from '../../application/patient.messages.js';
import { ageOn } from '../../domain/patient.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();

const SEX_LABELS = { male: 'Male', female: 'Female', other: 'Other' } as const;

/**
 * Old PatientIDCardDocument (300 × 400 pt, a QR code of the patient's details): an ID-card-size card (85.6 × 54 mm)
 * with the UHID as a Code 39 barcode for the counters' scanners, the photo when there is one, and the organization.
 */
export function patientCardReport(read: PatientReadRepository): ReportDefinition {
  return defineReport({
    key: 'hospital.patient-card',
    title: 'Patient card',
    group: 'Hospital',
    description: "A patient's identification card: name, UHID with barcode, age, sex, blood group, mobile and photo.",
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const patient = await read.get(params.id);
      if (!patient) throw new NotFoundError('patient');
      const photo = patient.hasPhoto ? await read.photo(params.id) : null;
      const age = ageOn(patient.dateOfBirth, localToday(report.generatedAt, report.timeZone));
      return {
        organization: report.header,
        patient: {
          ...patient,
          sex: SEX_LABELS[patient.sex],
          age: age.years > 0 ? `${age.years} y` : age.months > 0 ? `${age.months} m ${age.days} d` : `${age.days} d`,
        },
        barcode: code39Svg(String(patient.uhid)),
        photo: photo ? `data:${photo.contentType};base64,${Buffer.from(photo.data).toString('base64')}` : null,
        issuedOn: localToday(report.generatedAt, report.timeZone),
      };
    },
    describe: (_params, data) => `UHID ${data.patient.uhid}`,
    pdf: {
      engine: 'html',
      template: template('patient-card'),
      bare: true,
      paper: { width: '85.6mm', height: '54mm' },
    },
  });
}

/** Old NewRegistration list (by registration dates) as a printable register. */
export function patientRegisterReport(read: PatientReadRepository, locations: LocationDirectory): ReportDefinition {
  return defineReport({
    key: 'hospital.patient-register',
    title: 'Patient registrations',
    group: 'Hospital',
    description: 'Patients registered over a period: UHID, name, sex, age, mobile, district and status.',
    params: z.strictObject({ from: day, to: day }),
    async load(params, report) {
      if (params.from > params.to) throw new DomainError('invalid_period', 'The start date is after the end date');
      const today = localToday(report.generatedAt, report.timeZone);
      const registered = await read.registered(params.from, params.to);
      const districts = await locations.districtNames(
        registered.flatMap((row) => (row.districtId ? [row.districtId] : [])),
      );
      const rows = registered.map((row) => ({
        ...row,
        districtName: row.districtId ? (districts.get(row.districtId) ?? null) : null,
        sex: SEX_LABELS[row.sex],
        ageYears: ageOn(row.dateOfBirth, today).years,
        status: row.isActive ? 'Active' : 'Inactive',
      }));
      return {
        rows,
        male: rows.filter((row) => row.sex === 'Male').length,
        female: rows.filter((row) => row.sex === 'Female').length,
        other: rows.filter((row) => row.sex === 'Other').length,
      };
    },
    describe: (params, data) => `${params.from} to ${params.to} · ${data.rows.length} patients`,
    pdf: { engine: 'html', template: template('patient-register'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'registeredOn', header: 'Registered on', format: 'date' },
        { key: 'uhid', header: 'UHID', format: 'integer' },
        { key: 'fullName', header: 'Name', width: 28 },
        { key: 'sex', header: 'Sex', width: 8 },
        { key: 'ageYears', header: 'Age (years)', format: 'integer' },
        { key: 'mobileNo', header: 'Mobile', width: 14 },
        { key: 'districtName', header: 'District', width: 16 },
        { key: 'status', header: 'Status', width: 10 },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}
