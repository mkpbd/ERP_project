import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import {
  LeaveReadRepository,
  type LeaveApplicationDetailView,
  type LeaveApplicationFilter,
  type LeaveApplicationView,
  type LeaveBalanceView,
  type LeavePolicyView,
} from '../../application/leave.read-models.js';
import { leaveBalance } from '../../domain/leave.js';
import { hrDepartments, staffRecords } from './hr.schema.js';
import {
  leaveApplicationApprovals,
  leaveApplications,
  leaveApprovalLevels,
  leavePolicies,
  leavePolicyEntitlements,
  leaveRecords,
  leaveTypes,
  staffLeaveEntitlements,
  staffLeavePolicies,
} from './leave.schema.js';

const substitute = alias(staffRecords, 'substitute');

const applicationColumns = {
  id: leaveApplications.id,
  staffId: leaveApplications.staffId,
  employeeNo: staffRecords.employeeNo,
  staffName: staffRecords.fullName,
  departmentId: leaveApplications.departmentId,
  departmentName: hrDepartments.name,
  leaveTypeId: leaveApplications.leaveTypeId,
  leaveTypeName: leaveTypes.name,
  startDate: leaveApplications.startDate,
  endDate: leaveApplications.endDate,
  days: leaveApplications.days,
  reason: leaveApplications.reason,
  substituteStaffId: leaveApplications.substituteStaffId,
  substituteName: substitute.fullName,
  status: leaveApplications.status,
  currentLevel: leaveApplications.currentLevel,
  levelCount: leaveApplications.levelCount,
  approvedStartDate: leaveApplications.approvedStartDate,
  approvedEndDate: leaveApplications.approvedEndDate,
  approvedDays: leaveApplications.approvedDays,
  decisionReason: leaveApplications.decisionReason,
  submittedAt: leaveApplications.submittedAt,
  decidedAt: leaveApplications.decidedAt,
};

@Injectable()
export class DrizzleLeaveReadRepository extends LeaveReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  private base() {
    return this.context.db
      .select(applicationColumns)
      .from(leaveApplications)
      .innerJoin(staffRecords, eq(staffRecords.id, leaveApplications.staffId))
      .innerJoin(hrDepartments, eq(hrDepartments.id, leaveApplications.departmentId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveApplications.leaveTypeId))
      .leftJoin(substitute, eq(substitute.id, leaveApplications.substituteStaffId))
      .$dynamic();
  }

  private conditions(filter: LeaveApplicationFilter): SQL | undefined {
    return and(
      filter.staffId ? eq(leaveApplications.staffId, filter.staffId) : undefined,
      filter.departmentId ? eq(leaveApplications.departmentId, filter.departmentId) : undefined,
      filter.status ? eq(leaveApplications.status, filter.status) : undefined,
      filter.from ? sql`${leaveApplications.endDate} >= ${filter.from}` : undefined,
      filter.to ? sql`${leaveApplications.startDate} <= ${filter.to}` : undefined,
      filter.awaitingApproverStaffId
        ? sql`exists (select 1 from ${leaveApprovalLevels}
            where ${leaveApprovalLevels.departmentId} = ${leaveApplications.departmentId}
              and ${leaveApprovalLevels.levelOrder} = ${leaveApplications.currentLevel}
              and ${leaveApprovalLevels.approverStaffId} = ${filter.awaitingApproverStaffId})`
        : undefined,
    );
  }

  async list(filter: LeaveApplicationFilter): Promise<Page<LeaveApplicationView>> {
    const where = this.conditions(filter);
    const [totals] = await this.context.db.select({ total: count() }).from(leaveApplications).where(where);
    const items = await this.base()
      .where(where)
      .orderBy(desc(leaveApplications.startDate), asc(staffRecords.employeeNo))
      .limit(filter.pageSize)
      .offset(offsetOf(filter));
    return toPage(items, totals?.total ?? 0, filter);
  }

  async get(id: string): Promise<LeaveApplicationDetailView | null> {
    const [row] = await this.base().where(eq(leaveApplications.id, id));
    if (!row) return null;
    const approver = alias(staffRecords, 'approver');
    const [approvals, [submission], [next]] = await Promise.all([
      this.context.db
        .select({
          levelOrder: leaveApplicationApprovals.levelOrder,
          decision: leaveApplicationApprovals.decision,
          approverStaffId: leaveApplicationApprovals.approverStaffId,
          approverName: approver.fullName,
          startDate: leaveApplicationApprovals.startDate,
          endDate: leaveApplicationApprovals.endDate,
          remarks: leaveApplicationApprovals.remarks,
          decidedAt: leaveApplicationApprovals.decidedAt,
        })
        .from(leaveApplicationApprovals)
        .leftJoin(approver, eq(approver.id, leaveApplicationApprovals.approverStaffId))
        .where(eq(leaveApplicationApprovals.applicationId, id))
        .orderBy(asc(leaveApplicationApprovals.levelOrder)),
      this.context.db
        .select({ submittedBy: leaveApplications.submittedBy })
        .from(leaveApplications)
        .where(eq(leaveApplications.id, id)),
      row.status === 'pending'
        ? this.context.db
            .select({ levelName: leaveApprovalLevels.name, staffId: approver.id, staffName: approver.fullName })
            .from(leaveApprovalLevels)
            .innerJoin(approver, eq(approver.id, leaveApprovalLevels.approverStaffId))
            .where(
              and(
                eq(leaveApprovalLevels.departmentId, row.departmentId),
                eq(leaveApprovalLevels.levelOrder, row.currentLevel),
              ),
            )
        : Promise.resolve([]),
    ]);
    return { ...row, submittedBy: submission?.submittedBy ?? null, approvals, nextApprover: next ?? null };
  }

  async balances(staffId: string, year: number): Promise<{ hasPolicy: boolean; rows: LeaveBalanceView[] }> {
    const [own] = await this.context.db
      .select({ year: staffLeavePolicies.year })
      .from(staffLeavePolicies)
      .where(and(eq(staffLeavePolicies.staffId, staffId), eq(staffLeavePolicies.year, year)));
    const [yearly] = own
      ? [undefined]
      : await this.context.db
          .select({ year: leavePolicies.year })
          .from(leavePolicies)
          .where(eq(leavePolicies.year, year));
    if (!own && !yearly) return { hasPolicy: false, rows: [] };

    const entitlements = own
      ? await this.context.db
          .select({ leaveTypeId: staffLeaveEntitlements.leaveTypeId, days: staffLeaveEntitlements.days })
          .from(staffLeaveEntitlements)
          .where(and(eq(staffLeaveEntitlements.staffId, staffId), eq(staffLeaveEntitlements.year, year)))
      : await this.context.db
          .select({ leaveTypeId: leavePolicyEntitlements.leaveTypeId, days: leavePolicyEntitlements.days })
          .from(leavePolicyEntitlements)
          .where(eq(leavePolicyEntitlements.year, year));
    const entitled = new Map(entitlements.map((row) => [row.leaveTypeId, row.days]));

    const [types, applications, records] = await Promise.all([
      this.context.db
        .select({ id: leaveTypes.id, code: leaveTypes.code, name: leaveTypes.name })
        .from(leaveTypes)
        .orderBy(asc(leaveTypes.code)),
      this.context.db
        .select({
          leaveTypeId: leaveApplications.leaveTypeId,
          taken: sql<number>`coalesce(sum(${leaveApplications.approvedDays}) filter (where ${leaveApplications.status} = 'approved'), 0)::int`,
          pending: sql<number>`coalesce(sum(coalesce(${leaveApplications.approvedDays}, ${leaveApplications.days})) filter (where ${leaveApplications.status} = 'pending'), 0)::int`,
        })
        .from(leaveApplications)
        .where(
          and(eq(leaveApplications.staffId, staffId), sql`extract(year from ${leaveApplications.startDate}) = ${year}`),
        )
        .groupBy(leaveApplications.leaveTypeId),
      this.context.db
        .select({
          leaveTypeId: leaveRecords.leaveTypeId,
          days: sql<number>`coalesce(sum(${leaveRecords.days}), 0)::int`,
        })
        .from(leaveRecords)
        .where(and(eq(leaveRecords.staffId, staffId), sql`extract(year from ${leaveRecords.startDate}) = ${year}`))
        .groupBy(leaveRecords.leaveTypeId),
    ]);
    const used = new Map(applications.map((row) => [row.leaveTypeId, row]));
    const recorded = new Map(records.map((row) => [row.leaveTypeId, row.days]));
    return {
      hasPolicy: true,
      rows: types.map((type) => ({
        code: type.code,
        name: type.name,
        ...leaveBalance(
          type.id,
          entitled.get(type.id) ?? null,
          (used.get(type.id)?.taken ?? 0) + (recorded.get(type.id) ?? 0),
          used.get(type.id)?.pending ?? 0,
        ),
      })),
    };
  }

  async yearlyPolicies(): Promise<LeavePolicyView[]> {
    const policies = await this.context.db.select().from(leavePolicies).orderBy(desc(leavePolicies.year));
    return Promise.all(
      policies.map((policy) => this.withEntitlements(policy, () => this.yearlyEntitlements(policy.year))),
    );
  }

  async yearlyPolicy(year: number): Promise<LeavePolicyView | null> {
    const [policy] = await this.context.db.select().from(leavePolicies).where(eq(leavePolicies.year, year));
    return policy ? this.withEntitlements(policy, () => this.yearlyEntitlements(year)) : null;
  }

  async staffPolicy(staffId: string, year: number): Promise<LeavePolicyView | null> {
    const [policy] = await this.context.db
      .select()
      .from(staffLeavePolicies)
      .where(and(eq(staffLeavePolicies.staffId, staffId), eq(staffLeavePolicies.year, year)));
    return policy
      ? this.withEntitlements(policy, () =>
          this.context.db
            .select({
              leaveTypeId: staffLeaveEntitlements.leaveTypeId,
              leaveTypeName: leaveTypes.name,
              days: staffLeaveEntitlements.days,
            })
            .from(staffLeaveEntitlements)
            .innerJoin(leaveTypes, eq(leaveTypes.id, staffLeaveEntitlements.leaveTypeId))
            .where(and(eq(staffLeaveEntitlements.staffId, staffId), eq(staffLeaveEntitlements.year, year)))
            .orderBy(asc(leaveTypes.code)),
        )
      : null;
  }

  async approvesInDepartment(staffId: string, departmentId: string): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: leaveApprovalLevels.id })
      .from(leaveApprovalLevels)
      .where(and(eq(leaveApprovalLevels.approverStaffId, staffId), eq(leaveApprovalLevels.departmentId, departmentId)))
      .limit(1);
    return row !== undefined;
  }

  private yearlyEntitlements(year: number) {
    return this.context.db
      .select({
        leaveTypeId: leavePolicyEntitlements.leaveTypeId,
        leaveTypeName: leaveTypes.name,
        days: leavePolicyEntitlements.days,
      })
      .from(leavePolicyEntitlements)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leavePolicyEntitlements.leaveTypeId))
      .where(eq(leavePolicyEntitlements.year, year))
      .orderBy(asc(leaveTypes.code));
  }

  private async withEntitlements(
    policy: {
      year: number;
      lateGraceMinutes: number;
      lateCountPerDeduction: number;
      absentDeduction: boolean;
      updatedAt: Date;
    },
    entitlements: () => Promise<Array<{ leaveTypeId: string; leaveTypeName: string; days: number }>>,
  ): Promise<LeavePolicyView> {
    return {
      year: policy.year,
      lateGraceMinutes: policy.lateGraceMinutes,
      lateCountPerDeduction: policy.lateCountPerDeduction,
      absentDeduction: policy.absentDeduction,
      entitlements: await entitlements(),
      updatedAt: policy.updatedAt,
    };
  }
}
