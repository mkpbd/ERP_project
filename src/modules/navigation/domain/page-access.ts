import type { MenuNode } from './menu-tree.js';

export type PageAccessDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: 'menu_inactive' | 'menu_admin_only' | 'menu_not_granted';
      readonly message: string;
    };

export interface PageAccessInput {
  /** Normalized page paths that legitimately call the endpoint. */
  readonly pages: readonly string[];
  readonly nodes: readonly MenuNode[];
  readonly inactive: ReadonlySet<string>;
  /** Menus granted to any of the caller's roles. */
  readonly heldMenuIds: ReadonlySet<string>;
  /** menus:access-all: passes the grant check, never the active check. */
  readonly accessAll: boolean;
}

/**
 * Page-level access, ported from the old API's MenuAccess filter: the page's
 * menu (and every menu above it) must be active, and one of the caller's
 * roles must hold it.
 */
export function evaluatePageAccess(input: PageAccessInput): PageAccessDecision {
  const pages = new Set(input.pages);
  const label = input.pages.join(' / ');
  const pageMenus = input.nodes.filter((node) => node.path !== null && pages.has(node.path)).map((node) => node.id);
  const usable = pageMenus.filter((id) => !input.inactive.has(id));

  if (pageMenus.length > 0 && usable.length === 0) {
    return { allowed: false, code: 'menu_inactive', message: `The menu for ${label} is switched off` };
  }
  if (input.accessAll) return { allowed: true };
  if (pageMenus.length === 0) {
    return { allowed: false, code: 'menu_admin_only', message: `No menu exists for ${label}; administrators only` };
  }
  if (!usable.some((id) => input.heldMenuIds.has(id))) {
    return { allowed: false, code: 'menu_not_granted', message: `Your roles do not hold the menu for ${label}` };
  }
  return { allowed: true };
}
