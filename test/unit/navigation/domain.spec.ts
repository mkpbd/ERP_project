import { describe, expect, it } from 'vitest';
import { Menu, normalizeMenuPath } from '../../../src/modules/navigation/domain/menu.js';
import {
  ancestorIds,
  assertMenuAdminReachable,
  assertNoCycle,
  inactiveMenuIds,
  MENU_ADMIN_PAGE,
  withAncestors,
  type MenuNode,
} from '../../../src/modules/navigation/domain/menu-tree.js';
import { evaluatePageAccess } from '../../../src/modules/navigation/domain/page-access.js';
import { DomainError } from '../../../src/shared/domain/errors.js';

const now = new Date('2026-01-01T00:00:00Z');
const node = (id: string, parentId: string | null, isActive = true, path: string | null = null): MenuNode => ({
  id,
  parentId,
  isActive,
  path,
});

describe('normalizeMenuPath', () => {
  it('matches the old API rule', () => {
    expect(normalizeMenuPath(' HR/Staffs/ ')).toBe('/hr/staffs');
    expect(normalizeMenuPath('/opd/vital-sign?tab=1#x')).toBe('/opd/vital-sign');
    expect(normalizeMenuPath('/a//')).toBe('/a');
  });

  it('treats blank and root as "no page"', () => {
    expect(normalizeMenuPath('')).toBeNull();
    expect(normalizeMenuPath('  / ')).toBeNull();
    expect(normalizeMenuPath(null)).toBeNull();
  });
});

describe('Menu', () => {
  const base = {
    id: 'm1',
    parentId: null,
    name: ' Pharmacy ',
    description: '',
    path: 'Pharmacy/Sales',
    displayOrder: 1,
    isActive: true,
    icon: ' ',
    landingPageIconUrl: null,
    now,
  };

  it('trims and normalizes on create', () => {
    const snapshot = Menu.create(base).toSnapshot();
    expect(snapshot).toMatchObject({ name: 'Pharmacy', path: '/pharmacy/sales', icon: null });
  });

  it('rejects invalid values', () => {
    expect(() => Menu.create({ ...base, name: '  ' })).toThrow(DomainError);
    expect(() => Menu.create({ ...base, displayOrder: -1 })).toThrow(DomainError);
    expect(() => Menu.create({ ...base, parentId: 'm1' })).toThrow(/own parent/);
  });

  it('updates only the given fields', () => {
    const menu = Menu.create(base);
    menu.update({ isActive: false }, new Date('2026-02-01T00:00:00Z'));
    expect(menu.toSnapshot()).toMatchObject({ isActive: false, name: 'Pharmacy', path: '/pharmacy/sales' });
  });
});

describe('menu tree rules', () => {
  const tree = [node('root', null), node('a', 'root', false), node('a1', 'a'), node('b', 'root'), node('b1', 'b')];

  it('marks menus under an inactive parent as inactive', () => {
    expect([...inactiveMenuIds(tree)].sort()).toEqual(['a', 'a1']);
  });

  it('survives cycles and broken links', () => {
    const broken = [node('x', 'y'), node('y', 'x'), node('z', 'missing')];
    expect(inactiveMenuIds(broken).size).toBe(0);
    expect(ancestorIds(broken, 'x')).toEqual(['y']);
  });

  it('adds ancestors to granted menus', () => {
    expect([...withAncestors(tree, ['b1', 'a1'])].sort()).toEqual(['a', 'a1', 'b', 'b1', 'root']);
  });

  it('refuses moving a menu under its own descendant', () => {
    expect(() => assertNoCycle(tree, 'b', 'b1')).toThrow(/under itself/);
    expect(() => assertNoCycle(tree, 'b', 'b')).toThrow(DomainError);
    expect(() => assertNoCycle(tree, 'b1', 'a')).not.toThrow();
  });

  it('refuses switching off the menu administration page', () => {
    const admin = [node('settings', null), node('menus', 'settings', true, MENU_ADMIN_PAGE)];
    expect(() => assertMenuAdminReachable(admin)).not.toThrow();
    expect(() => assertMenuAdminReachable([node('settings', null, false), admin[1]!])).toThrow(/menu_admin|switch off/);
    expect(() => assertMenuAdminReachable([admin[0]!])).not.toThrow();
  });
});

describe('page access', () => {
  const nodes = [node('sec', null), node('page', 'sec', true, '/pharmacy/sales'), node('off', 'sec', false, '/old')];
  const input = {
    nodes,
    inactive: inactiveMenuIds(nodes),
    heldMenuIds: new Set(['page']),
    accessAll: false,
  };

  it('allows a held, active page', () => {
    expect(evaluatePageAccess({ ...input, pages: ['/pharmacy/sales'] })).toEqual({ allowed: true });
  });

  it('refuses a page whose menu is not held', () => {
    expect(evaluatePageAccess({ ...input, heldMenuIds: new Set(), pages: ['/pharmacy/sales'] })).toMatchObject({
      allowed: false,
      code: 'menu_not_granted',
    });
  });

  it('refuses an inactive page even with menus:access-all', () => {
    expect(evaluatePageAccess({ ...input, accessAll: true, pages: ['/old'] })).toMatchObject({
      allowed: false,
      code: 'menu_inactive',
    });
  });

  it('keeps pages without a menu for menus:access-all holders', () => {
    expect(evaluatePageAccess({ ...input, pages: ['/nowhere'] })).toMatchObject({ code: 'menu_admin_only' });
    expect(evaluatePageAccess({ ...input, accessAll: true, pages: ['/nowhere'] })).toEqual({ allowed: true });
  });

  it('passes when any listed page is usable', () => {
    expect(evaluatePageAccess({ ...input, pages: ['/old', '/pharmacy/sales'] })).toEqual({ allowed: true });
  });
});
