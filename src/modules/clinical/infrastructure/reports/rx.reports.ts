import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError } from '../../../../shared/domain/errors.js';
import { code39Svg } from '../../../../shared/infrastructure/reports/code39.js';
import { prescriptionView, type ClinicDesk } from '../../application/rx.handlers.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));

/** "34 Y", "7 M 12 D" or "9 D" on the visit's day. */
export function ageText(dateOfBirth: string, on: string): string {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  let months = (y - by) * 12 + (m - bm);
  let days = d - bd;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  }
  if (months >= 12) return `${Math.floor(months / 12)} Y`;
  if (months > 0) return `${months} M ${days} D`;
  return `${Math.max(days, 0)} D`;
}

/**
 * Old DigitalRx print (DigitalRxDocument, PrintRxVisitFullDocument): the doctor's heading, the patient, then the
 * findings on the left (complaints, history, examination with vitals, diagnosis, tests) and ℞ on the right
 * (medicines, advice, follow-up, signature). Only a signed prescription is printed.
 */
export function prescriptionReport(desk: ClinicDesk, organization: OrganizationProfile): ReportDefinition {
  return defineReport({
    key: 'clinical.prescription',
    title: 'Prescription',
    group: 'Clinical',
    description: "A signed prescription: findings, medicines, tests, advice and follow-up, with the doctor's heading.",
    params: z.strictObject({ prescriptionId: z.uuid() }),
    async load(params, report) {
      const rx = await prescriptionView(desk, params.prescriptionId);
      if (rx.status !== 'signed') throw new DomainError('not_signed', 'The prescription is not signed');
      const vitals = [
        rx.bpSystolic !== null ? `BP ${rx.bpSystolic}/${rx.bpDiastolic} mmHg` : null,
        rx.pulse !== null ? `Pulse ${rx.pulse}/min` : null,
        rx.temperatureF !== null ? `Temp ${rx.temperatureF} °F` : null,
        rx.spo2 !== null ? `SpO2 ${rx.spo2}%` : null,
        rx.weightKg !== null ? `Weight ${rx.weightKg} kg` : null,
        rx.heightCm !== null ? `Height ${rx.heightCm} cm` : null,
        rx.bmi !== null ? `BMI ${rx.bmi}` : null,
      ].filter((entry): entry is string => entry !== null);
      return {
        organization: report.header,
        rx,
        uhidLabel: `${await organization.patientIdPrefix()}${rx.patient.uhid}`,
        age: ageText(rx.patient.dateOfBirth, rx.visitOn),
        vitals,
        barcode: code39Svg(rx.number),
      };
    },
    describe: (_params, data) => `${data.rx.number} · ${data.rx.patient.name}`,
    pdf: { engine: 'html', template: template('prescription'), bare: true },
  });
}
