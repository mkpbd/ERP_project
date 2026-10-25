export const HR_DIVISION = 'hr_division';
export const HR_DEPARTMENT = 'hr_department';
export const HR_SUB_DEPARTMENT = 'hr_sub_department';
export const DESIGNATION = 'designation';
export const FESTIVAL = 'festival';
export const GOVT_HOLIDAY = 'govt_holiday';
export const DEPARTMENT_INCHARGE = 'department_incharge';
export const LEAVE_TYPE = 'leave_type';
export const LEAVE_APPROVAL_LEVEL = 'leave_approval_level';
export const LEAVE_DELEGATE = 'leave_delegate';
export const LEAVE_RECORD = 'leave_record';
export const SHIFT_TYPE = 'shift_type';
export const DUTY_EXCHANGE = 'duty_exchange';
export const EXTRA_DUTY = 'extra_duty';

/** Shift types, the duty roster, duty exchanges and extra-duty records. Reading rosters needs only sign-in. */
export const ROSTER_MANAGE = 'roster:manage';

/** Everyone's attendance, punches and manual entries. */
export const ATTENDANCE_READ = 'attendance:read';
/** Create, edit, submit and cancel (not approved) manual attendance entries. */
export const ATTENDANCE_ENTER = 'attendance:enter';
/** Approve, reject and revoke manual attendance entries (never your own or ones you entered). */
export const ATTENDANCE_APPROVE = 'attendance:approve';
/** Device integrations that send punches. */
export const ATTENDANCE_INGEST = 'attendance:ingest';

/** Staff records hold personal data: reading them needs hr:read (or being that staff member). */
export const HR_READ = 'hr:read';
export const HR_MANAGE = 'hr:manage';
/** Organization structure and calendar masters; any signed-in user may read them. */
export const HR_MASTERS_MANAGE = 'hr-masters:manage';

/** Everyone's leave applications, balances, policies and records. */
export const LEAVE_READ = 'leave:read';
/** Leave policies, approval chains, delegates, recorded leave; cancelling approved leave; applying for anyone. */
export const LEAVE_MANAGE = 'leave:manage';
/** Decide any pending application at its current level (HR override when an approver is away). */
export const LEAVE_APPROVE_ANY = 'leave:approve-any';

export const JOB_CIRCULAR = 'job_circular';
export const JOB_APPLICATION = 'job_application';
/** Job circulars, applicants and their CVs (personal data: not open to every signed-in user). */
export const RECRUITMENT_READ = 'recruitment:read';
export const RECRUITMENT_MANAGE = 'recruitment:manage';
