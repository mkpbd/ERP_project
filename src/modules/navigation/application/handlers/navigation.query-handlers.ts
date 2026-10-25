import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../../shared/application/contracts/access-control.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { normalizeMenuPath } from '../../domain/menu.js';
import { NavigationAccessService } from '../navigation-access.service.js';
import {
  GetMenuQuery,
  GetMyMenusQuery,
  GetRoleMenusQuery,
  ListMenusQuery,
  ResolveMenuPathQuery,
} from '../queries/navigation.queries.js';
import {
  NavigationReadRepository,
  type MenuTrailView,
  type MenuTreeItemView,
  type RoleMenusView,
} from '../read-models.js';

@QueryHandler(ListMenusQuery)
export class ListMenusHandler implements IQueryHandler<ListMenusQuery> {
  constructor(
    private readonly navigation: NavigationAccessService,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor }: ListMenusQuery): Promise<MenuTreeItemView[]> {
    await this.access.authorize(actor.userId, { permissions: ['menus:read'] });
    return this.navigation.fullTree();
  }
}

@QueryHandler(GetMenuQuery)
export class GetMenuHandler implements IQueryHandler<GetMenuQuery> {
  constructor(
    private readonly navigation: NavigationAccessService,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, menuId }: GetMenuQuery): Promise<MenuTreeItemView> {
    await this.access.authorize(actor.userId, { permissions: ['menus:read'] });
    const menu = (await this.navigation.fullTree()).find((item) => item.id === menuId);
    if (!menu) throw new NotFoundError('menu');
    return menu;
  }
}

@QueryHandler(GetMyMenusQuery)
export class GetMyMenusHandler implements IQueryHandler<GetMyMenusQuery> {
  constructor(private readonly navigation: NavigationAccessService) {}

  execute({ actor }: GetMyMenusQuery): Promise<MenuTreeItemView[]> {
    return this.navigation.visibleTree(actor.userId);
  }
}

@QueryHandler(ResolveMenuPathQuery)
export class ResolveMenuPathHandler implements IQueryHandler<ResolveMenuPathQuery> {
  constructor(private readonly navigation: NavigationAccessService) {}

  async execute({ actor, path }: ResolveMenuPathQuery): Promise<MenuTrailView> {
    const normalized = normalizeMenuPath(path);
    const visible = await this.navigation.visibleTree(actor.userId);
    const menu = visible.find((item) => normalized !== null && item.path === normalized);
    if (!menu) throw new NotFoundError('menu');
    const byId = new Map(visible.map((item) => [item.id, item]));
    const ancestors: MenuTreeItemView[] = [];
    for (let parent = menu.parentId; parent !== null;) {
      const item = byId.get(parent);
      if (!item || ancestors.includes(item)) break;
      ancestors.unshift(item);
      parent = item.parentId;
    }
    return { menu, ancestors };
  }
}

@QueryHandler(GetRoleMenusQuery)
export class GetRoleMenusHandler implements IQueryHandler<GetRoleMenusQuery> {
  constructor(
    private readonly read: NavigationReadRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, roleId }: GetRoleMenusQuery): Promise<RoleMenusView> {
    await this.access.authorize(actor.userId, { permissions: ['menus:read'] });
    if (!(await this.access.roleExists(roleId))) throw new NotFoundError('role');
    return { roleId, menuIds: (await this.read.menuIdsForRole(roleId)).sort() };
  }
}
