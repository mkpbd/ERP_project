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
  { key: 'scm:read', description: 'See stores, store access, the item catalogue and suppliers' },
  { key: 'scm:manage', description: 'Set up stores, store access, the item catalogue, suppliers and approval levels' },
  { key: 'scm:purchase', description: 'Raise and edit purchase requisitions, comparative studies and purchase orders' },
  { key: 'scm:receive', description: 'Draft and post stock receives and note GRN faults' },
  { key: 'scm:indent', description: 'Raise store indents and requests to the main store' },
  { key: 'scm:issue', description: 'Issue from sub-stores to departments and transfer between stores' },
  { key: 'scm:department', description: 'Record consumption, returns and stock counts of your departments' },
  { key: 'scm:adjust', description: 'Approve or reject department stock counts (not your own)' },
  { key: 'scm:assets', description: 'Configure, run and reverse fixed asset depreciation; describe asset pieces' },
  { key: 'pharmacy:read', description: 'See the medicine catalogue, outlets and reorder levels' },
  {
    key: 'pharmacy:manage',
    description: 'Set up the medicine catalogue, outlets, who works at each outlet and reorder levels',
  },
  { key: 'pharmacy:purchase', description: 'Raise, edit, cancel and close medicine purchase orders' },
  { key: 'pharmacy:receive', description: 'Draft and post medicine receives at the outlets you work at' },
  { key: 'pharmacy:payment', description: 'Pay suppliers for posted medicine receives' },
  {
    key: 'pharmacy:transfer',
    description: 'Raise outlet indents, send and accept transfers at the outlets you work at',
  },
  {
    key: 'pharmacy:sell',
    description: 'Sell medicines over the counter at the outlets you work at and collect loyal member dues',
  },
  {
    key: 'pharmacy:ward',
    description: 'Raise and cancel ward indents for admitted patients and see the medicine sent to the wards',
  },
  { key: 'pharmacy:count', description: 'Open, count and cancel stock counts at the outlets you work at' },
  { key: 'ipd:read', description: 'See admissions, the bed board and the inpatient census' },
  {
    key: 'ipd:admit',
    description: 'Admit patients, move them between beds, change their doctors, discharge them and ready beds',
  },
  {
    key: 'ipd:manage',
    description:
      'Keep wards, bed categories, beds and the indoor billing policy; cancel admissions; take beds out of order; cancel final bills later and let patients leave with a due',
  },
  {
    key: 'ipd:bill',
    description:
      'Charge services to admitted patients, take and refund advances, make final bills and collect their dues',
  },
  { key: 'ipd:discount', description: "Give a final bill discount above the counter's limit" },
  { key: 'opd:read', description: 'See doctors, their chamber schedules and the appointment books' },
  { key: 'opd:manage', description: 'Keep doctors, specialities, chamber schedules and the days doctors are off' },
  { key: 'opd:bill', description: 'Bill consultations, collect their dues and cancel bills on their own day' },
  { key: 'opd:discount', description: "Give a consultation discount above the counter's limit" },
  { key: 'diag:read', description: 'See the test catalogue, packages and diagnostic bills' },
  {
    key: 'diag:manage',
    description:
      "Keep diagnostic departments, tests, packages and the diagnostic policy; cancel tests after the bill's day",
  },
  { key: 'diag:bill', description: "Bill tests, collect their dues and cancel tests on the bill's day" },
  { key: 'diag:discount', description: "Give a diagnostic discount above the counter's limit" },
  { key: 'lab:read', description: 'See lab samples, the worklist, results and test parameters' },
  {
    key: 'lab:manage',
    description: "Keep the lab tests' parameters and normal ranges; hand over a report while the patient still owes",
  },
  { key: 'lab:collect', description: 'Collect samples from patients for their diagnostic bills' },
  { key: 'lab:result', description: 'Take samples in or reject them, enter results and hand reports over' },
  { key: 'lab:verify', description: 'Verify results entered by someone else, and take a verification back' },
  { key: 'doctor:pay', description: 'Pay doctors their shares of OPD and indoor bills' },
  { key: 'opd:book', description: 'Book appointments and mark arrivals, no-shows and cancellations' },
  { key: 'patient:read', description: 'Search and view registered patients, their photos and cards' },
  { key: 'patient:register', description: 'Register patients, give UHIDs and change their details and photos' },
  {
    key: 'patient:manage',
    description:
      'Take patient records out of use (registered twice, made by mistake) and back into use; merge a duplicate into the record kept',
  },
  { key: 'leave:approve-any', description: 'Approve or reject any pending leave application at its current level' },
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key'];

export const SUPER_ADMIN_ROLE = 'super-admin';

const KNOWN = new Set<string>(PERMISSION_CATALOG.map((permission) => permission.key));

export function isKnownPermission(key: string): key is PermissionKey {
  return KNOWN.has(key);
}
