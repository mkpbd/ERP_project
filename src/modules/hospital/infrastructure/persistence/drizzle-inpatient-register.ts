import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  InpatientRegister,
  type ChargeableAdmission,
  type WardInpatient,
} from '../../../../shared/application/contracts/inpatient-register.js';
import { HOSPITAL_SETTINGS, type HospitalSettings } from '../../application/patient.handlers.js';
import { admissions, bedCategories, beds, bedStays, ipdBills, patients, wards } from './hospital.schema.js';

/** The hospital's admissions as other modules charge to them. */
@Injectable()
export class DrizzleInpatientRegister extends InpatientRegister {
  constructor(
    private readonly context: DbContext,
    @Inject(HOSPITAL_SETTINGS) private readonly settings: HospitalSettings,
  ) {
    super();
  }

  private select(where: SQL) {
    return this.context.db
      .select({
        id: admissions.id,
        number: admissions.number,
        patientId: admissions.patientId,
        patientName: patients.fullName,
        uhid: patients.uhid,
        admittedOn: sql<string>`to_char(${admissions.admittedAt} at time zone ${this.settings.timeZone}, 'YYYY-MM-DD')`,
        status: admissions.status,
        billed: sql<boolean>`exists (select 1 from ${ipdBills} where ${ipdBills.admissionId} = ${admissions.id} and ${ipdBills.status} = 'billed')`,
      })
      .from(admissions)
      .innerJoin(patients, eq(patients.id, admissions.patientId))
      .where(where);
  }

  async lockForCharge(admissionId: string): Promise<ChargeableAdmission | null> {
    // The same row lock as the final bill and every change to the admission.
    const [locked] = await this.context.db
      .select({ id: admissions.id })
      .from(admissions)
      .where(eq(admissions.id, admissionId))
      .for('update');
    if (!locked) return null;
    const [row] = await this.select(eq(admissions.id, admissionId));
    return row ?? null;
  }

  async find(ids: readonly string[]): Promise<ChargeableAdmission[]> {
    if (ids.length === 0) return [];
    return this.select(inArray(admissions.id, [...ids]));
  }

  async inpatients(): Promise<WardInpatient[]> {
    const rows = await this.context.db
      .select({
        id: admissions.id,
        bedCode: beds.code,
        wardName: wards.name,
        bedCategoryId: bedCategories.id,
        bedCategoryName: bedCategories.name,
      })
      .from(admissions)
      .innerJoin(bedStays, and(eq(bedStays.admissionId, admissions.id), isNull(bedStays.toAt)))
      .innerJoin(beds, eq(beds.id, bedStays.bedId))
      .innerJoin(wards, eq(wards.id, beds.wardId))
      .innerJoin(bedCategories, eq(bedCategories.id, beds.categoryId))
      .where(eq(admissions.status, 'admitted'))
      .orderBy(asc(wards.name), asc(beds.displayOrder), asc(beds.code));
    const found = new Map((await this.find(rows.map((row) => row.id))).map((row) => [row.id, row]));
    return rows.flatMap((row) => {
      const admission = found.get(row.id);
      return admission ? [{ ...admission, ...row }] : [];
    });
  }

  bedCategories(): Promise<{ id: string; name: string }[]> {
    return this.context.db
      .select({ id: bedCategories.id, name: bedCategories.name })
      .from(bedCategories)
      .orderBy(asc(bedCategories.name));
  }
}
