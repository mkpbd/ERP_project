import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import type { LeavePolicyTerms } from '../domain/leave.js';
import type {
  LeaveApplicationDetailView,
  LeaveApplicationFilter,
  LeaveApplicationView,
  LeaveBalanceView,
  LeavePolicyView,
} from './leave.read-models.js';

export interface LeaveRequest {
  /** Omit to apply for yourself. */
  readonly staffId?: string;
  readonly leaveTypeId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly reason: string;
  readonly substituteStaffId: string | null;
}

export class SubmitLeaveApplicationCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly request: LeaveRequest,
  ) {
    super();
  }
}

export class ApproveLeaveApplicationCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly applicationId: string,
    readonly change: { startDate?: string; endDate?: string; remarks?: string },
  ) {
    super();
  }
}

export class RejectLeaveApplicationCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly applicationId: string,
    readonly reason: string,
  ) {
    super();
  }
}

export class CancelLeaveApplicationCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly applicationId: string,
    readonly reason: string,
  ) {
    super();
  }
}

export class SetLeavePolicyCommand extends Command<void> {
  /** `staffId` set: that person's policy for the year; otherwise the organization's. */
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly terms: LeavePolicyTerms,
    readonly staffId?: string,
  ) {
    super();
  }
}

export class DeleteLeavePolicyCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly staffId?: string,
  ) {
    super();
  }
}

export class ListLeaveApplicationsQuery extends Query<Page<LeaveApplicationView>> {
  constructor(
    readonly actor: Actor,
    readonly filter: LeaveApplicationFilter,
  ) {
    super();
  }
}

/** `mine`: your own applications; `awaiting-me`: pending at a level you approve. */
export class MyLeaveApplicationsQuery extends Query<Page<LeaveApplicationView>> {
  constructor(
    readonly actor: Actor,
    readonly scope: 'mine' | 'awaiting-me',
    readonly filter: Omit<LeaveApplicationFilter, 'staffId' | 'awaitingApproverStaffId' | 'departmentId'>,
  ) {
    super();
  }
}

export class GetLeaveApplicationQuery extends Query<LeaveApplicationDetailView> {
  constructor(
    readonly actor: Actor,
    readonly applicationId: string,
  ) {
    super();
  }
}

export class GetLeaveBalanceQuery extends Query<LeaveBalanceView[]> {
  /** `staffId` omitted: your own balance. */
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly staffId?: string,
  ) {
    super();
  }
}

export class ListLeavePoliciesQuery extends Query<LeavePolicyView[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class GetLeavePolicyQuery extends Query<LeavePolicyView> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly staffId?: string,
  ) {
    super();
  }
}
