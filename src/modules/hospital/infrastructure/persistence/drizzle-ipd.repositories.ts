import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, count, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  AdmissionReadRepository,
  type AdmissionFilter,
  type AdmissionSummary,
  type AdmissionView,
  type BedBoard,
  type BoardBed,
} from '../../application/ipd.messages.js';
import { HOSPITAL_SETTINGS, type HospitalSettings } from '../../application/patient.handlers.js';
import { Admission } from '../../domain/admission.js';
import { AdmissionRepository, type AdmissionBed, type BedStatus } from '../../domain/repositories.js';
import {
  admissionDoctors,
  admissions,
  bedCategories,
  beds,
  bedStays,
  corporateClients,
  doctors,
  patients,
  wards,
} from './hospital.schema.js';

/** A bed's rate: its own, else its category's. */
const bedRate = sql<number>`coalesce(${beds.dailyRate}, ${bedCategories.dailyRate})`.mapWith(Number);

@Injectable()
export class DrizzleAdmissionRepository extends AdmissionRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  findForUpdate(id: string): Promise<Admission | null> {
    return this.load(id, true);
  }

  findById(id: string): Promise<Admission | null> {
    return this.load(id, false);
  }

  private async load(id: string, lock: boolean): Promise<Admission | null> {
    const query = this.context.db.select().from(admissions).where(eq(admissions.id, id));
    const [row] = lock ? await query.for('update') : await query;
    if (!row) return null;
    const [stays, doctorRows] = await Promise.all([
      this.context.db
        .select({
          bedId: bedStays.bedId,
          fromAt: bedStays.fromAt,
          toAt: bedStays.toAt,
          dailyRate: bedStays.dailyRate,
          reason: bedStays.reason,
          movedBy: bedStays.movedBy,
        })
        .from(bedStays)
        .where(eq(bedStays.admissionId, id))
        .orderBy(asc(bedStays.fromAt)),
      this.context.db
        .select({
          doctorId: admissionDoctors.doctorId,
          role: admissionDoctors.role,
          fromAt: admissionDoctors.fromAt,
          toAt: admissionDoctors.toAt,
        })
        .from(admissionDoctors)
        .where(eq(admissionDoctors.admissionId, id))
        .orderBy(asc(admissionDoctors.fromAt)),
    ]);
    return Admission.restore({ ...row, stays, doctors: doctorRows });
  }

  async insert(admission: Admission): Promise<void> {
    const { stays, doctors: doctorRows, ...row } = admission.toSnapshot();
    await this.context.db.insert(admissions).values(row);
    await this.saveChildren(row.id, stays, doctorRows);
  }

  async update(admission: Admission): Promise<void> {
    const { stays, doctors: doctorRows, id, ...row } = admission.toSnapshot();
    await this.context.db.update(admissions).set(row).where(eq(admissions.id, id));
    // Closed rows first, so the "one open row" indexes hold while the open ones go back in.
    await this.context.db.delete(bedStays).where(eq(bedStays.admissionId, id));
    await this.context.db.delete(admissionDoctors).where(eq(admissionDoctors.admissionId, id));
    await this.saveChildren(id, stays, doctorRows);
  }

  private async saveChildren(
    admissionId: string,
    stays: ReturnType<Admission['toSnapshot']>['stays'],
    doctorRows: ReturnType<Admission['toSnapshot']>['doctors'],
  ): Promise<void> {
    if (stays.length > 0) {
      await this.context.db.insert(bedStays).values(stays.map((stay) => ({ ...stay, id: randomUUID(), admissionId })));
    }
    if (doctorRows.length > 0) {
      await this.context.db
        .insert(admissionDoctors)
        .values(doctorRows.map((doctor) => ({ ...doctor, id: randomUUID(), admissionId })));
    }
  }

  async activeOf(patientId: string): Promise<string | null> {
    const [row] = await this.context.db
      .select({ id: admissions.id })
      .from(admissions)
      .where(and(eq(admissions.patientId, patientId), eq(admissions.status, 'admitted')));
    return row?.id ?? null;
  }

  async bedForUpdate(id: string): Promise<AdmissionBed | null> {
    const [row] = await this.context.db
      .select({
        id: beds.id,
        code: beds.code,
        status: beds.status,
        isActive: beds.isActive,
        dailyRate: bedRate,
        admissionFee: bedCategories.admissionFee,
      })
      .from(beds)
      .innerJoin(bedCategories, eq(bedCategories.id, beds.categoryId))
      .where(eq(beds.id, id))
      .for('update', { of: beds });
    return row ?? null;
  }

  async setBedStatus(id: string, status: BedStatus): Promise<void> {
    await this.context.db.update(beds).set({ status, updatedAt: new Date() }).where(eq(beds.id, id));
  }
}

const referrers = aliasedTable(doctors, 'referrers');
const primaries = aliasedTable(doctors, 'primaries');
/** The bed now, or the last one an admission had. */
const lastStay = sql`(select ${bedStays.bedId} from ${bedStays} where ${bedStays.admissionId} = ${admissions.id} order by ${bedStays.fromAt} desc limit 1)`;
/** The consultant now, or the last one. */
const lastPrimary = sql`(select ${admissionDoctors.doctorId} from ${admissionDoctors} where ${admissionDoctors.admissionId} = ${admissions.id} and ${admissionDoctors.role} = 'primary' order by ${admissionDoctors.fromAt} desc limit 1)`;

@Injectable()
export class DrizzleAdmissionReadRepository extends AdmissionReadRepository {
  constructor(
    private readonly context: DbContext,
    @Inject(HOSPITAL_SETTINGS) private readonly settings: HospitalSettings,
  ) {
    super();
  }

  private summaries() {
    return this.context.db
      .select({
        id: admissions.id,
        number: admissions.number,
        patientId: admissions.patientId,
        uhid: patients.uhid,
        patientName: patients.fullName,
        admittedAt: admissions.admittedAt,
        kind: admissions.kind,
        status: admissions.status,
        dischargedAt: admissions.dischargedAt,
        dischargeType: admissions.dischargeType,
        bedCode: beds.code,
        wardName: wards.name,
        doctorName: primaries.name,
        version: admissions.version,
      })
      .from(admissions)
      .innerJoin(patients, eq(patients.id, admissions.patientId))
      .leftJoin(beds, eq(beds.id, lastStay))
      .leftJoin(wards, eq(wards.id, beds.wardId))
      .leftJoin(primaries, eq(primaries.id, lastPrimary));
  }

  async list(filter: AdmissionFilter): Promise<Page<AdmissionSummary>> {
    const q = filter.q?.trim();
    const where = and(
      q
        ? or(
            /^d{1,15}$/.test(q) ? eq(patients.uhid, Number(q)) : undefined,
            ilike(admissions.number, `%${escapeLike(q)}%`),
            ilike(patients.fullName, `%${escapeLike(q)}%`),
          )
        : undefined,
      filter.status ? eq(admissions.status, filter.status) : undefined,
      filter.patientId ? eq(admissions.patientId, filter.patientId) : undefined,
      filter.doctorId
        ? sql`exists (select 1 from ${admissionDoctors} where ${admissionDoctors.admissionId} = ${admissions.id} and ${admissionDoctors.doctorId} = ${filter.doctorId})`
        : undefined,
      filter.wardId ? eq(beds.wardId, filter.wardId) : undefined,
      // Days of the organisation's time zone.
      filter.from
        ? sql`(${admissions.admittedAt} at time zone ${this.settings.timeZone})::date >= ${filter.from}`
        : undefined,
      filter.to
        ? sql`(${admissions.admittedAt} at time zone ${this.settings.timeZone})::date <= ${filter.to}`
        : undefined,
    );
    const [rows, [total]] = await Promise.all([
      this.summaries()
        .where(where)
        .orderBy(desc(admissions.admittedAt))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db
        .select({ n: count() })
        .from(admissions)
        .innerJoin(patients, eq(patients.id, admissions.patientId))
        .leftJoin(beds, eq(beds.id, lastStay))
        .where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async get(id: string): Promise<AdmissionView | null> {
    const [header] = await this.context.db
      .select({
        id: admissions.id,
        number: admissions.number,
        patientId: admissions.patientId,
        uhid: patients.uhid,
        patientName: patients.fullName,
        sex: patients.sex,
        dateOfBirth: patients.dateOfBirth,
        mobileNo: sql<string | null>`coalesce(${patients.mobileNo}, ${patients.contactMobileNo})`,
        admittedAt: admissions.admittedAt,
        kind: admissions.kind,
        reason: admissions.reason,
        status: admissions.status,
        dischargedAt: admissions.dischargedAt,
        dischargeType: admissions.dischargeType,
        dischargeNote: admissions.dischargeNote,
        cancelReason: admissions.cancelReason,
        referredById: admissions.referredById,
        referredByName: referrers.name,
        corporateClientId: admissions.corporateClientId,
        corporateClientName: corporateClients.name,
        staffId: admissions.staffId,
        admissionFee: admissions.admissionFee,
        admittedBy: admissions.admittedBy,
        closedBy: admissions.closedBy,
        bedCode: beds.code,
        wardName: wards.name,
        doctorName: primaries.name,
        version: admissions.version,
      })
      .from(admissions)
      .innerJoin(patients, eq(patients.id, admissions.patientId))
      .leftJoin(referrers, eq(referrers.id, admissions.referredById))
      .leftJoin(corporateClients, eq(corporateClients.id, admissions.corporateClientId))
      .leftJoin(beds, eq(beds.id, lastStay))
      .leftJoin(wards, eq(wards.id, beds.wardId))
      .leftJoin(primaries, eq(primaries.id, lastPrimary))
      .where(eq(admissions.id, id));
    if (!header) return null;
    const [stays, doctorRows] = await Promise.all([
      this.context.db
        .select({
          bedId: bedStays.bedId,
          bedCode: beds.code,
          wardName: wards.name,
          categoryName: bedCategories.name,
          fromAt: bedStays.fromAt,
          toAt: bedStays.toAt,
          dailyRate: bedStays.dailyRate,
          reason: bedStays.reason,
        })
        .from(bedStays)
        .innerJoin(beds, eq(beds.id, bedStays.bedId))
        .innerJoin(wards, eq(wards.id, beds.wardId))
        .innerJoin(bedCategories, eq(bedCategories.id, beds.categoryId))
        .where(eq(bedStays.admissionId, id))
        .orderBy(asc(bedStays.fromAt)),
      this.context.db
        .select({
          doctorId: admissionDoctors.doctorId,
          doctorName: doctors.name,
          role: admissionDoctors.role,
          fromAt: admissionDoctors.fromAt,
          toAt: admissionDoctors.toAt,
        })
        .from(admissionDoctors)
        .innerJoin(doctors, eq(doctors.id, admissionDoctors.doctorId))
        .where(eq(admissionDoctors.admissionId, id))
        .orderBy(asc(admissionDoctors.fromAt)),
    ]);
    return { ...header, stays, doctors: doctorRows };
  }

  async board(wardId?: string): Promise<BedBoard> {
    const rows = await this.context.db
      .select({
        wardId: wards.id,
        wardName: wards.name,
        floor: wards.floor,
        id: beds.id,
        code: beds.code,
        categoryName: bedCategories.name,
        isIntensive: bedCategories.isIntensive,
        status: beds.status,
        dailyRate: bedRate,
      })
      .from(beds)
      .innerJoin(wards, eq(wards.id, beds.wardId))
      .innerJoin(bedCategories, eq(bedCategories.id, beds.categoryId))
      .where(and(eq(beds.isActive, true), eq(wards.isActive, true), wardId ? eq(wards.id, wardId) : undefined))
      .orderBy(asc(wards.name), asc(beds.displayOrder), asc(beds.code));
    const ids = rows.map((row) => row.id);
    const occupants = ids.length
      ? await this.context.db
          .select({
            bedId: bedStays.bedId,
            since: bedStays.fromAt,
            id: admissions.id,
            number: admissions.number,
            patientName: patients.fullName,
            uhid: patients.uhid,
            doctorName: primaries.name,
          })
          .from(bedStays)
          .innerJoin(admissions, eq(admissions.id, bedStays.admissionId))
          .innerJoin(patients, eq(patients.id, admissions.patientId))
          .leftJoin(primaries, eq(primaries.id, lastPrimary))
          .where(and(inArray(bedStays.bedId, ids), isNull(bedStays.toAt)))
      : [];
    const byBed = new Map(occupants.map(({ bedId, ...admission }) => [bedId, admission]));
    const counts: Record<BedStatus, number> = { available: 0, occupied: 0, housekeeping: 0, out_of_order: 0 };
    const board = new Map<string, BedBoard['wards'][number]>();
    for (const row of rows) {
      counts[row.status] += 1;
      const ward = board.get(row.wardId) ?? {
        id: row.wardId,
        name: row.wardName,
        floor: row.floor,
        beds: [] as BoardBed[],
      };
      board.set(row.wardId, ward);
      ward.beds.push({
        id: row.id,
        code: row.code,
        categoryName: row.categoryName,
        isIntensive: row.isIntensive,
        status: row.status,
        dailyRate: row.dailyRate,
        admission: byBed.get(row.id) ?? null,
      });
    }
    return { wards: [...board.values()], counts };
  }
}
