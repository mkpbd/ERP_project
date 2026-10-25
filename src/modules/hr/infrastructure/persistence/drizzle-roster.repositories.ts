import { Injectable } from '@nestjs/common';
import { and, asc, between, eq, inArray, or, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RosterStaffView } from '../../application/roster.messages.js';
import { RosterReadRepository } from '../../application/roster.read-models.js';
import { RosterRepository, type DayOff, type RosterWrites } from '../../domain/repositories.js';
import type { Duty, ShiftType, StaffPlacement } from '../../domain/roster.js';
import { designations, govtHolidays, staffRecords } from './hr.schema.js';
import { rosterDuties, shiftTypes, staffDaysOff } from './roster.schema.js';

/** `time` columns come back as `HH:mm:ss`; the domain speaks `HH:mm`. */
const clock = (value: string) => value.slice(0, 5);

@Injectable()
export class DrizzleRosterRepository extends RosterRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async shiftTypes(departmentId: string): Promise<ShiftType[]> {
    const rows = await this.context.db
      .select({
        id: shiftTypes.id,
        departmentId: shiftTypes.departmentId,
        code: shiftTypes.code,
        startTime: shiftTypes.startTime,
        endTime: shiftTypes.endTime,
      })
      .from(shiftTypes)
      .where(eq(shiftTypes.departmentId, departmentId));
    return rows.map((row) => ({ ...row, startTime: clock(row.startTime), endTime: clock(row.endTime) }));
  }

  async placements(staffIds: readonly string[]): Promise<Map<string, StaffPlacement>> {
    if (staffIds.length === 0) return new Map();
    const rows = await this.context.db
      .select({
        id: staffRecords.id,
        status: staffRecords.status,
        departmentId: staffRecords.departmentId,
        subDepartmentId: staffRecords.subDepartmentId,
      })
      .from(staffRecords)
      .where(inArray(staffRecords.id, [...staffIds]));
    return new Map(
      rows.map((row) => [
        row.id,
        { active: row.status === 'active', departmentId: row.departmentId, subDepartmentId: row.subDepartmentId },
      ]),
    );
  }

  async duties(staffIds: readonly string[], from: string, to: string): Promise<Duty[]> {
    if (staffIds.length === 0) return [];
    return this.context.db
      .select({
        id: rosterDuties.id,
        staffId: rosterDuties.staffId,
        dutyDate: rosterDuties.dutyDate,
        shiftTypeId: rosterDuties.shiftTypeId,
        code: rosterDuties.code,
        startAt: rosterDuties.startAt,
        endAt: rosterDuties.endAt,
        remarks: rosterDuties.remarks,
      })
      .from(rosterDuties)
      .where(and(inArray(rosterDuties.staffId, [...staffIds]), between(rosterDuties.dutyDate, from, to)));
  }

  async daysOff(staffIds: readonly string[], from: string, to: string): Promise<DayOff[]> {
    if (staffIds.length === 0) return [];
    return this.context.db
      .select({ staffId: staffDaysOff.staffId, date: staffDaysOff.offDate, remarks: staffDaysOff.remarks })
      .from(staffDaysOff)
      .where(and(inArray(staffDaysOff.staffId, [...staffIds]), between(staffDaysOff.offDate, from, to)));
  }

  async apply(writes: RosterWrites, actorUserId: string, now: Date): Promise<void> {
    const db = this.context.db;
    if (writes.deletes.length > 0) await db.delete(rosterDuties).where(inArray(rosterDuties.id, [...writes.deletes]));
    for (const update of writes.remarkUpdates) {
      await db
        .update(rosterDuties)
        .set({ remarks: update.remarks, updatedAt: now })
        .where(eq(rosterDuties.id, update.id));
    }
    if (writes.inserts.length > 0) {
      await db
        .insert(rosterDuties)
        .values(writes.inserts.map((duty) => ({ ...duty, createdBy: actorUserId, createdAt: now, updatedAt: now })));
    }
    if (writes.daysOffCleared.length > 0) {
      await db
        .delete(staffDaysOff)
        .where(
          or(
            ...writes.daysOffCleared.map((off) =>
              and(eq(staffDaysOff.staffId, off.staffId), eq(staffDaysOff.offDate, off.date)),
            ),
          ),
        );
    }
    for (const off of writes.daysOffSet) {
      await db
        .insert(staffDaysOff)
        .values({
          staffId: off.staffId,
          offDate: off.date,
          remarks: off.remarks,
          createdBy: actorUserId,
          createdAt: now,
        })
        .onConflictDoUpdate({ target: [staffDaysOff.staffId, staffDaysOff.offDate], set: { remarks: off.remarks } });
    }
  }
}

@Injectable()
export class DrizzleRosterReadRepository extends RosterReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async staff(departmentId: string, subDepartmentId: string, from: string, to: string): Promise<RosterStaffView[]> {
    const inScope = and(
      eq(staffRecords.departmentId, departmentId),
      eq(staffRecords.subDepartmentId, subDepartmentId),
      eq(staffRecords.status, 'active'),
    );
    const hasDutiesHere = sql`exists (select 1 from ${rosterDuties}
      where ${rosterDuties.staffId} = ${staffRecords.id}
        and ${rosterDuties.departmentId} = ${departmentId}
        and ${rosterDuties.subDepartmentId} = ${subDepartmentId}
        and ${rosterDuties.dutyDate} between ${from} and ${to})`;
    return this.context.db
      .select({
        id: staffRecords.id,
        employeeNo: staffRecords.employeeNo,
        fullName: staffRecords.fullName,
        designationName: designations.name,
        inScope: sql<boolean>`coalesce(${inScope}, false)`,
      })
      .from(staffRecords)
      .innerJoin(designations, eq(designations.id, staffRecords.designationId))
      .where(or(inScope, hasDutiesHere))
      .orderBy(asc(staffRecords.employeeNo));
  }

  async shiftTypes(departmentId: string) {
    const rows = await this.context.db
      .select({
        id: shiftTypes.id,
        code: shiftTypes.code,
        name: shiftTypes.name,
        startTime: shiftTypes.startTime,
        endTime: shiftTypes.endTime,
      })
      .from(shiftTypes)
      .where(eq(shiftTypes.departmentId, departmentId))
      .orderBy(asc(shiftTypes.startTime));
    return rows.map((row) => ({ ...row, startTime: clock(row.startTime), endTime: clock(row.endTime) }));
  }

  govtHolidays(from: string, to: string): Promise<Array<{ date: string; name: string }>> {
    return this.context.db
      .select({ date: govtHolidays.holidayDate, name: govtHolidays.name })
      .from(govtHolidays)
      .where(between(govtHolidays.holidayDate, from, to))
      .orderBy(asc(govtHolidays.holidayDate));
  }
}
