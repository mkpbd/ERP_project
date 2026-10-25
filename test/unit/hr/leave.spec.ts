import { describe, expect, it } from 'vitest';
import {
  assertLeavePeriod,
  assertWithinBalance,
  calendarDays,
  LeaveApplication,
  leaveBalance,
  validPolicyTerms,
  type ApprovalLevel,
  type Approver,
} from '../../../src/modules/hr/domain/leave.js';
import { DomainError, ForbiddenError } from '../../../src/shared/domain/errors.js';

const now = new Date('2026-10-25T00:00:00Z');
const levels: ApprovalLevel[] = [
  { levelOrder: 1, name: 'Head of department', approverStaffId: 'hod' },
  { levelOrder: 2, name: 'HR', approverStaffId: 'hr' },
];
const as = (staffId: string | null, canApproveAny = false): Approver => ({
  userId: `u-${staffId}`,
  staffId,
  canApproveAny,
});

function submit(overrides: Partial<Parameters<typeof LeaveApplication.submit>[0]> = {}) {
  return LeaveApplication.submit({
    id: 'a1',
    staffId: 'jane',
    departmentId: 'nursing',
    leaveTypeId: 'cl',
    startDate: '2026-11-02',
    endDate: '2026-11-05',
    reason: ' Family event ',
    substituteStaffId: 'karim',
    levelCount: 2,
    submittedBy: 'u-jane',
    now,
    ...overrides,
  });
}

describe('leave periods and balances', () => {
  it('counts inclusive calendar days', () => {
    expect(calendarDays('2026-11-02', '2026-11-05')).toBe(4);
    expect(calendarDays('2024-02-28', '2024-03-01')).toBe(3);
  });

  it('refuses reversed, invalid and cross-year periods', () => {
    expect(() => assertLeavePeriod('2026-11-05', '2026-11-02')).toThrow(/end before/);
    expect(() => assertLeavePeriod('2026-02-30', '2026-03-01')).toThrow(DomainError);
    expect(() => assertLeavePeriod('2026-12-30', '2027-01-02')).toThrow(/new year/);
  });

  it('reserves pending days and lets unlimited types through', () => {
    const balance = leaveBalance('cl', 10, 4, 3);
    expect(balance.remaining).toBe(3);
    expect(() => assertWithinBalance(balance, 3)).not.toThrow();
    expect(() => assertWithinBalance(balance, 4)).toThrow(/Only 3 day/);
    expect(() => assertWithinBalance(leaveBalance('unpaid', null, 40, 0), 30)).not.toThrow();
  });

  it('validates policy terms', () => {
    const base = { lateGraceMinutes: 10, lateCountPerDeduction: 3, absentDeduction: true };
    expect(() => validPolicyTerms({ ...base, entitlements: [{ leaveTypeId: 'cl', days: 10 }] })).not.toThrow();
    expect(() =>
      validPolicyTerms({
        ...base,
        entitlements: [
          { leaveTypeId: 'cl', days: 10 },
          { leaveTypeId: 'cl', days: 2 },
        ],
      }),
    ).toThrow(/once/);
    expect(() => validPolicyTerms({ ...base, entitlements: [{ leaveTypeId: 'cl', days: 400 }] })).toThrow(DomainError);
  });
});

describe('LeaveApplication', () => {
  it('starts pending at level 1 with trimmed reason and computed days', () => {
    expect(submit().toSnapshot()).toMatchObject({
      status: 'pending',
      currentLevel: 1,
      days: 4,
      reason: 'Family event',
    });
    expect(() => submit({ levelCount: 0 })).toThrow(/no leave approval levels/);
    expect(() => submit({ substituteStaffId: 'jane' })).toThrow(/someone else/);
  });

  it('moves through the levels in order; the last approval decides', () => {
    const application = submit();
    expect(() => application.approve(levels[0]!, as('hr'), {}, now)).toThrow(ForbiddenError);

    application.approve(levels[0]!, as('hod'), { endDate: '2026-11-04', remarks: 'Back by Thursday' }, now);
    expect(application.toSnapshot()).toMatchObject({ status: 'pending', currentLevel: 2, approvedDays: 3 });

    application.approve(levels[1]!, as('hr'), {}, now);
    expect(application.toSnapshot()).toMatchObject({
      status: 'approved',
      approvedStartDate: '2026-11-02',
      approvedEndDate: '2026-11-04',
      approvedDays: 3,
    });
    expect(application.pullNewApprovals().map((step) => [step.levelOrder, step.decision, step.endDate])).toEqual([
      [1, 'approved', '2026-11-04'],
      [2, 'approved', '2026-11-04'],
    ]);
    expect(() => application.reject(levels[1]!, as('hr'), 'late', now)).toThrow(/already approved/);
  });

  it('never lets an approval widen the period', () => {
    expect(() => submit().approve(levels[0]!, as('hod'), { endDate: '2026-11-08' }, now)).toThrow(/shorten/);
  });

  it('allows the HR override but never self-approval', () => {
    const application = submit();
    application.approve(null, as(null, true), {}, now);
    expect(application.currentLevel).toBe(2);
    expect(() => submit().approve(levels[0]!, as('jane', true), {}, now)).toThrow(/your own/);
  });

  it('records rejection with a reason', () => {
    const application = submit();
    expect(() => application.reject(levels[0]!, as('hod'), ' ', now)).toThrow(/reason/);
    application.reject(levels[0]!, as('hod'), 'Short-staffed that week', now);
    expect(application.toSnapshot()).toMatchObject({ status: 'rejected', decisionReason: 'Short-staffed that week' });
  });

  it('lets the applicant withdraw pending leave and only HR cancel approved leave', () => {
    const pending = submit();
    pending.cancel({ userId: 'u-jane', isApplicant: true, canManage: false }, 'Plans changed', now);
    expect(pending.status).toBe('cancelled');

    const approved = submit({ levelCount: 1 });
    approved.approve(levels[0]!, as('hod'), {}, now);
    expect(() => approved.cancel({ userId: 'u-jane', isApplicant: true, canManage: false }, 'x', now)).toThrow(
      ForbiddenError,
    );
    approved.cancel({ userId: 'u-hr', isApplicant: false, canManage: true }, 'Called back to duty', now);
    expect(approved.status).toBe('cancelled');
    expect(() => approved.cancel({ userId: 'u-hr', isApplicant: false, canManage: true }, 'again', now)).toThrow(
      /already cancelled/,
    );
  });
});
