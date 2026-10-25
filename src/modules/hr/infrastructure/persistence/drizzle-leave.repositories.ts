import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, gte, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { foreignKeyViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  LeaveApplication,
  type ApprovalLevel,
  type LeaveApplicationProps,
  type LeavePolicyTerms,
} from '../../domain/leave.js';
import { LeavePolicyRepository, LeaveRepository, StaffFacts } from '../../domain/repositories.js';
import { staffRecords } from './hr.schema.js';
import {
  leaveApplicationApprovals,
  leaveApplications,
  leaveApprovalLevels,
  leaveDelegates,
  leavePolicies,
  leavePolicyEntitlements,
  leaveRecords,
  leaveTypes,
  staffLeaveEntitlements,
  staffLeavePolicies,
} from './leave.schema.js';

const ACTIVE = ['pending', 'approved'] as const;
const inYear = (column: typeof leaveApplications.startDate | typeof leaveRecords.startDate, year: number) =>
  sql`extract(year from ${column}) = ${year}`;

@Injectable()
export class DrizzleLeaveRepository extends LeaveRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insert(application: LeaveApplication): Promise<void> {
    await this.context.db.insert(leaveApplications).values(application.toSnapshot());
  }

  async findForUpdate(id: string): Promise<LeaveApplication | null> {
    const [row] = await this.context.db
      .select()
      .from(leaveApplications)
      .where(eq(leaveApplications.id, id))
      .for('update');
    return row ? LeaveApplication.restore(row as LeaveApplicationProps) : null;
  }

  async update(application: LeaveApplication): Promise<void> {
    const { id, ...changes } = application.toSnapshot();
    await this.context.db.update(leaveApplications).set(changes).where(eq(leaveApplications.id, id));
    const approvals = application.pullNewApprovals();
    if (approvals.length > 0) {
      await this.context.db
        .insert(leaveApplicationApprovals)
        .values(approvals.map((approval) => ({ id: randomUUID(), applicationId: id, ...approval })));
    }
  }

  async overlaps(staffId: string, startDate: string, endDate: string): Promise<boolean> {
    const [application] = await this.context.db
      .select({ id: leaveApplications.id })
      .from(leaveApplications)
      .where(
        and(
          eq(leaveApplications.staffId, staffId),
          inArray(leaveApplications.status, [...ACTIVE]),
          sql`coalesce(${leaveApplications.approvedStartDate}, ${leaveApplications.startDate}) <= ${endDate}`,
          sql`coalesce(${leaveApplications.approvedEndDate}, ${leaveApplications.endDate}) >= ${startDate}`,
        ),
      )
      .limit(1);
    if (application) return true;
    const [record] = await this.context.db
      .select({ id: leaveRecords.id })
      .from(leaveRecords)
      .where(
        and(
          eq(leaveRecords.staffId, staffId),
          lte(leaveRecords.startDate, endDate),
          gte(leaveRecords.endDate, startDate),
        ),
      )
      .limit(1);
    return record !== undefined;
  }

  async usage(staffId: string, year: number, leaveTypeId: string): Promise<{ taken: number; pending: number }> {
    const [applications] = await this.context.db
      .select({
        taken: sql<number>`coalesce(sum(${leaveApplications.approvedDays}) filter (where ${leaveApplications.status} = 'approved'), 0)::int`,
        pending: sql<number>`coalesce(sum(coalesce(${leaveApplications.approvedDays}, ${leaveApplications.days})) filter (where ${leaveApplications.status} = 'pending'), 0)::int`,
      })
      .from(leaveApplications)
      .where(
        and(
          eq(leaveApplications.staffId, staffId),
          eq(leaveApplications.leaveTypeId, leaveTypeId),
          inYear(leaveApplications.startDate, year),
        ),
      );
    const [records] = await this.context.db
      .select({ days: sql<number>`coalesce(sum(${leaveRecords.days}), 0)::int` })
      .from(leaveRecords)
      .where(
        and(
          eq(leaveRecords.staffId, staffId),
          eq(leaveRecords.leaveTypeId, leaveTypeId),
          inYear(leaveRecords.startDate, year),
        ),
      );
    return { taken: (applications?.taken ?? 0) + (records?.days ?? 0), pending: applications?.pending ?? 0 };
  }

  approvalLevels(departmentId: string): Promise<ApprovalLevel[]> {
    return this.context.db
      .select({
        levelOrder: leaveApprovalLevels.levelOrder,
        name: leaveApprovalLevels.name,
        approverStaffId: leaveApprovalLevels.approverStaffId,
      })
      .from(leaveApprovalLevels)
      .where(eq(leaveApprovalLevels.departmentId, departmentId))
      .orderBy(asc(leaveApprovalLevels.levelOrder));
  }

  async leaveTypeExists(id: string): Promise<boolean> {
    const [row] = await this.context.db.select({ id: leaveTypes.id }).from(leaveTypes).where(eq(leaveTypes.id, id));
    return row !== undefined;
  }
}

@Injectable()
export class DrizzleLeavePolicyRepository extends LeavePolicyRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async effectiveTerms(staffId: string, year: number): Promise<LeavePolicyTerms | null> {
    const [own] = await this.context.db
      .select()
      .from(staffLeavePolicies)
      .where(and(eq(staffLeavePolicies.staffId, staffId), eq(staffLeavePolicies.year, year)));
    if (own) {
      const entitlements = await this.context.db
        .select({ leaveTypeId: staffLeaveEntitlements.leaveTypeId, days: staffLeaveEntitlements.days })
        .from(staffLeaveEntitlements)
        .where(and(eq(staffLeaveEntitlements.staffId, staffId), eq(staffLeaveEntitlements.year, year)));
      return { ...terms(own), entitlements };
    }
    const [yearly] = await this.context.db.select().from(leavePolicies).where(eq(leavePolicies.year, year));
    if (!yearly) return null;
    const entitlements = await this.context.db
      .select({ leaveTypeId: leavePolicyEntitlements.leaveTypeId, days: leavePolicyEntitlements.days })
      .from(leavePolicyEntitlements)
      .where(eq(leavePolicyEntitlements.year, year));
    return { ...terms(yearly), entitlements };
  }

  async saveYearly(year: number, policy: LeavePolicyTerms, updatedBy: string, now: Date): Promise<void> {
    const row = { ...terms(policy), updatedAt: now, updatedBy };
    await this.context.db
      .insert(leavePolicies)
      .values({ year, ...row })
      .onConflictDoUpdate({ target: leavePolicies.year, set: row });
    await this.context.db.delete(leavePolicyEntitlements).where(eq(leavePolicyEntitlements.year, year));
    if (policy.entitlements.length > 0) {
      await this.context.db
        .insert(leavePolicyEntitlements)
        .values(policy.entitlements.map((entry) => ({ year, ...entry })));
    }
  }

  async deleteYearly(year: number): Promise<boolean> {
    const rows = await this.context.db
      .delete(leavePolicies)
      .where(eq(leavePolicies.year, year))
      .returning({ year: leavePolicies.year });
    return rows.length > 0;
  }

  async saveForStaff(
    staffId: string,
    year: number,
    policy: LeavePolicyTerms,
    updatedBy: string,
    now: Date,
  ): Promise<void> {
    const row = { ...terms(policy), updatedAt: now, updatedBy };
    try {
      await this.context.db
        .insert(staffLeavePolicies)
        .values({ staffId, year, ...row })
        .onConflictDoUpdate({ target: [staffLeavePolicies.staffId, staffLeavePolicies.year], set: row });
    } catch (error) {
      if (foreignKeyViolationConstraint(error) === 'staff_leave_policies_staff_id_staff_records_id_fk') {
        throw new NotFoundError('staff');
      }
      throw error;
    }
    await this.context.db
      .delete(staffLeaveEntitlements)
      .where(and(eq(staffLeaveEntitlements.staffId, staffId), eq(staffLeaveEntitlements.year, year)));
    if (policy.entitlements.length > 0) {
      await this.context.db
        .insert(staffLeaveEntitlements)
        .values(policy.entitlements.map((entry) => ({ staffId, year, ...entry })));
    }
  }

  async deleteForStaff(staffId: string, year: number): Promise<boolean> {
    const rows = await this.context.db
      .delete(staffLeavePolicies)
      .where(and(eq(staffLeavePolicies.staffId, staffId), eq(staffLeavePolicies.year, year)))
      .returning({ year: staffLeavePolicies.year });
    return rows.length > 0;
  }
}

function terms(row: { lateGraceMinutes: number; lateCountPerDeduction: number; absentDeduction: boolean }) {
  return {
    lateGraceMinutes: row.lateGraceMinutes,
    lateCountPerDeduction: row.lateCountPerDeduction,
    absentDeduction: row.absentDeduction,
  };
}

@Injectable()
export class DrizzleStaffFacts extends StaffFacts {
  constructor(private readonly context: DbContext) {
    super();
  }

  async placement(staffId: string) {
    const [row] = await this.context.db
      .select({ departmentId: staffRecords.departmentId, status: staffRecords.status })
      .from(staffRecords)
      .where(eq(staffRecords.id, staffId));
    return row ?? null;
  }

  async staffIdForUser(userId: string): Promise<string | null> {
    const [row] = await this.context.db
      .select({ id: staffRecords.id })
      .from(staffRecords)
      .where(eq(staffRecords.userId, userId));
    return row?.id ?? null;
  }

  async isDelegate(delegateStaffId: string, onBehalfOfStaffId: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: leaveDelegates.id })
      .from(leaveDelegates)
      .where(and(eq(leaveDelegates.staffId, delegateStaffId), eq(leaveDelegates.onBehalfOfStaffId, onBehalfOfStaffId)));
    return row !== undefined;
  }
}
