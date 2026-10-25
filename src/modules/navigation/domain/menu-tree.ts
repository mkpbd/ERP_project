import { DomainError } from '../../../shared/domain/errors.js';

/** The part of a menu that tree rules and page-access checks need. */
export interface MenuNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly path: string | null;
  readonly isActive: boolean;
}

/** The page where menus are managed. Switching it off for everyone would make the switch irreversible. */
export const MENU_ADMIN_PAGE = '/administrator/project-menu';

/**
 * Menus that cannot be used: inactive themselves or under an inactive
 * ancestor. A broken parent link or a cycle ends the walk without making
 * the menu inactive.
 */
export function inactiveMenuIds(nodes: readonly MenuNode[]): Set<string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const memo = new Map<string, boolean>();

  const isInactive = (id: string, path: Set<string>): boolean => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    const node = byId.get(id);
    if (!node) return false;
    let result: boolean;
    if (!node.isActive) result = true;
    else if (node.parentId === null || path.has(node.parentId)) result = false;
    else result = isInactive(node.parentId, path.add(node.parentId));
    memo.set(id, result);
    return result;
  };

  const inactive = new Set<string>();
  for (const id of byId.keys()) if (isInactive(id, new Set([id]))) inactive.add(id);
  return inactive;
}

/** Ancestor ids of `id`, nearest first. Stops at a missing parent or a cycle. */
export function ancestorIds(nodes: readonly MenuNode[], id: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set([id]);
  const ancestors: string[] = [];
  let parentId = byId.get(id)?.parentId ?? null;
  while (parentId !== null && !seen.has(parentId)) {
    ancestors.push(parentId);
    seen.add(parentId);
    parentId = byId.get(parentId)?.parentId ?? null;
  }
  return ancestors;
}

/** The given menus plus every ancestor, so a granted child is always reachable in navigation. */
export function withAncestors(nodes: readonly MenuNode[], ids: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const id of ids) {
    result.add(id);
    for (const ancestor of ancestorIds(nodes, id)) result.add(ancestor);
  }
  return result;
}

/** Rejects moving `id` under `parentId` when `parentId` is `id` itself or one of its descendants. */
export function assertNoCycle(nodes: readonly MenuNode[], id: string, parentId: string | null): void {
  if (parentId === null) return;
  if (parentId === id || ancestorIds(nodes, parentId).includes(id)) {
    throw new DomainError('menu_cycle', 'A menu cannot be moved under itself or one of its sub-menus');
  }
}

/**
 * Refuses a tree in which every menu for the menu administration page is
 * unusable. When no such menu exists the rule does not apply (holders of
 * menus:access-all can still reach it).
 */
export function assertMenuAdminReachable(nodes: readonly MenuNode[]): void {
  const targets = nodes.filter((node) => node.path === MENU_ADMIN_PAGE);
  if (targets.length === 0) return;
  const inactive = inactiveMenuIds(nodes);
  if (targets.some((target) => !inactive.has(target.id))) return;
  throw new DomainError(
    'menu_admin_lockout',
    `This change would switch off the menu administration page (${MENU_ADMIN_PAGE}) and nobody could switch menus ` +
      'back on. Keep it active and under an active parent.',
  );
}

/** `nodes` with `replacement` swapped in (or appended when it is new). */
export function replaceNode(nodes: readonly MenuNode[], replacement: MenuNode): MenuNode[] {
  const others = nodes.filter((node) => node.id !== replacement.id);
  return [...others, replacement];
}
