import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { PatientDirectory, type PatientSummary } from '../../../../shared/application/contracts/patient-directory.js';
import { patients } from './hospital.schema.js';

/** The registered patients as other modules see them. */
@Injectable()
export class DrizzlePatientDirectory extends PatientDirectory {
  constructor(private readonly context: DbContext) {
    super();
  }

  async find(ids: readonly string[]): Promise<Map<string, PatientSummary>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        id: patients.id,
        uhid: patients.uhid,
        name: patients.fullName,
        sex: patients.sex,
        dateOfBirth: patients.dateOfBirth,
        bloodGroup: patients.bloodGroup,
        isActive: patients.isActive,
      })
      .from(patients)
      .where(inArray(patients.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async contactsByUhid(uhid: number) {
    const [row] = await this.context.db
      .select({
        id: patients.id,
        name: patients.fullName,
        isActive: patients.isActive,
        mobileNo: patients.mobileNo,
        contactMobileNo: patients.contactMobileNo,
        email: patients.email,
      })
      .from(patients)
      .where(eq(patients.uhid, uhid));
    if (!row) return null;
    const mobiles = [row.mobileNo, row.contactMobileNo].filter((value): value is string => !!value);
    return { id: row.id, name: row.name, isActive: row.isActive, mobiles, email: row.email };
  }
}
