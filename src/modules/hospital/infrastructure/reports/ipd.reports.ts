import { fileURLToPath } from 'node:url';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { OrganizationProfile } from '../../../../shared/application/contracts/organization-profile.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import type { AdmissionReadRepository } from '../../application/ipd.messages.js';
import { localToday } from '../../application/patient.handlers.js';
import { ageOn, uhidLabel } from '../../domain/patient.js';
import { admissions, bedCategories, beds, bedStays } from '../persistence/hospital.schema.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
const DISCHARGE_LABELS = {
  normal: 'Normal',
  lama: 'Left against medical advice',
  referred: 'Referred',
  absconded: 'Absconded',
  death: 'Death',
} as const;
const STATUS_LABELS = { admitted: 'Admitted', discharged: 'Discharged', cancelled: 'Cancelled' } as const;

function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
}

function addDays(isoDay: string, days: number): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/**
 * Old PrintIPDPatientAdmissionDocument ("Patient's Information On Admission", with the only consent text the old
 * system had): the admission form the patient or guardian signs.
 */
export function admissionFormReport(
  read: AdmissionReadRepository,
  organization: OrganizationProfile,
): ReportDefinition {
  return defineReport({
    key: 'hospital.admission-form',
    title: 'Admission form',
    group: 'Hospital',
    description: 'The admission form: patient, bed, consultant, referring doctor, payer and the consent to sign.',
    params: z.strictObject({ id: z.uuid() }),
    async load(params, report) {
      const admission = await read.get(params.id);
      if (!admission) throw new NotFoundError('admission');
      const today = localToday(report.generatedAt, report.timeZone);
      const age = ageOn(admission.dateOfBirth, today);
      const first = admission.stays[0];
      return {
        admission: {
          ...admission,
          uhidLabel: uhidLabel(await organization.patientIdPrefix(), admission.uhid),
          age: age.years > 0 ? `${age.years} years` : `${age.months} months ${age.days} days`,
          firstBed: first ? `${first.bedCode} (${first.wardName}, ${first.categoryName})` : null,
          consultant: admission.doctors.find((doctor) => doctor.role === 'primary')?.doctorName ?? null,
          additional: admission.doctors
            .filter((doctor) => doctor.role === 'additional')
            .map((doctor) => doctor.doctorName)
            .join(', '),
        },
        organization: report.header.organizationName,
      };
    },
    describe: (_params, data) => `${data.admission.number} · ${data.admission.patientName}`,
    pdf: { engine: 'html', template: template('admission-form') },
  });
}

/** Old patient list dashboard (VWHospitalPatientDetails): who is in which bed now, since when, under whom. */
export function inpatientCensusReport(read: AdmissionReadRepository): ReportDefinition {
  return defineReport({
    key: 'hospital.inpatient-census',
    title: 'Inpatient census',
    group: 'Hospital',
    description: 'Every bed by ward now: who is in it, since when, nights so far and the consultant; bed counts.',
    params: z.strictObject({ wardId: z.uuid().optional() }),
    async load(params, report) {
      const board = await read.board(params.wardId);
      const today = localToday(report.generatedAt, report.timeZone);
      return {
        counts: board.counts,
        wards: board.wards.map((ward) => ({
          ...ward,
          beds: ward.beds.map((bed) => ({
            ...bed,
            state: bed.status.replace('_', ' '),
            nights: bed.admission ? daysBetween(localToday(bed.admission.since, report.timeZone), today) : null,
          })),
          occupied: ward.beds.filter((bed) => bed.status === 'occupied').length,
        })),
      };
    },
    describe: (_params, data) =>
      `${data.counts.occupied} occupied · ${data.counts.available} free · ${data.counts.housekeeping} in housekeeping`,
    pdf: { engine: 'html', template: template('inpatient-census'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'ward', header: 'Ward', width: 18 },
        { key: 'code', header: 'Bed', width: 10 },
        { key: 'categoryName', header: 'Category', width: 16 },
        { key: 'state', header: 'Status', width: 14 },
        { key: 'number', header: 'Admission', width: 16 },
        { key: 'patientName', header: 'Patient', width: 26 },
        { key: 'nights', header: 'Nights', format: 'integer' },
        { key: 'doctorName', header: 'Consultant', width: 24 },
      ],
      rows: data.wards.flatMap((ward) =>
        ward.beds.map((bed) => ({
          ward: ward.name,
          code: bed.code,
          categoryName: bed.categoryName,
          state: bed.state,
          number: bed.admission?.number ?? null,
          patientName: bed.admission?.patientName ?? null,
          nights: bed.nights,
          doctorName: bed.admission?.doctorName ?? null,
        })),
      ),
    }),
  });
}

/** Old AdmittedAndDischargedPatientList / ConsultantWisePatientList: admissions and discharges over a period. */
export function admissionRegisterReport(read: AdmissionReadRepository): ReportDefinition {
  return defineReport({
    key: 'hospital.admission-register',
    title: 'Admission and discharge register',
    group: 'Hospital',
    description: 'Admissions over a period with their bed, consultant, discharge and how the stay ended.',
    params: z.strictObject({ from: day, to: day, doctorId: z.uuid().optional() }),
    async load(params, report) {
      assertPeriod(params.from, params.to);
      const page = await read.list({
        from: params.from,
        to: params.to,
        doctorId: params.doctorId,
        page: 1,
        pageSize: 5000,
      });
      const rows = page.items
        .map((row) => ({
          ...row,
          state: STATUS_LABELS[row.status],
          how: row.dischargeType ? DISCHARGE_LABELS[row.dischargeType] : null,
          nights: daysBetween(
            localToday(row.admittedAt, report.timeZone),
            localToday(row.dischargedAt ?? report.generatedAt, report.timeZone),
          ),
        }))
        .reverse();
      return {
        rows,
        admitted: rows.filter((row) => row.status === 'admitted').length,
        discharged: rows.filter((row) => row.status === 'discharged').length,
        cancelled: rows.filter((row) => row.status === 'cancelled').length,
      };
    },
    describe: (params, data) => `${params.from} to ${params.to} · ${data.rows.length} admissions`,
    pdf: { engine: 'html', template: template('admission-register'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'number', header: 'Admission', width: 16 },
        { key: 'admittedAt', header: 'Admitted', format: 'datetime' },
        { key: 'uhid', header: 'UHID', format: 'integer' },
        { key: 'patientName', header: 'Patient', width: 26 },
        { key: 'bedCode', header: 'Bed', width: 10 },
        { key: 'wardName', header: 'Ward', width: 16 },
        { key: 'doctorName', header: 'Consultant', width: 24 },
        { key: 'dischargedAt', header: 'Discharged', format: 'datetime' },
        { key: 'how', header: 'How', width: 18 },
        { key: 'nights', header: 'Nights', format: 'integer' },
        { key: 'state', header: 'Status', width: 12 },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}

/**
 * Old HospitalBedCabinAvgIncomeSummary / BedUtilizationStatement (fixed in 2026-08 to count nights): per bed category
 * over a period, the beds, the bed-nights there were and those used. A stay uses the nights from the day it began to
 * the day it ended (the last day is not a night; a same-day stay uses none), as the old bills counted them.
 */
export function bedOccupancyReport(context: DbContext): ReportDefinition {
  return defineReport({
    key: 'hospital.bed-occupancy',
    title: 'Bed occupancy',
    group: 'Hospital',
    description: 'Per bed category over a period: beds, bed-nights, nights used and the occupancy rate.',
    params: z.strictObject({ from: day, to: day }),
    async load(params, report) {
      assertPeriod(params.from, params.to);
      const days = daysBetween(params.from, params.to) + 1;
      const end = addDays(params.to, 1);
      const zone = report.timeZone;
      const categories = await context.db
        .select({
          id: bedCategories.id,
          name: bedCategories.name,
          beds: sql<number>`count(${beds.id}) filter (where ${beds.isActive})`.mapWith(Number),
        })
        .from(bedCategories)
        .leftJoin(beds, eq(beds.categoryId, bedCategories.id))
        .groupBy(bedCategories.id, bedCategories.name)
        .orderBy(asc(bedCategories.name));
      const stays = await context.db
        .select({
          categoryId: beds.categoryId,
          fromDay: sql<string>`((${bedStays.fromAt} at time zone ${zone})::date)::text`,
          toDay: sql<string | null>`((${bedStays.toAt} at time zone ${zone})::date)::text`,
        })
        .from(bedStays)
        .innerJoin(beds, eq(beds.id, bedStays.bedId))
        .innerJoin(admissions, eq(admissions.id, bedStays.admissionId))
        .where(
          and(
            sql`${admissions.status} <> 'cancelled'`,
            sql`(${bedStays.fromAt} at time zone ${zone})::date < ${end}`,
            or(sql`${bedStays.toAt} is null`, sql`(${bedStays.toAt} at time zone ${zone})::date > ${params.from}`),
          ),
        );
      const today = localToday(report.generatedAt, zone);
      const used = new Map<string, number>();
      for (const stay of stays) {
        // Nights of [fromDay, toDay) within [from, to + 1); an open stay runs to today.
        const start = stay.fromDay > params.from ? stay.fromDay : params.from;
        const stop = [stay.toDay ?? today, end].sort()[0]!;
        const nights = Math.max(0, daysBetween(start, stop));
        used.set(stay.categoryId, (used.get(stay.categoryId) ?? 0) + nights);
      }
      const rows = categories.map((category) => {
        const available = category.beds * days;
        const nights = used.get(category.id) ?? 0;
        return {
          name: category.name,
          beds: category.beds,
          available,
          used: nights,
          rate: available === 0 ? null : Math.round((nights / available) * 10_000) / 100,
        };
      });
      const available = rows.reduce((total, row) => total + row.available, 0);
      const usedTotal = rows.reduce((total, row) => total + row.used, 0);
      return {
        days,
        rows,
        beds: rows.reduce((total, row) => total + row.beds, 0),
        available,
        used: usedTotal,
        rate: available === 0 ? null : Math.round((usedTotal / available) * 10_000) / 100,
      };
    },
    describe: (params, data) => `${params.from} to ${params.to} · ${data.days} days`,
    pdf: { engine: 'html', template: template('bed-occupancy') },
    xlsx: (data) => ({
      columns: [
        { key: 'name', header: 'Category', width: 22 },
        { key: 'beds', header: 'Beds', format: 'integer' },
        { key: 'available', header: 'Bed-nights', format: 'integer' },
        { key: 'used', header: 'Nights used', format: 'integer' },
        { key: 'rate', header: 'Occupancy %', format: 'decimal' },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}
