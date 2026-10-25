import { randomUUID } from 'node:crypto';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../../shared/application/contracts/access-control.js';
import { AuditTrail } from '../../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../../shared/application/ports/transaction-manager.js';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../../shared/domain/errors.js';
import { Menu } from '../../domain/menu.js';
import { assertMenuAdminReachable, assertNoCycle, replaceNode, withAncestors } from '../../domain/menu-tree.js';
import { MenuRepository, RoleMenuRepository } from '../../domain/repositories.js';
import {
  CreateMenuCommand,
  DeleteMenuCommand,
  SetRoleMenusCommand,
  UpdateMenuCommand,
} from '../commands/navigation.commands.js';
import { NavigationAccessService } from '../navigation-access.service.js';

/** Serializes menu tree changes so tree rules are checked against what is committed. */
export const MENU_TREE_LOCK = 'navigation:menu-tree';

@CommandHandler(CreateMenuCommand)
export class CreateMenuHandler implements ICommandHandler<CreateMenuCommand> {
  constructor(
    private readonly menus: MenuRepository,
    private readonly access: AccessControl,
    private readonly navigation: NavigationAccessService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, input }: CreateMenuCommand): Promise<{ id: string }> {
    await this.access.authorize(actor.userId, { permissions: ['menus:manage'] });
    const menu = Menu.create({ id: randomUUID(), ...input, now: this.clock.now() });
    await this.tx.run(async () => {
      await this.tx.lock(MENU_TREE_LOCK);
      const nodes = await this.menus.loadNodes();
      if (menu.parentId !== null && !nodes.some((node) => node.id === menu.parentId)) {
        throw new NotFoundError('parent_menu');
      }
      assertMenuAdminReachable(replaceNode(nodes, menu.node));
      await this.menus.insert(menu);
      await this.audit.record({
        action: 'menu.created',
        actorUserId: actor.userId,
        resourceType: 'menu',
        resourceId: menu.id,
        metadata: { name: menu.name, path: menu.path },
      });
    });
    this.navigation.invalidate();
    return { id: menu.id };
  }
}

@CommandHandler(UpdateMenuCommand)
export class UpdateMenuHandler implements ICommandHandler<UpdateMenuCommand> {
  constructor(
    private readonly menus: MenuRepository,
    private readonly access: AccessControl,
    private readonly navigation: NavigationAccessService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, menuId, changes }: UpdateMenuCommand): Promise<void> {
    await this.access.authorize(actor.userId, { permissions: ['menus:manage'] });
    await this.tx.run(async () => {
      await this.tx.lock(MENU_TREE_LOCK);
      const menu = await this.menus.findById(menuId);
      if (!menu) throw new NotFoundError('menu');
      menu.update(changes, this.clock.now());
      const nodes = await this.menus.loadNodes();
      if (changes.parentId !== undefined && menu.parentId !== null) {
        if (!nodes.some((node) => node.id === menu.parentId)) throw new NotFoundError('parent_menu');
        assertNoCycle(nodes, menu.id, menu.parentId);
      }
      assertMenuAdminReachable(replaceNode(nodes, menu.node));
      await this.menus.update(menu);
      await this.audit.record({
        action: 'menu.updated',
        actorUserId: actor.userId,
        resourceType: 'menu',
        resourceId: menuId,
        metadata: { fields: Object.keys(changes).sort() },
      });
    });
    this.navigation.invalidate();
  }
}

@CommandHandler(DeleteMenuCommand)
export class DeleteMenuHandler implements ICommandHandler<DeleteMenuCommand> {
  constructor(
    private readonly menus: MenuRepository,
    private readonly access: AccessControl,
    private readonly navigation: NavigationAccessService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
  ) {}

  async execute({ actor, menuId }: DeleteMenuCommand): Promise<void> {
    await this.access.authorize(actor.userId, { permissions: ['menus:manage'] });
    await this.tx.run(async () => {
      await this.tx.lock(MENU_TREE_LOCK);
      const menu = await this.menus.findById(menuId);
      if (!menu) throw new NotFoundError('menu');
      if (await this.menus.hasChildren(menuId)) {
        throw new ConflictError('menu_has_children', 'Delete or move its sub-menus first');
      }
      const nodes = await this.menus.loadNodes();
      assertMenuAdminReachable(nodes.filter((node) => node.id !== menuId));
      await this.menus.delete(menuId);
      await this.audit.record({
        action: 'menu.deleted',
        actorUserId: actor.userId,
        resourceType: 'menu',
        resourceId: menuId,
        metadata: { name: menu.name, path: menu.path },
      });
    });
    this.navigation.invalidate();
  }
}

@CommandHandler(SetRoleMenusCommand)
export class SetRoleMenusHandler implements ICommandHandler<SetRoleMenusCommand> {
  constructor(
    private readonly menus: MenuRepository,
    private readonly roleMenus: RoleMenuRepository,
    private readonly access: AccessControl,
    private readonly navigation: NavigationAccessService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, roleId, menuIds }: SetRoleMenusCommand): Promise<{ menuIds: string[] }> {
    const caller = await this.navigation.callerMenusFresh(actor.userId);
    await this.access.authorize(actor.userId, { permissions: ['menus:assign'] });
    const granted = await this.tx.run(async () => {
      await this.tx.lock(MENU_TREE_LOCK);
      if (!(await this.access.roleExists(roleId))) throw new NotFoundError('role');
      const nodes = await this.menus.loadNodes();
      const known = new Set(nodes.map((node) => node.id));
      if (menuIds.some((id) => !known.has(id))) throw new NotFoundError('menu');

      const desired = withAncestors(nodes, menuIds);
      const current = new Set(await this.roleMenus.menuIdsForRole(roleId));
      const added = [...desired].filter((id) => !current.has(id)).sort();
      const removed = [...current].filter((id) => !desired.has(id)).sort();
      // Menus gate endpoints (@MenuAccess), so handing one out is handing out access.
      if (!caller.accessAll && [...added, ...removed].some((id) => !caller.held.has(id))) {
        throw new ForbiddenError('privilege_escalation', 'You can only grant or remove menus you can use yourself');
      }
      if (added.length > 0 || removed.length > 0) {
        await this.roleMenus.replace(roleId, [...desired], actor.userId, this.clock.now());
        await this.audit.record({
          action: 'role.menus_changed',
          actorUserId: actor.userId,
          resourceType: 'role',
          resourceId: roleId,
          metadata: { added, removed },
        });
      }
      return [...desired].sort();
    });
    this.navigation.invalidate();
    return { menuIds: granted };
  }
}
