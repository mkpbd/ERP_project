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
