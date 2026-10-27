import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, lte, ne, or, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import type { StoredFile } from '../../../../shared/domain/uploads.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  PatientReadRepository,
  type PatientFilter,
  type PatientSummary,
  type PatientView,
} from '../../application/patient.messages.js';
import { Patient, type IdType } from '../../domain/patient.js';
import { PatientRepository, type MovedRecords, type PatientMatch } from '../../domain/repositories.js';
import {
  admissions,
  appointments,
  corporateClients,
  hospitalSequences,
  ipdBills,
  opdBills,
  patientPhotos,
  patients,
  uhidUses,
} from './hospital.schema.js';

const UHID_KIND = 'uhid';

@Injectable()
export class DrizzlePatientRepository extends PatientRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findForUpdate(id: string): Promise<Patient | null> {
    const [row] = await this.context.db.select().from(patients).where(eq(patients.id, id)).for('update');
    return row ? Patient.restore(row) : null;
  }

  async insert(patient: Patient): Promise<void> {
    await this.context.db.insert(patients).values(patient.toSnapshot());
  }

  async update(patient: Patient): Promise<void> {
    const { id, ...row } = patient.toSnapshot();
    await this.context.db.update(patients).set(row).where(eq(patients.id, id));
  }

  async openAdmission(patientId: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: admissions.id })
      .from(admissions)
      .where(and(eq(admissions.patientId, patientId), eq(admissions.status, 'admitted')));
    return row !== undefined;
  }

  async moveRecords(fromId: string, toId: string): Promise<MovedRecords> {
    const { db } = this.context;
    // One statement at a time: this runs inside the merge's transaction.
    const moved = async (
      table: typeof appointments | typeof opdBills | typeof admissions | typeof ipdBills | typeof uhidUses,
    ) =>
      (await db.update(table).set({ patientId: toId }).where(eq(table.patientId, fromId)).returning({ id: table.id }))
        .length;
    return {
      appointments: await moved(appointments),
      opdBills: await moved(opdBills),
      admissions: await moved(admissions),
      ipdBills: await moved(ipdBills),
      visits: await moved(uhidUses),
    };
  }

  async nextSerial(year: number): Promise<number> {
    const [row] = await this.context.db
      .insert(hospitalSequences)
      .values({ kind: UHID_KIND, year, last: 1 })
      .onConflictDoUpdate({
        target: [hospitalSequences.kind, hospitalSequences.year],
        set: { last: sql`${hospitalSequences.last} + 1` },
      })
      .returning({ last: hospitalSequences.last });
    return row!.last;
  }

  async possibleDuplicates(params: {
    phone: string;
    fullName: string;
    dateOfBirth: string | null;
    excludeId?: string;
  }): Promise<PatientMatch[]> {
    const sameName = sql`lower(${patients.fullName}) = lower(${params.fullName.replace(/\s+/g, ' ').trim()})`;
    return this.context.db
      .select({
        id: patients.id,
        uhid: patients.uhid,
        fullName: patients.fullName,
        dateOfBirth: patients.dateOfBirth,
        mobileNo: patients.mobileNo,
        contactMobileNo: patients.contactMobileNo,
      })
      .from(patients)
      .where(
        and(
          eq(patients.isActive, true),
          or(eq(patients.mobileNo, params.phone), eq(patients.contactMobileNo, params.phone)),
          params.dateOfBirth ? or(sameName, eq(patients.dateOfBirth, params.dateOfBirth)) : sameName,
          params.excludeId ? ne(patients.id, params.excludeId) : undefined,
        ),
      )
      .orderBy(asc(patients.uhid))
      .limit(10);
  }

  async holderOf(idType: IdType, idNo: string, excludeId?: string): Promise<number | null> {
    const [row] = await this.context.db
      .select({ uhid: patients.uhid })
      .from(patients)
      .where(
        and(
          eq(patients.isActive, true),
          eq(patients.idType, idType),
          eq(patients.idNo, idNo),
          excludeId ? ne(patients.id, excludeId) : undefined,
        ),
      )
      .limit(1);
    return row?.uhid ?? null;
  }

  async corporateClientActive(id: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ isActive: corporateClients.isActive })
      .from(corporateClients)
      .where(eq(corporateClients.id, id));
    return row?.isActive ?? false;
  }

  async savePhoto(patientId: string, photo: StoredFile, by: string, now: Date): Promise<void> {
    const values = { contentType: photo.contentType, data: Buffer.from(photo.data), updatedAt: now, updatedBy: by };
    await this.context.db
      .insert(patientPhotos)
      .values({ patientId, ...values })
      .onConflictDoUpdate({ target: patientPhotos.patientId, set: values });
  }

  async removePhoto(patientId: string): Promise<boolean> {
    const removed = await this.context.db
      .delete(patientPhotos)
      .where(eq(patientPhotos.patientId, patientId))
      .returning({ id: patientPhotos.patientId });
    return removed.length > 0;
  }
}

const summaryColumns = {
  id: patients.id,
  uhid: patients.uhid,
  title: patients.title,
  fullName: patients.fullName,
  sex: patients.sex,
  dateOfBirth: patients.dateOfBirth,
  birthEstimated: patients.birthEstimated,
  mobileNo: patients.mobileNo,
  contactMobileNo: patients.contactMobileNo,
  registeredOn: patients.registeredOn,
  confidential: patients.confidential,
  isActive: patients.isActive,
};

@Injectable()
export class DrizzlePatientReadRepository extends PatientReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async list(filter: PatientFilter & { uhid: number | null }): Promise<Page<PatientSummary>> {
    const q = filter.q?.trim();
    const mobile = q?.replace(/[\s-]/g, '').replace(/^\+?880/, '0');
    const search = q
      ? or(
          filter.uhid !== null ? eq(patients.uhid, filter.uhid) : undefined,
          mobile && /^\d{4,11}$/.test(mobile)
            ? or(sql`${patients.mobileNo} like ${`${mobile}%`}`, sql`${patients.contactMobileNo} like ${`${mobile}%`}`)
            : undefined,
          ilike(patients.fullName, `%${escapeLike(q)}%`),
        )
      : undefined;
    const status = filter.status ?? 'active';
    const where = and(
      search,
      filter.from ? gte(patients.registeredOn, filter.from) : undefined,
      filter.to ? lte(patients.registeredOn, filter.to) : undefined,
      status === 'all' ? undefined : eq(patients.isActive, status === 'active'),
    );
    const [rows, [total]] = await Promise.all([
      this.context.db
        .select(summaryColumns)
        .from(patients)
        .where(where)
        // An exact UHID first, then the newest registrations.
        .orderBy(
          ...(filter.uhid !== null ? [desc(sql`${patients.uhid} = ${filter.uhid}`)] : []),
          desc(patients.registeredOn),
          desc(patients.uhid),
        )
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ n: count() }).from(patients).where(where),
    ]);
    return toPage(rows, total?.n ?? 0, filter);
  }

  async get(id: string): Promise<Omit<PatientView, 'districtName'> | null> {
    const [row] = await this.context.db
      .select({
        patient: patients,
        hasPhoto: sql<boolean>`exists (select 1 from ${patientPhotos} where ${patientPhotos.patientId} = ${patients.id})`,
      })
      .from(patients)
      .where(eq(patients.id, id));
    if (!row) return null;
    const { createdAt: _c, updatedAt: _u, ...patient } = row.patient;
    return { ...patient, hasPhoto: row.hasPhoto };
  }

  async idOfUhid(uhid: number): Promise<string | null> {
    const [row] = await this.context.db.select({ id: patients.id }).from(patients).where(eq(patients.uhid, uhid));
    return row?.id ?? null;
  }

  async photo(id: string): Promise<StoredFile | null> {
    const [row] = await this.context.db
      .select({ contentType: patientPhotos.contentType, data: patientPhotos.data })
      .from(patientPhotos)
      .where(eq(patientPhotos.patientId, id));
    return row ? { contentType: row.contentType as StoredFile['contentType'], data: row.data } : null;
  }

  async registered(from: string, to: string) {
    return this.context.db
      .select({ ...summaryColumns, districtId: patients.districtId })
      .from(patients)
      .where(and(gte(patients.registeredOn, from), lte(patients.registeredOn, to)))
      .orderBy(asc(patients.registeredOn), asc(patients.uhid));
  }
}
