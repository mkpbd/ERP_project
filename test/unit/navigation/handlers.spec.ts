import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CreateMenuCommand,
  DeleteMenuCommand,
  SetRoleMenusCommand,
  UpdateMenuCommand,
  type MenuInput,
} from '../../../src/modules/navigation/application/commands/navigation.commands.js';
import {
  CreateMenuHandler,
  DeleteMenuHandler,
  MENU_TREE_LOCK,
  SetRoleMenusHandler,
  UpdateMenuHandler,
} from '../../../src/modules/navigation/application/handlers/menu.handlers.js';
import { GetMyMenusHandler } from '../../../src/modules/navigation/application/handlers/navigation.query-handlers.js';
import { NavigationAccessService } from '../../../src/modules/navigation/application/navigation-access.service.js';
import { GetMyMenusQuery } from '../../../src/modules/navigation/application/queries/navigation.queries.js';
import { NavigationReadRepository, type MenuView } from '../../../src/modules/navigation/application/read-models.js';
import { Menu } from '../../../src/modules/navigation/domain/menu.js';
import { MENU_ADMIN_PAGE, type MenuNode } from '../../../src/modules/navigation/domain/menu-tree.js';
import { MenuRepository, RoleMenuRepository } from '../../../src/modules/navigation/domain/repositories.js';
import { MenuAccessGuard } from '../../../src/modules/navigation/presentation/menu-access.guard.js';
import type { AuthorizationProfile } from '../../../src/shared/application/contracts/access-control.js';
import { ForbiddenError } from '../../../src/shared/domain/errors.js';
import { MenuAccess } from '../../../src/shared/presentation/auth.decorators.js';
import { FixedClock, InlineTransactionManager, RecordingAuditTrail, StubAccessControl } from '../../support/fakes.js';

const actor = (userId: string) => ({ userId, sessionId: 'session' });

class MenuStore {
  readonly menus = new Map<string, Menu>();
  readonly grants = new Map<string, Set<string>>();
}

class FakeMenus extends MenuRepository {
  constructor(private readonly store: MenuStore) {
    super();
  }
  // Copies, like rows read from a database: a rejected change must not leak into the store.
  findById = (id: string) => {
    const menu = this.store.menus.get(id);
    return Promise.resolve(menu ? Menu.restore(menu.toSnapshot()) : null);
  };
  loadNodes = (): Promise<MenuNode[]> => Promise.resolve([...this.store.menus.values()].map((menu) => menu.node));
  insert = (menu: Menu) => {
    this.store.menus.set(menu.id, menu);
    return Promise.resolve();
  };
  update = this.insert;
  delete = (id: string) => {
    this.store.menus.delete(id);
    return Promise.resolve();
  };
  hasChildren = (id: string) => Promise.resolve([...this.store.menus.values()].some((menu) => menu.parentId === id));
}

class FakeRoleMenus extends RoleMenuRepository {
  constructor(private readonly store: MenuStore) {
    super();
  }
  menuIdsForRole = (roleId: string) => Promise.resolve([...(this.store.grants.get(roleId) ?? [])]);
  replace = (roleId: string, menuIds: readonly string[]) => {
    this.store.grants.set(roleId, new Set(menuIds));
    return Promise.resolve();
  };
}

class FakeNavigationRead extends NavigationReadRepository {
  constructor(private readonly store: MenuStore) {
    super();
  }
  listMenus = (): Promise<MenuView[]> =>
    Promise.resolve([...this.store.menus.values()].map((menu) => ({ ...menu.toSnapshot() })));
  allGrants = () =>
    Promise.resolve([...this.store.grants].flatMap(([roleId, ids]) => [...ids].map((menuId) => ({ roleId, menuId }))));
  menuIdsForRole = (roleId: string) => Promise.resolve([...(this.store.grants.get(roleId) ?? [])]);
}

/** StubAccessControl plus per-user role ids. */
class RoleAwareAccessControl extends StubAccessControl {
  readonly roleIds = new Map<string, string[]>();
  async getProfile(userId: string): Promise<AuthorizationProfile> {
    return { ...(await super.getProfile(userId)), roleIds: this.roleIds.get(userId) ?? [] };
  }
}

const input = (overrides: Partial<MenuInput> = {}): MenuInput => ({
  parentId: null,
  name: 'Menu',
  description: '',
  path: null,
  displayOrder: 0,
  isActive: true,
  icon: null,
  landingPageIconUrl: null,
  ...overrides,
});

let store: MenuStore;
let access: RoleAwareAccessControl;
let navigation: NavigationAccessService;
let tx: InlineTransactionManager;
let audit: RecordingAuditTrail;
let clock: FixedClock;
let menus: FakeMenus;

async function create(overrides: Partial<MenuInput> = {}): Promise<string> {
  const handler = new CreateMenuHandler(menus, access, navigation, tx, audit, clock);
  return (await handler.execute(new CreateMenuCommand(actor('root'), input(overrides)))).id;
}

beforeEach(() => {
  store = new MenuStore();
  access = new RoleAwareAccessControl();
  access.grant('root', 'menus:manage', 'menus:assign', 'menus:read', 'menus:access-all');
  navigation = new NavigationAccessService(new FakeNavigationRead(store), access, { cacheTtlSeconds: 60 });
  tx = new InlineTransactionManager();
  audit = new RecordingAuditTrail();
  clock = new FixedClock();
  menus = new FakeMenus(store);
});

describe('menu commands', () => {
  it('creates menus under the tree lock and audits them', async () => {
    const id = await create({ name: 'Pharmacy', path: '/Pharmacy' });
    expect(store.menus.get(id)?.path).toBe('/pharmacy');
    expect(tx.locks).toEqual([MENU_TREE_LOCK]);
    expect(audit.actions()).toEqual(['menu.created:success']);
  });

  it('requires menus:manage', async () => {
    const handler = new CreateMenuHandler(menus, access, navigation, tx, audit, clock);
    await expect(handler.execute(new CreateMenuCommand(actor('mallory'), input()))).rejects.toThrow(ForbiddenError);
  });

  it('refuses an unknown parent, cycles, and switching off the menu admin page', async () => {
    await expect(create({ parentId: '00000000-0000-4000-8000-000000000000' })).rejects.toThrow(/parent menu/);
    const settings = await create({ name: 'Settings' });
    const admin = await create({ name: 'Menus', parentId: settings, path: MENU_ADMIN_PAGE });
    const update = new UpdateMenuHandler(menus, access, navigation, tx, audit, clock);
    await expect(update.execute(new UpdateMenuCommand(actor('root'), settings, { parentId: admin }))).rejects.toThrow(
      /under itself/,
    );
    await expect(update.execute(new UpdateMenuCommand(actor('root'), settings, { isActive: false }))).rejects.toThrow(
      /menu administration page/,
    );
    expect(store.menus.get(settings)?.isActive).toBe(true);
  });

  it('refuses deleting a menu that has sub-menus', async () => {
    const parent = await create();
    await create({ parentId: parent });
    const handler = new DeleteMenuHandler(menus, access, navigation, tx, audit);
    await expect(handler.execute(new DeleteMenuCommand(actor('root'), parent))).rejects.toThrow(/sub-menus/);
  });

  it('drops the cached tree after a change', async () => {
    expect(await navigation.fullTree()).toHaveLength(0);
    await create();
    expect(await navigation.fullTree()).toHaveLength(1);
  });
});

describe('role menu grants', () => {
  it('grants ancestors with the listed menus', async () => {
    const parent = await create({ name: 'Pharmacy' });
    const child = await create({ name: 'Sales', parentId: parent, path: '/pharmacy/sales' });
    const handler = new SetRoleMenusHandler(menus, new FakeRoleMenus(store), access, navigation, tx, audit, clock);
    const result = await handler.execute(new SetRoleMenusCommand(actor('root'), 'cashier', [child]));
    expect(result.menuIds).toEqual([child, parent].sort());
    expect(audit.actions()).toContain('role.menus_changed:success');
  });

  it('blocks granting menus the actor cannot use (escalation)', async () => {
    const mine = await create({ name: 'Mine' });
    const theirs = await create({ name: 'Theirs' });
    store.grants.set('manager-role', new Set([mine]));
    access.grant('manager', 'menus:assign');
    access.roleIds.set('manager', ['manager-role']);
    const handler = new SetRoleMenusHandler(menus, new FakeRoleMenus(store), access, navigation, tx, audit, clock);

    await expect(handler.execute(new SetRoleMenusCommand(actor('manager'), 'clerk', [mine]))).resolves.toEqual({
      menuIds: [mine],
    });
    await expect(handler.execute(new SetRoleMenusCommand(actor('manager'), 'clerk', [theirs]))).rejects.toThrow(
      /menus you can use yourself/,
    );
    expect(access.invalidated).toContain('manager');
  });
});

describe('navigation for a user', () => {
  it('shows active held menus with their parents', async () => {
    const section = await create({ name: 'Pharmacy', displayOrder: 2 });
    const sales = await create({ name: 'Sales', parentId: section, path: '/pharmacy/sales' });
    await create({ name: 'Returns', parentId: section, path: '/pharmacy/returns' });
    const off = await create({ name: 'Old', path: '/old', isActive: false });
    store.grants.set('cashier-role', new Set([sales, off]));
    access.roleIds.set('jane', ['cashier-role']);
    navigation.invalidate();

    const mine = await new GetMyMenusHandler(navigation).execute(new GetMyMenusQuery(actor('jane')));
    expect(mine.map((menu) => [menu.name, menu.depth])).toEqual([
      ['Pharmacy', 0],
      ['Sales', 1],
    ]);
  });
});

describe('MenuAccessGuard', () => {
  class Controller {
    @MenuAccess('/Pharmacy/Sales')
    sell(): void {}
    open(): void {}
  }

  const contextFor = (handler: keyof Controller, userId = 'jane') =>
    ({
      getHandler: () => Controller.prototype[handler],
      getClass: () => Controller,
      switchToHttp: () => ({
        getRequest: () => ({ actor: actor(userId), method: 'POST', path: '/api/v1/sales' }),
      }),
    }) as unknown as ExecutionContext;

  it('lets unmarked routes through and enforces marked ones', async () => {
    const sales = await create({ name: 'Sales', path: '/pharmacy/sales' });
    const guard = new MenuAccessGuard(new Reflector(), navigation, audit);

    await expect(guard.canActivate(contextFor('open'))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor('sell'))).rejects.toThrow(/do not hold the menu/);
    expect(audit.actions()).toContain('authz.denied:denied');

    store.grants.set('cashier-role', new Set([sales]));
    access.roleIds.set('jane', ['cashier-role']);
    navigation.invalidate();
    await expect(guard.canActivate(contextFor('sell'))).resolves.toBe(true);
  });
});
