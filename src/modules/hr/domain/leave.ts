import { DomainError, ForbiddenError } from '../../../shared/domain/errors.js';
import { isCalendarDate } from './staff-member.js';

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Inclusive calendar days between two `YYYY-MM-DD` dates. */
export function calendarDays(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

export function assertLeavePeriod(start: string, end: string): void {
  if (!isCalendarDate(start) || !isCalendarDate(end)) {
    throw new DomainError('invalid_date', 'Leave dates must be dates (YYYY-MM-DD)');
  }
  if (end < start) throw new DomainError('invalid_leave_period', 'The leave cannot end before it starts');
  if (start.slice(0, 4) !== end.slice(0, 4)) {
    throw new DomainError(
      'leave_crosses_year',
      'Split leave that crosses into a new year into one application per year',
    );
  }
}

export interface LeaveBalance {
  readonly leaveTypeId: string;
  /** Days granted by the policy for the year, or null when the type has no limit. */
  readonly entitled: number | null;
  readonly taken: number;
  readonly pending: number;
  readonly remaining: number | null;
}

/**
 * Remaining = entitled − taken (approved applications and recorded leave) − pending
 * (pending days are reserved so two applications cannot both use the same balance).
 */
export function leaveBalance(
  leaveTypeId: string,
  entitled: number | null,
  taken: number,
  pending: number,
): LeaveBalance {
  return {
    leaveTypeId,
    entitled,
    taken,
    pending,
    remaining: entitled === null ? null : entitled - taken - pending,
  };
}

export function assertWithinBalance(balance: LeaveBalance, days: number): void {
  if (balance.remaining !== null && days > balance.remaining) {
    throw new DomainError(
      'insufficient_leave_balance',
      `Only ${Math.max(balance.remaining, 0)} day(s) of this leave remain for the year`,
    );
  }
}

/**
 * A year's leave terms (old LeavePolicies, or IndividualEmployeeLeavePolicy for one staff member).
 * A leave type without an entitlement row is not limited (for example unpaid leave).
 */
export interface LeavePolicyTerms {
  readonly lateGraceMinutes: number;
  readonly lateCountPerDeduction: number;
  readonly absentDeduction: boolean;
  readonly entitlements: ReadonlyArray<{ readonly leaveTypeId: string; readonly days: number }>;
}

export function assertLeaveYear(year: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new DomainError('invalid_leave_year', 'Leave year must be between 2000 and 2100');
  }
}

export function validPolicyTerms(terms: LeavePolicyTerms): LeavePolicyTerms {
  const seen = new Set<string>();
  for (const { leaveTypeId, days } of terms.entitlements) {
    if (seen.has(leaveTypeId)) throw new DomainError('duplicate_entitlement', 'Each leave type may appear once');
    seen.add(leaveTypeId);
    if (!Number.isInteger(days) || days < 0 || days > 366) {
      throw new DomainError('invalid_entitlement', 'Entitled days must be a whole number from 0 to 366');
    }
  }
  if (!Number.isInteger(terms.lateGraceMinutes) || terms.lateGraceMinutes < 0 || terms.lateGraceMinutes > 600) {
    throw new DomainError('invalid_leave_policy', 'Late grace must be 0-600 minutes');
  }
  if (
    !Number.isInteger(terms.lateCountPerDeduction) ||
    terms.lateCountPerDeduction < 0 ||
    terms.lateCountPerDeduction > 31
  ) {
    throw new DomainError('invalid_leave_policy', 'Late count per one-day deduction must be 0-31 (0 = no deduction)');
  }
  return terms;
}

/** One step of a department's approval chain. */
export interface ApprovalLevel {
  readonly levelOrder: number;
  readonly name: string;
  readonly approverStaffId: string;
}

export interface LeaveApproval {
  readonly levelOrder: number;
  readonly decision: 'approved' | 'rejected';
  readonly approverStaffId: string | null;
  readonly decidedBy: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly remarks: string | null;
  readonly decidedAt: Date;
}

export interface LeaveApplicationProps {
  id: string;
  staffId: string;
  departmentId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  substituteStaffId: string | null;
  status: LeaveStatus;
  /** The approval level that acts next (while pending). */
  currentLevel: number;
  /** How many levels the department's chain had when the application was submitted. */
  levelCount: number;
  approvedStartDate: string | null;
  approvedEndDate: string | null;
  approvedDays: number | null;
  decisionReason: string | null;
  submittedBy: string;
  submittedAt: Date;
  decidedAt: Date | null;
  version: number;
}

/** Who is acting: their user id, their linked staff record (if any) and whether HR may override. */
export interface Approver {
  readonly userId: string;
  readonly staffId: string | null;
  readonly canApproveAny: boolean;
}

/** A leave application moving through its department's approval chain. */
export class LeaveApplication {
  private readonly newApprovals: LeaveApproval[] = [];

  private constructor(private readonly props: LeaveApplicationProps) {}

  static submit(params: {
    id: string;
    staffId: string;
    departmentId: string;
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    reason: string;
    substituteStaffId: string | null;
    levelCount: number;
    submittedBy: string;
    now: Date;
  }): LeaveApplication {
    assertLeavePeriod(params.startDate, params.endDate);
    const reason = params.reason.trim();
    if (reason.length < 1 || reason.length > 1000) {
      throw new DomainError('invalid_leave_reason', 'Give a reason (1-1000 characters)');
    }
    if (params.substituteStaffId === params.staffId) {
      throw new DomainError('invalid_substitute', 'The substitute must be someone else');
    }
    if (params.levelCount < 1) {
      throw new DomainError('no_approval_levels', "The staff member's department has no leave approval levels");
    }
    return new LeaveApplication({
      id: params.id,
      staffId: params.staffId,
      departmentId: params.departmentId,
      leaveTypeId: params.leaveTypeId,
      startDate: params.startDate,
      endDate: params.endDate,
      days: calendarDays(params.startDate, params.endDate),
      reason,
      substituteStaffId: params.substituteStaffId,
      status: 'pending',
      currentLevel: 1,
      levelCount: params.levelCount,
      approvedStartDate: null,
      approvedEndDate: null,
      approvedDays: null,
      decisionReason: null,
      submittedBy: params.submittedBy,
      submittedAt: params.now,
      decidedAt: null,
      version: 1,
    });
  }

  static restore(props: LeaveApplicationProps): LeaveApplication {
    return new LeaveApplication({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get staffId(): string {
    return this.props.staffId;
  }
  get status(): LeaveStatus {
    return this.props.status;
  }
  get currentLevel(): number {
    return this.props.currentLevel;
  }

  /**
   * Approves at the current level. The approver may narrow the period (never widen it); the
   * narrowed period carries to the next level. The last level makes the application approved.
   */
  approve(
    level: ApprovalLevel | null,
    approver: Approver,
    change: { startDate?: string; endDate?: string; remarks?: string },
    now: Date,
  ): void {
    this.assertActionable(level, approver);
    const start = change.startDate ?? this.props.approvedStartDate ?? this.props.startDate;
    const end = change.endDate ?? this.props.approvedEndDate ?? this.props.endDate;
    assertLeavePeriod(start, end);
    if (start < this.props.startDate || end > this.props.endDate) {
      throw new DomainError('approval_widens_leave', 'An approval can shorten the requested period, not extend it');
    }
    this.record('approved', approver, start, end, change.remarks, now);
    this.props.approvedStartDate = start;
    this.props.approvedEndDate = end;
    this.props.approvedDays = calendarDays(start, end);
    if (this.props.currentLevel >= this.props.levelCount) {
      this.props.status = 'approved';
      this.props.decidedAt = now;
    } else {
      this.props.currentLevel++;
    }
    this.props.version++;
  }

  reject(level: ApprovalLevel | null, approver: Approver, reason: string, now: Date): void {
    this.assertActionable(level, approver);
    const trimmed = LeaveApplication.decisionReason(reason);
    this.record('rejected', approver, null, null, trimmed, now);
    this.props.status = 'rejected';
    this.props.decisionReason = trimmed;
    this.props.decidedAt = now;
    this.props.version++;
  }

  /** The applicant may withdraw a pending application; HR may also cancel an approved one. */
  cancel(by: { userId: string; isApplicant: boolean; canManage: boolean }, reason: string, now: Date): void {
    const allowed =
      this.props.status === 'pending'
        ? by.isApplicant || by.canManage
        : this.props.status === 'approved' && by.canManage;
    if (!allowed) {
      throw this.props.status === 'pending' || this.props.status === 'approved'
        ? new ForbiddenError('leave_cancel_forbidden', 'You cannot cancel this application')
        : new DomainError('leave_closed', `The application is already ${this.props.status}`);
    }
    this.props.status = 'cancelled';
    this.props.decisionReason = LeaveApplication.decisionReason(reason);
    this.props.decidedAt = now;
    this.props.version++;
  }

  pullNewApprovals(): LeaveApproval[] {
    return this.newApprovals.splice(0);
  }

  toSnapshot(): Readonly<LeaveApplicationProps> {
    return { ...this.props };
  }

  private assertActionable(level: ApprovalLevel | null, approver: Approver): void {
    if (this.props.status !== 'pending') {
      throw new DomainError('leave_closed', `The application is already ${this.props.status}`);
    }
    const isLevelApprover = level !== null && approver.staffId !== null && level.approverStaffId === approver.staffId;
    if (!isLevelApprover && !approver.canApproveAny) {
      throw new ForbiddenError('not_leave_approver', 'You are not the approver for the current level');
    }
    if (approver.staffId !== null && approver.staffId === this.props.staffId) {
      throw new ForbiddenError('self_approval', 'You cannot decide your own leave application');
    }
  }

  private record(
    decision: LeaveApproval['decision'],
    approver: Approver,
    startDate: string | null,
    endDate: string | null,
    remarks: string | undefined,
    now: Date,
  ): void {
    this.newApprovals.push({
      levelOrder: this.props.currentLevel,
      decision,
      approverStaffId: approver.staffId,
      decidedBy: approver.userId,
      startDate,
      endDate,
      remarks: remarks?.trim() || null,
      decidedAt: now,
    });
  }

  private static decisionReason(reason: string): string {
    const trimmed = reason.trim();
    if (trimmed.length < 1 || trimmed.length > 500) {
      throw new DomainError('invalid_reason', 'Give a reason (1-500 characters)');
    }
    return trimmed;
  }
}
