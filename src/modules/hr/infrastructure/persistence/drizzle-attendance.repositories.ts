import { Injectable } from '@nestjs/common';
import { and, asc, between, count, desc, eq, gte, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { ConflictError } from '../../../../shared/domain/errors.js';
import { uniqueViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  AttendanceReadRepository,
  type AttendanceFacts,
  type AttendanceScope,
  type ManualAttendanceFilter,
  type ManualAttendanceView,
} from '../../application/attendance.read-models.js';
import { isWeeklyHoliday, ManualAttendance } from '../../domain/attendance.js';
import { AttendanceRepository, type PunchRow } from '../../domain/repositories.js';
import { addDays, zonedInstant } from '../../domain/roster.js';
import { attendancePunches, manualAttendances } from './attendance.schema.js';
import { designations, govtHolidays, hrDepartments, staffRecords } from './hr.schema.js';
import { leaveApplications, leavePolicies, leaveRecords, leaveTypes, staffLeavePolicies } from './leave.schema.js';
import { rosterDuties, staffDaysOff } from './roster.schema.js';

/** `time` columns come back as `HH:mm:ss`. */
const clock = (value: string | null) => (value === null ? null : value.slice(0, 5));

function manualFromRow(row: typeof manualAttendances.$inferSelect): ManualAttendance {
  return ManualAttendance.restore({
    ...row,
    inTime: clock(row.inTime),
    outTime: clock(row.outTime),
  });
}

/** Approved leave (applications and HR-recorded leave) for some people overlapping [from, to]. */
async function approvedLeave(context: DbContext, staffIds: readonly string[], from: string, to: string) {
  const start = sql<string>`coalesce(${leaveApplications.approvedStartDate}, ${leaveApplications.startDate})`;
  const end = sql<string>`coalesce(${leaveApplications.approvedEndDate}, ${leaveApplications.endDate})`;
  const [applications, records] = await Promise.all([
    context.db
      .select({ staffId: leaveApplications.staffId, from: start, to: end, name: leaveTypes.name })
      .from(leaveApplications)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveApplications.leaveTypeId))
      .where(
        and(
          inArray(leaveApplications.staffId, [...staffIds]),
          eq(leaveApplications.status, 'approved'),
          sql`${start} <= ${to}`,
          sql`${end} >= ${from}`,
        ),
      ),
    context.db
      .select({
        staffId: leaveRecords.staffId,
        from: leaveRecords.startDate,
        to: leaveRecords.endDate,
        name: leaveTypes.name,
      })
      .from(leaveRecords)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRecords.leaveTypeId))
      .where(
        and(
          inArray(leaveRecords.staffId, [...staffIds]),
          lte(leaveRecords.startDate, to),
          gte(leaveRecords.endDate, from),
        ),
      ),
  ]);
  return [...applications, ...records];
}

@Injectable()
export class DrizzleAttendanceRepository extends AttendanceRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async staffByBiometric(biometricNos: readonly number[]): Promise<Map<number, string>> {
    if (biometricNos.length === 0) return new Map();
    const rows = await this.context.db
      .select({ id: staffRecords.id, biometricNo: staffRecords.biometricEnrollmentNo })
      .from(staffRecords)
      .where(inArray(staffRecords.biometricEnrollmentNo, [...biometricNos]));
    return new Map(rows.flatMap((row) => (row.biometricNo === null ? [] : [[row.biometricNo, row.id] as const])));
  }

  async insertPunches(rows: readonly PunchRow[], receivedBy: string, now: Date): Promise<number> {
    let inserted = 0;
    // Chunked to stay well under PostgreSQL's parameter limit.
    for (let index = 0; index < rows.length; index += 1000) {
      const result = await this.context.db
        .insert(attendancePunches)
        .values(rows.slice(index, index + 1000).map((row) => ({ ...row, receivedAt: now, receivedBy })))
        .onConflictDoNothing()
        .returning({ id: attendancePunches.id });
      inserted += result.length;
    }
    return inserted;
  }

  async insertManual(entry: ManualAttendance): Promise<void> {
    try {
      await this.context.db.insert(manualAttendances).values(entry.toSnapshot());
    } catch (error) {
      if (uniqueViolationConstraint(error) === 'manual_attendances_live_uq') {
        throw new ConflictError('manual_attendance_exists', 'A manual entry already exists for this person and day');
      }
      throw error;
    }
  }

  async findManualForUpdate(id: string): Promise<ManualAttendance | null> {
    const [row] = await this.context.db
      .select()
      .from(manualAttendances)
      .where(eq(manualAttendances.id, id))
      .for('update');
    return row ? manualFromRow(row) : null;
  }

  async updateManual(entry: ManualAttendance): Promise<void> {
    const { id, createdAt: _createdAt, ...changes } = entry.toSnapshot();
    try {
      await this.context.db.update(manualAttendances).set(changes).where(eq(manualAttendances.id, id));
    } catch (error) {
      if (uniqueViolationConstraint(error) === 'manual_attendances_live_uq') {
        throw new ConflictError('manual_attendance_exists', 'A manual entry already exists for this person and day');
      }
      throw error;
    }
  }

  async manualContext(staffId: string, date: string, excludeId: string | null) {
    const [staff] = await this.context.db
      .select({ status: staffRecords.status, weeklyHoliday: staffRecords.weeklyHoliday })
      .from(staffRecords)
      .where(eq(staffRecords.id, staffId));
    if (!staff) return null;
    const [leave, [other], [dayOff], [duty]] = await Promise.all([
      approvedLeave(this.context, [staffId], date, date),
      this.context.db
        .select({ status: manualAttendances.status })
        .from(manualAttendances)
        .where(
          and(
            eq(manualAttendances.staffId, staffId),
            eq(manualAttendances.attendanceDate, date),
            ne(manualAttendances.status, 'cancelled'),
            excludeId ? ne(manualAttendances.id, excludeId) : undefined,
          ),
        ),
      this.context.db
        .select({ date: staffDaysOff.offDate })
        .from(staffDaysOff)
        .where(and(eq(staffDaysOff.staffId, staffId), eq(staffDaysOff.offDate, date))),
      this.context.db
        .select({ id: rosterDuties.id })
        .from(rosterDuties)
        .where(and(eq(rosterDuties.staffId, staffId), eq(rosterDuties.dutyDate, date)))
        .limit(1),
    ]);
    return {
      staffActive: staff.status === 'active',
      leave: leave[0]?.name ?? null,
      otherEntryStatus: other?.status ?? null,
      isDayOff: dayOff !== undefined || (duty === undefined && isWeeklyHoliday(staff.weeklyHoliday, date)),
    };
  }
}

const manualColumns = {
  id: manualAttendances.id,
  staffId: manualAttendances.staffId,
  employeeNo: staffRecords.employeeNo,
  staffName: staffRecords.fullName,
  departmentName: hrDepartments.name,
  attendanceDate: manualAttendances.attendanceDate,
  inTime: manualAttendances.inTime,
  outTime: manualAttendances.outTime,
  reason: manualAttendances.reason,
  status: manualAttendances.status,
  createdBy: manualAttendances.createdBy,
  submittedBy: manualAttendances.submittedBy,
  submittedAt: manualAttendances.submittedAt,
  decidedBy: manualAttendances.decidedBy,
  decidedAt: manualAttendances.decidedAt,
  decisionRemarks: manualAttendances.decisionRemarks,
  version: manualAttendances.version,
  createdAt: manualAttendances.createdAt,
};

@Injectable()
export class DrizzleAttendanceReadRepository extends AttendanceReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async facts(scope: AttendanceScope, from: string, to: string, timeZone: string): Promise<AttendanceFacts> {
    const year = Number(from.slice(0, 4));
    const grace = sql<number>`coalesce(
      (select ${staffLeavePolicies.lateGraceMinutes} from ${staffLeavePolicies}
        where ${staffLeavePolicies.staffId} = ${staffRecords.id} and ${staffLeavePolicies.year} = ${year}),
      (select ${leavePolicies.lateGraceMinutes} from ${leavePolicies} where ${leavePolicies.year} = ${year}),
      0)::int`;
    const where = scope.staffIds
      ? inArray(staffRecords.id, [...scope.staffIds])
      : and(
          eq(staffRecords.status, 'active'),
          scope.departmentId ? eq(staffRecords.departmentId, scope.departmentId) : undefined,
          scope.subDepartmentId ? eq(staffRecords.subDepartmentId, scope.subDepartmentId) : undefined,
        );
    const staff = await this.context.db
      .select({
        id: staffRecords.id,
        employeeNo: staffRecords.employeeNo,
        fullName: staffRecords.fullName,
        departmentName: hrDepartments.name,
        designationName: designations.name,
        weeklyHoliday: staffRecords.weeklyHoliday,
        biometricNo: staffRecords.biometricEnrollmentNo,
        lateGraceMinutes: grace,
      })
      .from(staffRecords)
      .innerJoin(hrDepartments, eq(hrDepartments.id, staffRecords.departmentId))
      .innerJoin(designations, eq(designations.id, staffRecords.designationId))
      .where(where)
      .orderBy(asc(hrDepartments.name), asc(staffRecords.employeeNo));
    const ids = staff.map((member) => member.id);
    if (ids.length === 0) {
      return { staff: [], duties: [], daysOff: [], holidays: [], leaves: [], punches: [], manual: [] };
    }

    const byBiometric = new Map(
      staff.flatMap((member) => (member.biometricNo === null ? [] : [[member.biometricNo, member.id] as const])),
    );
    // A day's punches can belong to a night shift that started the day before or ends the day after.
    const punchFrom = zonedInstant(addDays(from, -1), '00:00', timeZone);
    const punchTo = zonedInstant(addDays(to, 2), '00:00', timeZone);
    const [duties, daysOff, holidays, leaves, punches, manual] = await Promise.all([
      this.context.db
        .select({
          staffId: rosterDuties.staffId,
          dutyDate: rosterDuties.dutyDate,
          code: rosterDuties.code,
          startAt: rosterDuties.startAt,
          endAt: rosterDuties.endAt,
        })
        .from(rosterDuties)
        .where(and(inArray(rosterDuties.staffId, ids), between(rosterDuties.dutyDate, from, to))),
      this.context.db
        .select({ staffId: staffDaysOff.staffId, date: staffDaysOff.offDate })
        .from(staffDaysOff)
        .where(and(inArray(staffDaysOff.staffId, ids), between(staffDaysOff.offDate, from, to))),
      this.context.db
        .select({ date: govtHolidays.holidayDate, name: govtHolidays.name })
        .from(govtHolidays)
        .where(between(govtHolidays.holidayDate, from, to)),
      approvedLeave(this.context, ids, from, to),
      this.context.db
        .select({
          staffId: attendancePunches.staffId,
          biometricNo: attendancePunches.biometricNo,
          punchedAt: attendancePunches.punchedAt,
        })
        .from(attendancePunches)
        .where(
          and(
            gte(attendancePunches.punchedAt, punchFrom),
            lte(attendancePunches.punchedAt, punchTo),
            or(
              inArray(attendancePunches.staffId, ids),
              byBiometric.size > 0
                ? and(
                    isNull(attendancePunches.staffId),
                    inArray(attendancePunches.biometricNo, [...byBiometric.keys()]),
                  )
                : undefined,
            ),
          ),
        ),
      this.context.db
        .select({
          staffId: manualAttendances.staffId,
          date: manualAttendances.attendanceDate,
          inTime: manualAttendances.inTime,
          outTime: manualAttendances.outTime,
        })
        .from(manualAttendances)
        .where(
          and(
            inArray(manualAttendances.staffId, ids),
            eq(manualAttendances.status, 'approved'),
            between(manualAttendances.attendanceDate, from, to),
          ),
        ),
    ]);
    return {
      staff: staff.map(({ biometricNo: _biometricNo, ...member }) => member),
      duties,
      daysOff,
      holidays,
      leaves,
      punches: punches.flatMap((punch) => {
        const staffId = punch.staffId ?? byBiometric.get(punch.biometricNo);
        return staffId ? [{ staffId, punchedAt: punch.punchedAt }] : [];
      }),
      manual: manual.map((entry) => ({ ...entry, inTime: clock(entry.inTime), outTime: clock(entry.outTime) })),
    };
  }

  async punches(staffId: string, from: Date, to: Date) {
    const [member] = await this.context.db
      .select({ biometricNo: staffRecords.biometricEnrollmentNo })
      .from(staffRecords)
      .where(eq(staffRecords.id, staffId));
    return this.context.db
      .select({ punchedAt: attendancePunches.punchedAt, machineNo: attendancePunches.machineNo })
      .from(attendancePunches)
      .where(
        and(
          gte(attendancePunches.punchedAt, from),
          sql`${attendancePunches.punchedAt} < ${to}`,
          or(
            eq(attendancePunches.staffId, staffId),
            member?.biometricNo != null
              ? and(isNull(attendancePunches.staffId), eq(attendancePunches.biometricNo, member.biometricNo))
              : undefined,
          ),
        ),
      )
      .orderBy(asc(attendancePunches.punchedAt));
  }

  private manualBase() {
    return this.context.db
      .select(manualColumns)
      .from(manualAttendances)
      .innerJoin(staffRecords, eq(staffRecords.id, manualAttendances.staffId))
      .innerJoin(hrDepartments, eq(hrDepartments.id, staffRecords.departmentId))
      .$dynamic();
  }

  async listManual(filter: ManualAttendanceFilter): Promise<Page<ManualAttendanceView>> {
    const where: SQL | undefined = and(
      filter.status ? eq(manualAttendances.status, filter.status) : undefined,
      filter.staffId ? eq(manualAttendances.staffId, filter.staffId) : undefined,
      filter.departmentId ? eq(staffRecords.departmentId, filter.departmentId) : undefined,
      filter.from ? gte(manualAttendances.attendanceDate, filter.from) : undefined,
      filter.to ? lte(manualAttendances.attendanceDate, filter.to) : undefined,
    );
    const [totals] = await this.context.db
      .select({ total: count() })
      .from(manualAttendances)
      .innerJoin(staffRecords, eq(staffRecords.id, manualAttendances.staffId))
      .where(where);
    const rows = await this.manualBase()
      .where(where)
      .orderBy(desc(manualAttendances.attendanceDate), asc(staffRecords.employeeNo))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    return toPage(rows.map(timesOf), totals?.total ?? 0, filter);
  }

  async getManual(id: string): Promise<ManualAttendanceView | null> {
    const [row] = await this.manualBase().where(eq(manualAttendances.id, id));
    return row ? timesOf(row) : null;
  }
}

function timesOf<T extends { inTime: string | null; outTime: string | null }>(row: T): T {
  return { ...row, inTime: clock(row.inTime), outTime: clock(row.outTime) };
}
