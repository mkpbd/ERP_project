import { Inject, Injectable } from '@nestjs/common';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { normalizeMenuPath } from '../domain/menu.js';
import { ancestorIds, inactiveMenuIds, type MenuNode } from '../domain/menu-tree.js';
import { evaluatePageAccess, type PageAccessDecision } from '../domain/page-access.js';
import {
  NAVIGATION_SETTINGS,
  NavigationReadRepository,
  type MenuTreeItemView,
  type MenuView,
  type NavigationSettings,
} from './read-models.js';

export const ACCESS_ALL_MENUS = 'menus:access-all';

interface Snapshot {
  readonly tree: MenuTreeItemView[];
  readonly nodes: MenuNode[];
  readonly inactive: Set<string>;
  readonly grants: Map<string, Set<string>>;
  readonly expiresAt: number;
}

export interface CallerMenus {
  readonly accessAll: boolean;
  readonly held: ReadonlySet<string>;
}

/**
 * Menu visibility and page access for a user. The menu tree and role grants
 * are cached per process for a short TTL and dropped on every menu change;
 * the role assignments come from AccessControl's own cached profile.
 */
@Injectable()
export class NavigationAccessService {
  private snapshot: Snapshot | null = null;

  constructor(
    private readonly read: NavigationReadRepository,
    private readonly access: AccessControl,
    @Inject(NAVIGATION_SETTINGS) private readonly settings: NavigationSettings,
  ) {}

  async checkPages(userId: string, pages: readonly string[]): Promise<PageAccessDecision> {
    const snapshot = await this.current();
    const caller = await this.callerMenus(userId, snapshot.grants);
    return evaluatePageAccess({
      pages: pages.map(normalizeMenuPath).filter((page): page is string => page !== null),
      nodes: snapshot.nodes,
      inactive: snapshot.inactive,
      heldMenuIds: caller.held,
      accessAll: caller.accessAll,
    });
  }

  async fullTree(): Promise<MenuTreeItemView[]> {
    return (await this.current()).tree;
  }

  /** Active menus the user holds (or all active menus with menus:access-all), plus their ancestors. */
  async visibleTree(userId: string): Promise<MenuTreeItemView[]> {
    const snapshot = await this.current();
    const caller = await this.callerMenus(userId, snapshot.grants);
    const visible = new Set<string>();
    for (const item of snapshot.tree) {
      if (!item.effectivelyActive || (!caller.accessAll && !caller.held.has(item.id))) continue;
      visible.add(item.id);
      for (const ancestor of ancestorIds(snapshot.nodes, item.id)) visible.add(ancestor);
    }
    return snapshot.tree.filter((item) => visible.has(item.id));
  }

  /** Uncached: used before handing menus to roles, so a stale profile cannot widen a grant. */
  async callerMenusFresh(userId: string): Promise<CallerMenus> {
    this.access.invalidateUser(userId);
    const profile = await this.access.getProfile(userId);
    const held = new Set<string>();
    for (const roleId of profile.roleIds) for (const menuId of await this.read.menuIdsForRole(roleId)) held.add(menuId);
    return { accessAll: profile.permissions.has(ACCESS_ALL_MENUS), held };
  }

  invalidate(): void {
    this.snapshot = null;
  }

  private async callerMenus(userId: string, grants: Map<string, Set<string>>): Promise<CallerMenus> {
    const profile = await this.access.getProfile(userId);
    const held = new Set<string>();
    for (const roleId of profile.roleIds) for (const menuId of grants.get(roleId) ?? []) held.add(menuId);
    return { accessAll: profile.permissions.has(ACCESS_ALL_MENUS), held };
  }

  private async current(): Promise<Snapshot> {
    if (this.snapshot && this.snapshot.expiresAt > Date.now()) return this.snapshot;
    const [menus, grantRows] = await Promise.all([this.read.listMenus(), this.read.allGrants()]);
    const nodes = menus.map(({ id, parentId, path, isActive }) => ({ id, parentId, path, isActive }));
    const inactive = inactiveMenuIds(nodes);
    const grants = new Map<string, Set<string>>();
    for (const { roleId, menuId } of grantRows) {
      let set = grants.get(roleId);
      if (!set) grants.set(roleId, (set = new Set()));
      set.add(menuId);
    }
    const snapshot = {
      tree: treeOrder(menus, inactive),
      nodes,
      inactive,
      grants,
      expiresAt: Date.now() + this.settings.cacheTtlSeconds * 1000,
    };
    if (this.settings.cacheTtlSeconds > 0) this.snapshot = snapshot;
    return snapshot;
  }
}

/** Depth-first order, siblings by display order then name. Menus cut off by a broken link are listed as roots. */
export function treeOrder(menus: readonly MenuView[], inactive: ReadonlySet<string>): MenuTreeItemView[] {
  const ids = new Set(menus.map((menu) => menu.id));
  const children = new Map<string | null, MenuView[]>();
  for (const menu of menus) {
    const parent = menu.parentId !== null && ids.has(menu.parentId) ? menu.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), menu]);
  }
  for (const list of children.values()) {
    list.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  }

  const ordered: MenuTreeItemView[] = [];
  const visited = new Set<string>();
  const visit = (menu: MenuView, depth: number): void => {
    if (visited.has(menu.id)) return;
    visited.add(menu.id);
    ordered.push({ ...menu, depth, effectivelyActive: !inactive.has(menu.id) });
    for (const child of children.get(menu.id) ?? []) visit(child, depth + 1);
  };
  for (const root of children.get(null) ?? []) visit(root, 0);
  for (const menu of menus) visit(menu, 0);
  return ordered;
}
