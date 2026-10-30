import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, count, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ConflictError } from '../../../../shared/domain/errors.js';
import { uniqueViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { PermissionRepository, RoleRepository, UserRoleRepository } from '../../domain/repositories.js';
import { Role } from '../../domain/role.js';
import { permissions, rolePermissions, roles, userRoles } from './access-control.schema.js';

type RoleRow = typeof roles.$inferSelect;

@Injectable()
export class DrizzleRoleRepository extends RoleRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findById(id: string): Promise<Role | null> {
    const [row] = await this.context.db.select().from(roles).where(eq(roles.id, id)).limit(1);
    return row ? this.hydrate(row) : null;
  }

  async findByIdForUpdate(id: string): Promise<Role | null> {
    const [row] = await this.context.db.select().from(roles).where(eq(roles.id, id)).limit(1).for('update');
    return row ? this.hydrate(row) : null;
  }

  async findByName(name: string): Promise<Role | null> {
    const [row] = await this.context.db.select().from(roles).where(eq(roles.name, name)).limit(1);
    return row ? this.hydrate(row) : null;
  }

  async insert(role: Role, actorUserId: string | null): Promise<void> {
    const { permissions: keys, ...row } = role.toSnapshot();
    try {
      await this.context.db.insert(roles).values(row);
    } catch (error) {
      if (uniqueViolationConstraint(error) === 'roles_name_uq') {
        throw new ConflictError('role_name_taken', 'A role with this name already exists');
      }
      throw error;
    }
    await this.addPermissions(role.id, [...keys], actorUserId);
  }

  async update(role: Role, actorUserId: string | null): Promise<void> {
    const snapshot = role.toSnapshot();
    try {
      await this.context.db
        .update(roles)
        .set({ name: snapshot.name, description: snapshot.description, updatedAt: snapshot.updatedAt })
        .where(eq(roles.id, snapshot.id));
    } catch (error) {
      if (uniqueViolationConstraint(error) === 'roles_name_uq') {
        throw new ConflictError('role_name_taken', 'A role with this name already exists');
      }
      throw error;
    }

    const desired = [...snapshot.permissions];
    const current = new Set(await this.permissionKeys(snapshot.id));
    const desiredIds = await this.permissionIds(desired);
    const removeCondition =
      desiredIds.length > 0
        ? and(eq(rolePermissions.roleId, snapshot.id), notInArray(rolePermissions.permissionId, desiredIds))
        : eq(rolePermissions.roleId, snapshot.id);
    await this.context.db.delete(rolePermissions).where(removeCondition);
    await this.addPermissions(
      snapshot.id,
      desired.filter((key) => !current.has(key)),
      actorUserId,
    );
  }

  async delete(id: string): Promise<void> {
    await this.context.db.delete(roles).where(eq(roles.id, id));
  }

  async countAssignments(roleId: string): Promise<number> {
    const [row] = await this.context.db.select({ total: count() }).from(userRoles).where(eq(userRoles.roleId, roleId));
    return row?.total ?? 0;
  }

  private async hydrate(row: RoleRow): Promise<Role> {
    return Role.restore({ ...row, permissions: new Set(await this.permissionKeys(row.id)) });
  }

  private async permissionKeys(roleId: string): Promise<string[]> {
    const rows = await this.context.db
      .select({ key: permissions.key })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, roleId));
    return rows.map((row) => row.key);
  }

  private async permissionIds(keys: string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    const rows = await this.context.db
      .select({ id: permissions.id, key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, keys));
    if (rows.length !== new Set(keys).size) {
      throw new Error('Permission catalog is not synchronized with the database');
    }
    return rows.map((row) => row.id);
  }

  private async addPermissions(roleId: string, keys: string[], grantedBy: string | null): Promise<void> {
    const ids = await this.permissionIds(keys);
    if (ids.length === 0) return;
    await this.context.db
      .insert(rolePermissions)
      .values(ids.map((permissionId) => ({ roleId, permissionId, grantedBy })))
      .onConflictDoNothing();
  }
}

@Injectable()
export class DrizzleUserRoleRepository extends UserRoleRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async assign(userId: string, roleId: string, assignedBy: string | null, now: Date): Promise<boolean> {
    const inserted = await this.context.db
      .insert(userRoles)
      .values({ userId, roleId, assignedBy, assignedAt: now })
      .onConflictDoNothing()
      .returning({ userId: userRoles.userId });
    return inserted.length > 0;
  }

  async unassign(userId: string, roleId: string): Promise<boolean> {
    const deleted = await this.context.db
      .delete(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)))
      .returning({ userId: userRoles.userId });
    return deleted.length > 0;
  }

  async userIdsWithRole(roleName: string): Promise<string[]> {
    const rows = await this.context.db
      .select({ userId: userRoles.userId })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(roles.name, roleName));
    return rows.map((row) => row.userId);
  }

  async userIdsWithRoleIds(roleIds: readonly string[]): Promise<string[]> {
    const rows = await this.context.db
      .selectDistinct({ userId: userRoles.userId })
      .from(userRoles)
      .where(inArray(userRoles.roleId, [...roleIds]));
    return rows.map((row) => row.userId);
  }
}

@Injectable()
export class DrizzlePermissionRepository extends PermissionRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async syncCatalog(entries: ReadonlyArray<{ key: string; description: string }>): Promise<void> {
    if (entries.length === 0) return;
    await this.context.db
      .insert(permissions)
      .values(entries.map((entry) => ({ id: randomUUID(), key: entry.key, description: entry.description })))
      .onConflictDoUpdate({ target: permissions.key, set: { description: sql`excluded.description` } });
  }

  async ensureSystemRole(name: string, description: string, keys: readonly string[]): Promise<void> {
    await this.context.db
      .insert(roles)
      .values({ id: randomUUID(), name, description, isSystem: true })
      .onConflictDoUpdate({ target: roles.name, set: { isSystem: true, description } });
    const [role] = await this.context.db.select({ id: roles.id }).from(roles).where(eq(roles.name, name)).limit(1);
    if (!role) throw new Error(`System role ${name} could not be created`);

    const ids = (
      await this.context.db
        .select({ id: permissions.id })
        .from(permissions)
        .where(inArray(permissions.key, [...keys]))
    ).map((row) => row.id);
    // The system role holds exactly the catalog: add missing grants, drop stale ones.
    await this.context.db
      .delete(rolePermissions)
      .where(
        ids.length > 0
          ? and(eq(rolePermissions.roleId, role.id), notInArray(rolePermissions.permissionId, ids))
          : eq(rolePermissions.roleId, role.id),
      );
    if (ids.length > 0) {
      await this.context.db
        .insert(rolePermissions)
        .values(ids.map((permissionId) => ({ roleId: role.id, permissionId })))
        .onConflictDoNothing();
    }
  }
}
