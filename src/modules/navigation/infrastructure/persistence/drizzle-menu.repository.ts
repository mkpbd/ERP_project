import { Injectable } from '@nestjs/common';
import { and, eq, notInArray } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { Menu } from '../../domain/menu.js';
import type { MenuNode } from '../../domain/menu-tree.js';
import { MenuRepository, RoleMenuRepository } from '../../domain/repositories.js';
import { menus, roleMenus } from './navigation.schema.js';

@Injectable()
export class DrizzleMenuRepository extends MenuRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findById(id: string): Promise<Menu | null> {
    const [row] = await this.context.db.select().from(menus).where(eq(menus.id, id)).limit(1);
    return row ? Menu.restore(row) : null;
  }

  loadNodes(): Promise<MenuNode[]> {
    return this.context.db
      .select({ id: menus.id, parentId: menus.parentId, path: menus.path, isActive: menus.isActive })
      .from(menus);
  }

  async insert(menu: Menu): Promise<void> {
    await this.context.db.insert(menus).values(menu.toSnapshot());
  }

  async update(menu: Menu): Promise<void> {
    const { id, createdAt: _createdAt, ...changes } = menu.toSnapshot();
    await this.context.db.update(menus).set(changes).where(eq(menus.id, id));
  }

  async delete(id: string): Promise<void> {
    await this.context.db.delete(menus).where(eq(menus.id, id));
  }

  async hasChildren(id: string): Promise<boolean> {
    const [row] = await this.context.db.select({ id: menus.id }).from(menus).where(eq(menus.parentId, id)).limit(1);
    return row !== undefined;
  }
}

@Injectable()
export class DrizzleRoleMenuRepository extends RoleMenuRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async menuIdsForRole(roleId: string): Promise<string[]> {
    const rows = await this.context.db
      .select({ menuId: roleMenus.menuId })
      .from(roleMenus)
      .where(eq(roleMenus.roleId, roleId));
    return rows.map((row) => row.menuId);
  }

  async replace(roleId: string, menuIds: readonly string[], grantedBy: string | null, now: Date): Promise<void> {
    await this.context.db
      .delete(roleMenus)
      .where(
        menuIds.length > 0
          ? and(eq(roleMenus.roleId, roleId), notInArray(roleMenus.menuId, [...menuIds]))
          : eq(roleMenus.roleId, roleId),
      );
    if (menuIds.length === 0) return;
    await this.context.db
      .insert(roleMenus)
      .values(menuIds.map((menuId) => ({ roleId, menuId, grantedBy, grantedAt: now })))
      .onConflictDoNothing();
  }
}
