import type { Menu } from './menu.js';
import type { MenuNode } from './menu-tree.js';

export abstract class MenuRepository {
  abstract findById(id: string): Promise<Menu | null>;
  /** Every menu, reduced to what tree rules need. */
  abstract loadNodes(): Promise<MenuNode[]>;
  abstract insert(menu: Menu): Promise<void>;
  abstract update(menu: Menu): Promise<void>;
  abstract delete(id: string): Promise<void>;
  abstract hasChildren(id: string): Promise<boolean>;
}

export abstract class RoleMenuRepository {
  abstract menuIdsForRole(roleId: string): Promise<string[]>;
  /** Makes the role hold exactly `menuIds`. */
  abstract replace(roleId: string, menuIds: readonly string[], grantedBy: string | null, now: Date): Promise<void>;
}
