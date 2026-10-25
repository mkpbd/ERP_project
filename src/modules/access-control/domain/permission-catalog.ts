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
] as const;

export type PermissionKey = (typeof PERMISSION_CATALOG)[number]['key'];

export const SUPER_ADMIN_ROLE = 'super-admin';

const KNOWN = new Set<string>(PERMISSION_CATALOG.map((permission) => permission.key));

export function isKnownPermission(key: string): key is PermissionKey {
  return KNOWN.has(key);
}
