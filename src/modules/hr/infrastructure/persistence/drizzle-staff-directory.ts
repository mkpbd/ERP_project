import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  StaffDirectory,
  type StaffSearch,
  type StaffSummary,
} from '../../../../shared/application/contracts/staff-directory.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { designations, hrDepartments, staffRecords } from './hr.schema.js';

@Injectable()
export class DrizzleStaffDirectory extends StaffDirectory {
  constructor(private readonly context: DbContext) {
    super();
  }

  private query(where: SQL | undefined): Promise<StaffSummary[]> {
    return this.context.db
      .select({
        id: staffRecords.id,
        employeeNo: staffRecords.employeeNo,
        fullName: staffRecords.fullName,
        departmentId: staffRecords.departmentId,
        department: hrDepartments.name,
        designation: designations.name,
        joiningDate: staffRecords.joiningDate,
        status: staffRecords.status,
        userId: staffRecords.userId,
      })
      .from(staffRecords)
      .innerJoin(hrDepartments, eq(hrDepartments.id, staffRecords.departmentId))
      .innerJoin(designations, eq(designations.id, staffRecords.designationId))
      .where(where)
      .orderBy(asc(staffRecords.employeeNo));
  }

  async findSummaries(staffIds: readonly string[]): Promise<StaffSummary[]> {
    return staffIds.length === 0 ? [] : this.query(inArray(staffRecords.id, [...staffIds]));
  }

  search(search: StaffSearch): Promise<StaffSummary[]> {
    const pattern = search.q ? `%${escapeLike(search.q)}%` : null;
    return this.query(
      and(
        search.departmentId ? eq(staffRecords.departmentId, search.departmentId) : undefined,
        search.activeOnly ? eq(staffRecords.status, 'active') : undefined,
        pattern ? or(ilike(staffRecords.employeeNo, pattern), ilike(staffRecords.fullName, pattern)) : undefined,
      ),
    );
  }

  async staffIdForUser(userId: string): Promise<string | null> {
    const [row] = await this.context.db
      .select({ id: staffRecords.id })
      .from(staffRecords)
      .where(eq(staffRecords.userId, userId));
    return row?.id ?? null;
  }
}
