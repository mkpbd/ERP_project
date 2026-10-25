/**
 * Every permission the system knows. Code is the source of truth; the
 * permissions table is synchronized from this list at startup.
 */
export const PERMISSION_CATALOG = [
  { key: 'users:read', description: 'View user accounts' },
  { key: 'users:create', description: 'Create user accounts' },
  { key: 'users:update', description: "Edit other users' profiles" },
  { key: 'users:deactivate', description: 'Deactivate and reactivate user accounts' },
  { key: 'sessions:revoke', description: "Revoke other users' sessions" },
  { key: 'roles:read', description: 'View roles and their permissions' },
  { key: 'roles:create', description: 'Create roles' },
  { key: 'roles:update', description: 'Rename and describe roles' },
  { key: 'roles:delete', description: 'Delete roles' },
  { key: 'permissions:read', description: 'View permissions and user assignments' },
  { key: 'permissions:assign', description: 'Assign roles to users and permissions to roles' },
  { key: 'audit:read', description: 'Read the audit log' },
  { key: 'menus:read', description: 'View the menu tree and which menus each role holds' },
  { key: 'menus:manage', description: 'Create, edit, activate and delete menus' },
  { key: 'menus:assign', description: 'Grant menus to roles (only menus you can use yourself)' },
  { key: 'menus:access-all', description: 'Use every active menu without a role grant' },
  { key: 'locations:manage', description: 'Create, edit and delete countries, divisions and districts' },
  { key: 'masters:manage', description: 'Create, edit and delete admin master data (departments, service units, …)' },
  { key: 'tenants:manage', description: 'Create, edit and delete tenants and their logos' },
  { key: 'settings:manage', description: 'Change application settings' },
  { key: 'reports:read', description: 'See every report and which roles may run it' },
  { key: 'reports:assign', description: 'Grant reports to roles (only reports you can run)' },
  { key: 'reports:access-all', description: 'Run every report without a role grant' },
  { key: 'hr:read', description: 'View staff records (personal data), photos and documents' },
  { key: 'hr:manage', description: 'Add and edit staff records, their status, documents and department incharges' },
  { key: 'hr-masters:manage', description: 'Change HR divisions, departments, designations, festivals and holidays' },
  { key: 'leave:read', description: "See everyone's leave applications, balances, policies and recorded leave" },
  {
    key: 'leave:manage',
    description: 'Set leave policies, approval chains and delegates; record leave; cancel approved leave',
  },
  { key: 'roster:manage', description: 'Set up shift types and edit duty rosters, duty exchanges and extra duties' },
  { key: 'attendance:read', description: "See everyone's attendance, punches and manual entries" },
  { key: 'attendance:enter', description: 'Enter, edit, submit and cancel manual attendance' },
  { key: 'attendance:approve', description: 'Approve, reject and revoke manual attendance (not your own)' },
  { key: 'attendance:ingest', description: 'Send device punches (for the attendance device integration)' },
  { key: 'recruitment:read', description: 'See job circulars, applicants and their CVs' },
  { key: 'recruitment:manage', description: 'Publish job circulars and record applicants, their status and CVs' },
  { key: 'payroll:read', description: "See everyone's salary structure and increments" },
  { key: 'payroll:manage', description: 'Set up salary policies and salaries; apply, commit and reverse increments' },
  { key: 'accounts:read', description: 'See the chart of accounts, books and financial statements' },
  { key: 'accounts:manage', description: 'Set up the chart of accounts and accounting masters' },
  { key: 'vouchers:write', description: 'Enter and edit draft vouchers and their attachments' },
  { key: 'vouchers:post', description: 'Post and reverse vouchers' },
  { key: 'leave:approve-any', description: 'Approve or reject any pending leave application at its current level' },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key'];

export const SUPER_ADMIN_ROLE = 'super-admin';

const KNOWN = new Set<string>(PERMISSION_CATALOG.map((permission) => permission.key));

export function isKnownPermission(key: string): key is PermissionKey {
  return KNOWN.has(key);
}
