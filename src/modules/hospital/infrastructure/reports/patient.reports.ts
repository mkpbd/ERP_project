import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { LocationDirectory } from '../../../../shared/application/contracts/location-directory.js';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { code39Svg } from '../../../../shared/infrastructure/reports/code39.js';
import { localToday } from '../../application/patient.handlers.js';
import type { PatientReadRepository } from '../../application/patient.messages.js';
import { ageOn, uhidLabel } from '../../domain/patient.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();

const SEX_LABELS = { male: 'Male', female: 'Female', other: 'Other' } as const;

/**
 * Old PatientIDCardDocument (300 × 400 pt, a QR code of the patient's details): an ID-card-size card (85.6 × 54 mm)
 * with the UHID (with the organization's prefix) as a Code 39 barcode for the counters' scanners, a QR code of the
 * UHID, name, sex, birth date and mobile as the old card had, the photo when there is one, and the organization.
 */
export function patientCardReport(read: PatientReadRepository, organization: OrganizationProfile): ReportDefinition {
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
      const label = uhidLabel(await organization.patientIdPrefix(), patient.uhid);
      const phone = patient.mobileNo ?? patient.contactMobileNo;
      const qr = await QRCode.toString(
        [label, patient.fullName, SEX_LABELS[patient.sex], patient.dateOfBirth, phone].join('\n'),
        { type: 'svg', margin: 0, errorCorrectionLevel: 'M' },
      );
      return {
        organization: report.header,
        patient: {
          ...patient,
          sex: SEX_LABELS[patient.sex],
          uhidLabel: label,
          phone,
          phoneIsContact: patient.mobileNo === null,
          age: age.years > 0 ? `${age.years} y` : age.months > 0 ? `${age.months} m ${age.days} d` : `${age.days} d`,
        },
        barcode: code39Svg(label),
        qr,
        photo: photo ? `data:${photo.contentType};base64,${Buffer.from(photo.data).toString('base64')}` : null,
        issuedOn: localToday(report.generatedAt, report.timeZone),
      };
    },
    describe: (_params, data) => `UHID ${data.patient.uhidLabel}`,
    pdf: {
      engine: 'html',
      template: template('patient-card'),
      bare: true,
      paper: { width: '85.6mm', height: '54mm' },
    },
  });
}

/** Old NewRegistration list (by registration dates) as a printable register. */
export function patientRegisterReport(
  read: PatientReadRepository,
  locations: LocationDirectory,
  organization: OrganizationProfile,
): ReportDefinition {
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
      const prefix = await organization.patientIdPrefix();
      const districts = await locations.districtNames(
        registered.flatMap((row) => (row.districtId ? [row.districtId] : [])),
      );
      const rows = registered.map((row) => ({
        ...row,
        uhidLabel: uhidLabel(prefix, row.uhid),
        phone: row.mobileNo ?? (row.contactMobileNo ? `${row.contactMobileNo} (contact)` : null),
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
        { key: 'uhidLabel', header: 'UHID', width: 14 },
        { key: 'fullName', header: 'Name', width: 28 },
        { key: 'sex', header: 'Sex', width: 8 },
        { key: 'ageYears', header: 'Age (years)', format: 'integer' },
        { key: 'phone', header: 'Mobile', width: 22 },
        { key: 'districtName', header: 'District', width: 16 },
        { key: 'status', header: 'Status', width: 10 },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}
