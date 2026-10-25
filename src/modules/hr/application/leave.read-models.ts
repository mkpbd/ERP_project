import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { LeavePolicyTerms, LeaveStatus } from '../domain/leave.js';

export interface LeaveApprovalView {
  readonly levelOrder: number;
  readonly decision: 'approved' | 'rejected';
  readonly approverStaffId: string | null;
  readonly approverName: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly remarks: string | null;
  readonly decidedAt: Date;
}

export interface LeaveApplicationView {
  readonly id: string;
  readonly staffId: string;
  readonly employeeNo: string;
  readonly staffName: string;
  readonly departmentId: string;
  readonly departmentName: string;
  readonly leaveTypeId: string;
  readonly leaveTypeName: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly days: number;
  readonly reason: string;
  readonly substituteStaffId: string | null;
  readonly substituteName: string | null;
  readonly status: LeaveStatus;
  readonly currentLevel: number;
  readonly levelCount: number;
  readonly approvedStartDate: string | null;
  readonly approvedEndDate: string | null;
  readonly approvedDays: number | null;
  readonly decisionReason: string | null;
  readonly submittedAt: Date;
  readonly decidedAt: Date | null;
}

export interface LeaveApplicationDetailView extends LeaveApplicationView {
  readonly submittedBy: string | null;
  readonly approvals: LeaveApprovalView[];
  /** Who acts next, while pending. */
  readonly nextApprover: { readonly levelName: string; readonly staffId: string; readonly staffName: string } | null;
}

export interface LeaveApplicationFilter extends PageRequest {
  readonly staffId?: string;
  readonly departmentId?: string;
  readonly status?: LeaveStatus;
  /** Applications overlapping [from, to]. */
  readonly from?: string;
  readonly to?: string;
  /** Pending applications whose current level this staff member approves. */
  readonly awaitingApproverStaffId?: string;
}

export interface LeaveBalanceView {
  readonly leaveTypeId: string;
  readonly code: string;
  readonly name: string;
  readonly entitled: number | null;
  readonly taken: number;
  readonly pending: number;
  readonly remaining: number | null;
}

export interface LeavePolicyView extends Omit<LeavePolicyTerms, 'entitlements'> {
  readonly year: number;
  readonly entitlements: Array<{ leaveTypeId: string; leaveTypeName: string; days: number }>;
  readonly updatedAt: Date;
}

export abstract class LeaveReadRepository {
  abstract list(filter: LeaveApplicationFilter): Promise<Page<LeaveApplicationView>>;
  abstract get(id: string): Promise<LeaveApplicationDetailView | null>;
  /** Every leave type with its entitlement (from the effective policy) and usage in the year. */
  abstract balances(staffId: string, year: number): Promise<{ hasPolicy: boolean; rows: LeaveBalanceView[] }>;
  abstract yearlyPolicies(): Promise<LeavePolicyView[]>;
  abstract yearlyPolicy(year: number): Promise<LeavePolicyView | null>;
  abstract staffPolicy(staffId: string, year: number): Promise<LeavePolicyView | null>;
  /** Whether the staff member approves any level of the department's chain. */
  abstract approvesInDepartment(staffId: string, departmentId: string): Promise<boolean>;
}
