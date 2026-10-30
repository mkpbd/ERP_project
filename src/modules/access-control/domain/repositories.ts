import type { Role } from './role.js';

export abstract class RoleRepository {
  abstract findById(id: string): Promise<Role | null>;
  /** Locks the role row until the surrounding transaction ends. */
  abstract findByIdForUpdate(id: string): Promise<Role | null>;
  abstract findByName(name: string): Promise<Role | null>;
  /** Throws ConflictError (role_name_taken) on duplicate names. */
  abstract insert(role: Role, actorUserId: string | null): Promise<void>;
  /** Persists name/description and reconciles the permission set. */
  abstract update(role: Role, actorUserId: string | null): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract countAssignments(roleId: string): Promise<number>;
}

export abstract class UserRoleRepository {
  /** Returns false when the assignment already existed. */
  abstract assign(userId: string, roleId: string, assignedBy: string | null, now: Date): Promise<boolean>;
  /** Returns false when there was no such assignment. */
  abstract unassign(userId: string, roleId: string): Promise<boolean>;
  abstract userIdsWithRole(roleName: string): Promise<string[]>;
  abstract userIdsWithRoleIds(roleIds: readonly string[]): Promise<string[]>;
}

export abstract class PermissionRepository {
  /** Inserts catalog entries that are missing and refreshes descriptions. */
  abstract syncCatalog(entries: ReadonlyArray<{ key: string; description: string }>): Promise<void>;
  /** Creates the system role if needed and grants it exactly the given permissions. */
  abstract ensureSystemRole(name: string, description: string, permissions: readonly string[]): Promise<void>;
}
