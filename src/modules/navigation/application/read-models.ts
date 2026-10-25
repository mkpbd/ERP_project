export interface MenuView {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly description: string;
  readonly path: string | null;
  readonly displayOrder: number;
  readonly isActive: boolean;
  readonly icon: string | null;
  readonly landingPageIconUrl: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A menu in tree order, with its depth and whether it is usable once its ancestors are considered. */
export interface MenuTreeItemView extends MenuView {
  readonly depth: number;
  readonly effectivelyActive: boolean;
}

export interface RoleMenusView {
  readonly roleId: string;
  readonly menuIds: string[];
}

export interface MenuTrailView {
  readonly menu: MenuTreeItemView;
  /** From the top-level menu down to the direct parent. */
  readonly ancestors: MenuTreeItemView[];
}

export abstract class NavigationReadRepository {
  abstract listMenus(): Promise<MenuView[]>;
  abstract allGrants(): Promise<Array<{ roleId: string; menuId: string }>>;
  abstract menuIdsForRole(roleId: string): Promise<string[]>;
}

export interface NavigationSettings {
  /** How long the menu tree and grants are cached per process; 0 disables caching. */
  readonly cacheTtlSeconds: number;
}

export const NAVIGATION_SETTINGS = Symbol('NAVIGATION_SETTINGS');
