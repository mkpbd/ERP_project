import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  StaffDirectory,
  type StaffSearch,
  type StaffSummary,
} from '../../../../shared/application/contracts/staff-directory.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { designations, festivals, hrDepartments, staffFestivals, staffRecords } from './hr.schema.js';
import { leaveApplications, leaveRecords } from './leave.schema.js';

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
        sex: staffRecords.sex,
        userId: staffRecords.userId,
        paymentMode: staffRecords.paymentMode,
        bankAccountNo: staffRecords.bankAccountNo,
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

  async festivalName(festivalId: string): Promise<string | null> {
    const [row] = await this.context.db
      .select({ name: festivals.name })
      .from(festivals)
      .where(eq(festivals.id, festivalId));
    return row?.name ?? null;
  }

  async festivalObservers(festivalId: string): Promise<string[]> {
    const rows = await this.context.db
      .select({ staffId: staffFestivals.staffId })
      .from(staffFestivals)
      .where(eq(staffFestivals.festivalId, festivalId));
    return rows.map((row) => row.staffId);
  }

  async leaveDaysTaken(year: number, staffIds: readonly string[]): Promise<Map<string, number>> {
    if (staffIds.length === 0) return new Map();
    const ids = [...staffIds];
    const [applications, records] = await Promise.all([
      this.context.db
        .select({
          staffId: leaveApplications.staffId,
          days: sql<number>`sum(coalesce(${leaveApplications.approvedDays}, ${leaveApplications.days}))::int`,
        })
        .from(leaveApplications)
        .where(
          and(
            inArray(leaveApplications.staffId, ids),
            eq(leaveApplications.status, 'approved'),
            sql`extract(year from ${leaveApplications.startDate}) = ${year}`,
          ),
        )
        .groupBy(leaveApplications.staffId),
      this.context.db
        .select({ staffId: leaveRecords.staffId, days: sql<number>`sum(${leaveRecords.days})::int` })
        .from(leaveRecords)
        .where(and(inArray(leaveRecords.staffId, ids), sql`extract(year from ${leaveRecords.startDate}) = ${year}`))
        .groupBy(leaveRecords.staffId),
    ]);
    const taken = new Map<string, number>();
    for (const row of [...applications, ...records]) taken.set(row.staffId, (taken.get(row.staffId) ?? 0) + row.days);
    return taken;
  }
}
