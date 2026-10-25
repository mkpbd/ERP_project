export const HR_DIVISION = 'hr_division';
export const HR_DEPARTMENT = 'hr_department';
export const HR_SUB_DEPARTMENT = 'hr_sub_department';
export const DESIGNATION = 'designation';
export const FESTIVAL = 'festival';
export const GOVT_HOLIDAY = 'govt_holiday';
export const DEPARTMENT_INCHARGE = 'department_incharge';

/** Staff records hold personal data: reading them needs hr:read (or being that staff member). */
export const HR_READ = 'hr:read';
export const HR_MANAGE = 'hr:manage';
/** Organization structure and calendar masters; any signed-in user may read them. */
export const HR_MASTERS_MANAGE = 'hr-masters:manage';
