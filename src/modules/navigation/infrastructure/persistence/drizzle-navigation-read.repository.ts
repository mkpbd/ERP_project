import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { NavigationReadRepository, type MenuView } from '../../application/read-models.js';
import { menus, roleMenus } from './navigation.schema.js';

@Injectable()
export class DrizzleNavigationReadRepository extends NavigationReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  listMenus(): Promise<MenuView[]> {
    return this.context.db.select().from(menus);
  }

  allGrants(): Promise<Array<{ roleId: string; menuId: string }>> {
    return this.context.db.select({ roleId: roleMenus.roleId, menuId: roleMenus.menuId }).from(roleMenus);
  }

  async menuIdsForRole(roleId: string): Promise<string[]> {
    const rows = await this.context.db
      .select({ menuId: roleMenus.menuId })
      .from(roleMenus)
      .where(eq(roleMenus.roleId, roleId));
    return rows.map((row) => row.menuId);
  }
}
