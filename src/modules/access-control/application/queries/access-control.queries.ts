import { Query } from '@nestjs/cqrs';
import type { Actor } from '../../../../shared/application/actor.js';
import type { EffectivePermissionsView, PermissionView, RoleView, UserRoleView } from '../read-models.js';

export class ListRolesQuery extends Query<RoleView[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class GetRoleQuery extends Query<RoleView> {
  constructor(
    readonly actor: Actor,
    readonly roleId: string,
  ) {
    super();
  }
}

export class ListPermissionsQuery extends Query<PermissionView[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class GetUserRolesQuery extends Query<UserRoleView[]> {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
  ) {
    super();
  }
}

export class GetUserPermissionsQuery extends Query<EffectivePermissionsView> {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
  ) {
    super();
  }
}
