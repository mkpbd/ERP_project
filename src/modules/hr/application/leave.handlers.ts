import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import type { Page } from '../../../shared/application/pagination.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  assertLeaveYear,
  assertWithinBalance,
  leaveBalance,
  LeaveApplication,
  validPolicyTerms,
  type ApprovalLevel,
  type Approver,
} from '../domain/leave.js';
import { LeavePolicyRepository, LeaveRepository, StaffFacts } from '../domain/repositories.js';
import { HR_READ, LEAVE_APPROVE_ANY, LEAVE_MANAGE, LEAVE_READ } from './hr.constants.js';
import {
  ApproveLeaveApplicationCommand,
  CancelLeaveApplicationCommand,
  DeleteLeavePolicyCommand,
  GetLeaveApplicationQuery,
  GetLeaveBalanceQuery,
  GetLeavePolicyQuery,
  ListLeaveApplicationsQuery,
  ListLeavePoliciesQuery,
  MyLeaveApplicationsQuery,
  RejectLeaveApplicationCommand,
  SetLeavePolicyCommand,
  SubmitLeaveApplicationCommand,
} from './leave.messages.js';
import {
  LeaveReadRepository,
  type LeaveApplicationDetailView,
  type LeaveApplicationView,
  type LeaveBalanceView,
  type LeavePolicyView,
} from './leave.read-models.js';

/** Serializes one person's leave changes so overlap and balance checks see each other. */
const staffLeaveLock = (staffId: string) => `hr:leave:${staffId}`;

@CommandHandler(SubmitLeaveApplicationCommand)
export class SubmitLeaveApplicationHandler implements ICommandHandler<SubmitLeaveApplicationCommand> {
  constructor(
    private readonly leave: LeaveRepository,
    private readonly policies: LeavePolicyRepository,
    private readonly staff: StaffFacts,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, request }: SubmitLeaveApplicationCommand): Promise<{ id: string }> {
    const ownStaffId = await this.staff.staffIdForUser(actor.userId);
    const staffId = request.staffId ?? ownStaffId;
    if (!staffId) throw new NotFoundError('staff');
    const forSelf = staffId === ownStaffId;
    const asDelegate = !forSelf && ownStaffId !== null && (await this.staff.isDelegate(ownStaffId, staffId));
    if (!forSelf && !asDelegate) await this.access.authorize(actor.userId, { permissions: [LEAVE_MANAGE] });

    const id = randomUUID();
    await this.tx.run(async () => {
      await this.tx.lock(staffLeaveLock(staffId));
      const placement = await this.staff.placement(staffId);
      if (!placement) throw new NotFoundError('staff');
      if (placement.status !== 'active')
        throw new DomainError('staff_not_active', 'Only active staff can apply for leave');
      if (!(await this.leave.leaveTypeExists(request.leaveTypeId))) throw new NotFoundError('leave_type');
      if (request.substituteStaffId) {
        const substitute = await this.staff.placement(request.substituteStaffId);
        if (!substitute) throw new NotFoundError('substitute_staff');
        if (substitute.status !== 'active')
          throw new DomainError('invalid_substitute', 'The substitute must be active staff');
      }
      const levels = await this.leave.approvalLevels(placement.departmentId);
      const application = LeaveApplication.submit({
        id,
        staffId,
        departmentId: placement.departmentId,
        leaveTypeId: request.leaveTypeId,
        startDate: request.startDate,
        endDate: request.endDate,
        reason: request.reason,
        substituteStaffId: request.substituteStaffId,
        levelCount: levels.length,
        submittedBy: actor.userId,
        now: this.clock.now(),
      });
      if (await this.leave.overlaps(staffId, request.startDate, request.endDate)) {
        throw new DomainError('leave_overlaps', 'This period overlaps other leave of the same person');
      }
      const snapshot = application.toSnapshot();
      const year = Number(snapshot.startDate.slice(0, 4));
      const terms = await this.policies.effectiveTerms(staffId, year);
      if (!terms) throw new DomainError('no_leave_policy', `No leave policy has been set for ${year}`);
      const entitled = terms.entitlements.find((row) => row.leaveTypeId === request.leaveTypeId)?.days ?? null;
      const usage = await this.leave.usage(staffId, year, request.leaveTypeId);
      assertWithinBalance(leaveBalance(request.leaveTypeId, entitled, usage.taken, usage.pending), snapshot.days);

      await this.leave.insert(application);
      await this.audit.record({
        action: 'leave.submitted',
        actorUserId: actor.userId,
        resourceType: 'leave_application',
        resourceId: id,
        metadata: { staffId, days: snapshot.days, onBehalf: !forSelf },
      });
    });
    return { id };
  }
}

/** Loads an application locked, lets the caller decide, saves and audits. */
@Injectable()
export class LeaveDecisions {
  constructor(
    private readonly leave: LeaveRepository,
    private readonly staff: StaffFacts,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    readonly clock: Clock,
  ) {}

  async decide(
    actor: Actor,
    applicationId: string,
    action: string,
    act: (application: LeaveApplication, approver: Approver, level: ApprovalLevel | null) => void,
  ): Promise<void> {
    const [staffId, canApproveAny] = await Promise.all([
      this.staff.staffIdForUser(actor.userId),
      this.access.isAllowed(actor.userId, { permissions: [LEAVE_APPROVE_ANY] }),
    ]);
    await this.tx.run(async () => {
      const application = await this.leave.findForUpdate(applicationId);
      if (!application) throw new NotFoundError('leave_application');
      const currentLevel = application.currentLevel;
      const levels = await this.leave.approvalLevels(application.toSnapshot().departmentId);
      const level = levels.find((candidate) => candidate.levelOrder === currentLevel) ?? null;
      act(application, { userId: actor.userId, staffId, canApproveAny }, level);
      await this.leave.update(application);
      await this.audit.record({
        action: `leave.${action}`,
        actorUserId: actor.userId,
        resourceType: 'leave_application',
        resourceId: applicationId,
        metadata: { level: currentLevel, status: application.status },
      });
    });
  }
}

@CommandHandler(ApproveLeaveApplicationCommand)
export class ApproveLeaveApplicationHandler implements ICommandHandler<ApproveLeaveApplicationCommand> {
  constructor(private readonly decisions: LeaveDecisions) {}

  async execute({ actor, applicationId, change }: ApproveLeaveApplicationCommand): Promise<void> {
    await this.decisions.decide(actor, applicationId, 'approved', (application, approver, level) =>
      application.approve(level, approver, change, this.decisions.clock.now()),
    );
  }
}

@CommandHandler(RejectLeaveApplicationCommand)
export class RejectLeaveApplicationHandler implements ICommandHandler<RejectLeaveApplicationCommand> {
  constructor(private readonly decisions: LeaveDecisions) {}

  async execute({ actor, applicationId, reason }: RejectLeaveApplicationCommand): Promise<void> {
    await this.decisions.decide(actor, applicationId, 'rejected', (application, approver, level) =>
      application.reject(level, approver, reason, this.decisions.clock.now()),
    );
  }
}

@CommandHandler(CancelLeaveApplicationCommand)
export class CancelLeaveApplicationHandler implements ICommandHandler<CancelLeaveApplicationCommand> {
  constructor(
    private readonly decisions: LeaveDecisions,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, applicationId, reason }: CancelLeaveApplicationCommand): Promise<void> {
    const canManage = await this.access.isAllowed(actor.userId, { permissions: [LEAVE_MANAGE] });
    await this.decisions.decide(actor, applicationId, 'cancelled', (application, approver) => {
      const snapshot = application.toSnapshot();
      const isApplicant = approver.staffId === snapshot.staffId || snapshot.submittedBy === actor.userId;
      application.cancel({ userId: actor.userId, isApplicant, canManage }, reason, this.decisions.clock.now());
    });
  }
}

@CommandHandler(SetLeavePolicyCommand)
export class SetLeavePolicyHandler implements ICommandHandler<SetLeavePolicyCommand> {
  constructor(
    private readonly policies: LeavePolicyRepository,
    private readonly leave: LeaveRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, year, terms, staffId }: SetLeavePolicyCommand): Promise<void> {
    await this.access.authorize(actor.userId, { permissions: [LEAVE_MANAGE] });
    assertLeaveYear(year);
    const valid = validPolicyTerms(terms);
    await this.tx.run(async () => {
      for (const { leaveTypeId } of valid.entitlements) {
        if (!(await this.leave.leaveTypeExists(leaveTypeId))) throw new NotFoundError('leave_type');
      }
      const now = this.clock.now();
      if (staffId) await this.policies.saveForStaff(staffId, year, valid, actor.userId, now);
      else await this.policies.saveYearly(year, valid, actor.userId, now);
      await this.audit.record({
        action: 'leave.policy_set',
        actorUserId: actor.userId,
        resourceType: staffId ? 'staff' : 'leave_policy',
        resourceId: staffId ?? String(year),
        metadata: { year, entitlements: valid.entitlements.length },
      });
    });
  }
}

@CommandHandler(DeleteLeavePolicyCommand)
export class DeleteLeavePolicyHandler implements ICommandHandler<DeleteLeavePolicyCommand> {
  constructor(
    private readonly policies: LeavePolicyRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  async execute({ actor, year, staffId }: DeleteLeavePolicyCommand): Promise<void> {
    await this.access.authorize(actor.userId, { permissions: [LEAVE_MANAGE] });
    await this.tx.run(async () => {
      const deleted = staffId
        ? await this.policies.deleteForStaff(staffId, year)
        : await this.policies.deleteYearly(year);
      if (!deleted) throw new NotFoundError('leave_policy');
      await this.audit.record({
        action: 'leave.policy_deleted',
        actorUserId: actor.userId,
        resourceType: staffId ? 'staff' : 'leave_policy',
        resourceId: staffId ?? String(year),
        metadata: { year },
      });
    });
  }
}

@QueryHandler(ListLeaveApplicationsQuery)
export class ListLeaveApplicationsHandler implements IQueryHandler<ListLeaveApplicationsQuery> {
  constructor(
    private readonly read: LeaveReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, filter }: ListLeaveApplicationsQuery): Promise<Page<LeaveApplicationView>> {
    await this.access.authorize(actor.userId, { permissions: [LEAVE_READ] });
    return this.read.list(filter);
  }
}

@QueryHandler(MyLeaveApplicationsQuery)
export class MyLeaveApplicationsHandler implements IQueryHandler<MyLeaveApplicationsQuery> {
  constructor(
    private readonly read: LeaveReadRepository,
    private readonly staff: StaffFacts,
  ) {}

  async execute({ actor, scope, filter }: MyLeaveApplicationsQuery): Promise<Page<LeaveApplicationView>> {
    const staffId = await this.staff.staffIdForUser(actor.userId);
    if (!staffId) throw new NotFoundError('staff');
    return this.read.list(
      scope === 'mine' ? { ...filter, staffId } : { ...filter, status: 'pending', awaitingApproverStaffId: staffId },
    );
  }
}

@QueryHandler(GetLeaveApplicationQuery)
export class GetLeaveApplicationHandler implements IQueryHandler<GetLeaveApplicationQuery> {
  constructor(
    private readonly read: LeaveReadRepository,
    private readonly staff: StaffFacts,
    private readonly access: AccessControl,
  ) {}

  /**
   * Visible to leave:read and leave:approve-any (who may decide any application), the applicant, whoever
   * submitted it, a delegate and the department's approvers.
   */
  async execute({ actor, applicationId }: GetLeaveApplicationQuery): Promise<LeaveApplicationDetailView> {
    const [application, ownStaffId, canRead] = await Promise.all([
      this.read.get(applicationId),
      this.staff.staffIdForUser(actor.userId),
      this.access.isAllowed(actor.userId, { permissions: [LEAVE_READ, LEAVE_APPROVE_ANY], mode: 'any' }),
    ]);
    if (canRead) {
      if (!application) throw new NotFoundError('leave_application');
      return application;
    }
    const visible =
      application !== null &&
      (application.submittedBy === actor.userId ||
        (ownStaffId !== null &&
          (application.staffId === ownStaffId ||
            (await this.staff.isDelegate(ownStaffId, application.staffId)) ||
            (await this.read.approvesInDepartment(ownStaffId, application.departmentId)))));
    if (!visible) throw new ForbiddenError();
    return application;
  }
}

@QueryHandler(GetLeaveBalanceQuery)
export class GetLeaveBalanceHandler implements IQueryHandler<GetLeaveBalanceQuery> {
  constructor(
    private readonly read: LeaveReadRepository,
    private readonly staff: StaffFacts,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, year, staffId }: GetLeaveBalanceQuery): Promise<LeaveBalanceView[]> {
    assertLeaveYear(year);
    const ownStaffId = await this.staff.staffIdForUser(actor.userId);
    const target = staffId ?? ownStaffId;
    if (!target) throw new NotFoundError('staff');
    if (target !== ownStaffId && !(ownStaffId !== null && (await this.staff.isDelegate(ownStaffId, target)))) {
      await this.access.authorize(actor.userId, { permissions: [LEAVE_READ] });
    }
    if (!(await this.staff.placement(target))) throw new NotFoundError('staff');
    const { hasPolicy, rows } = await this.read.balances(target, year);
    if (!hasPolicy) throw new DomainError('no_leave_policy', `No leave policy has been set for ${year}`);
    return rows;
  }
}

@QueryHandler(ListLeavePoliciesQuery)
export class ListLeavePoliciesHandler implements IQueryHandler<ListLeavePoliciesQuery> {
  constructor(
    private readonly read: LeaveReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor }: ListLeavePoliciesQuery): Promise<LeavePolicyView[]> {
    await this.access.authorize(actor.userId, { permissions: [LEAVE_READ] });
    return this.read.yearlyPolicies();
  }
}

@QueryHandler(GetLeavePolicyQuery)
export class GetLeavePolicyHandler implements IQueryHandler<GetLeavePolicyQuery> {
  constructor(
    private readonly read: LeaveReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, year, staffId }: GetLeavePolicyQuery): Promise<LeavePolicyView> {
    await this.access.authorize(actor.userId, {
      permissions: staffId ? [LEAVE_READ, HR_READ] : [LEAVE_READ],
      mode: 'any',
    });
    const policy = staffId ? await this.read.staffPolicy(staffId, year) : await this.read.yearlyPolicy(year);
    if (!policy) throw new NotFoundError('leave_policy');
    return policy;
  }
}

export const LEAVE_HANDLERS = [
  LeaveDecisions,
  SubmitLeaveApplicationHandler,
  ApproveLeaveApplicationHandler,
  RejectLeaveApplicationHandler,
  CancelLeaveApplicationHandler,
  SetLeavePolicyHandler,
  DeleteLeavePolicyHandler,
  ListLeaveApplicationsHandler,
  MyLeaveApplicationsHandler,
  GetLeaveApplicationHandler,
  GetLeaveBalanceHandler,
  ListLeavePoliciesHandler,
  GetLeavePolicyHandler,
];
