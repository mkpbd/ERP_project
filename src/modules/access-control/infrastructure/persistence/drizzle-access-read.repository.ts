import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  AccessReadRepository,
  type PermissionView,
  type RoleView,
  type UserRoleView,
} from '../../application/read-models.js';
import { permissions, rolePermissions, roles, userRoles } from './access-control.schema.js';

@Injectable()
export class DrizzleAccessReadRepository extends AccessReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async getProfile(userId: string): Promise<{ roles: string[]; roleIds: string[]; permissions: string[] }> {
    const rows = await this.context.db
      .select({ roleId: roles.id, role: roles.name, permission: permissions.key })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(userRoles.userId, userId));
    const roleNames = new Set<string>();
    const roleIds = new Set<string>();
    const keys = new Set<string>();
    for (const row of rows) {
      roleNames.add(row.role);
      roleIds.add(row.roleId);
      if (row.permission) keys.add(row.permission);
    }
    return { roles: [...roleNames].sort(), roleIds: [...roleIds].sort(), permissions: [...keys].sort() };
  }

  async listRoles(): Promise<RoleView[]> {
    const rows = await this.context.db
      .select({ role: roles, permission: permissions.key })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .orderBy(asc(roles.name), asc(permissions.key));
    const byId = new Map<string, RoleView>();
    for (const { role, permission } of rows) {
      let view = byId.get(role.id);
      if (!view) {
        view = { ...role, permissions: [] };
        byId.set(role.id, view);
      }
      if (permission) view.permissions.push(permission);
    }
    return [...byId.values()];
  }

  async getRole(roleId: string): Promise<RoleView | null> {
    const rows = await this.context.db
      .select({ role: roles, permission: permissions.key })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(roles.id, roleId))
      .orderBy(asc(permissions.key));
    const first = rows[0];
    if (!first) return null;
    return {
      ...first.role,
      permissions: rows.flatMap((row) => (row.permission ? [row.permission] : [])),
    };
  }

  listPermissions(): Promise<PermissionView[]> {
    return this.context.db
      .select({ key: permissions.key, description: permissions.description })
      .from(permissions)
      .orderBy(asc(permissions.key));
  }

  listUserRoles(userId: string): Promise<UserRoleView[]> {
    return this.context.db
      .select({ roleId: roles.id, name: roles.name, assignedAt: userRoles.assignedAt })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId))
      .orderBy(asc(roles.name));
  }
}
