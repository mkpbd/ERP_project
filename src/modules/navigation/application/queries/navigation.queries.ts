import { Query } from '@nestjs/cqrs';
import type { Actor } from '../../../../shared/application/actor.js';
import type { MenuTrailView, MenuTreeItemView, RoleMenusView } from '../read-models.js';

/** Every menu, active or not, in tree order. */
export class ListMenusQuery extends Query<MenuTreeItemView[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class GetMenuQuery extends Query<MenuTreeItemView> {
  constructor(
    readonly actor: Actor,
    readonly menuId: string,
  ) {
    super();
  }
}

/** The caller's navigation: active menus their roles hold, in tree order. */
export class GetMyMenusQuery extends Query<MenuTreeItemView[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

/** The caller-visible menu for a frontend route, with its ancestors (breadcrumbs). */
export class ResolveMenuPathQuery extends Query<MenuTrailView> {
  constructor(
    readonly actor: Actor,
    readonly path: string,
  ) {
    super();
  }
}

export class GetRoleMenusQuery extends Query<RoleMenusView> {
  constructor(
    readonly actor: Actor,
    readonly roleId: string,
  ) {
    super();
  }
}
