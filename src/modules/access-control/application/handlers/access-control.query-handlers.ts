import { QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { AccessControlService } from '../access-control.service.js';
import {
  GetRoleQuery,
  GetUserPermissionsQuery,
  GetUserRolesQuery,
  ListPermissionsQuery,
  ListRolesQuery,
} from '../queries/access-control.queries.js';
import {
  AccessReadRepository,
  type EffectivePermissionsView,
  type PermissionView,
  type RoleView,
  type UserRoleView,
} from '../read-models.js';

@QueryHandler(ListRolesQuery)
export class ListRolesHandler implements IQueryHandler<ListRolesQuery> {
  constructor(
    private readonly read: AccessReadRepository,
    private readonly access: AccessControlService,
  ) {}

  async execute({ actor }: ListRolesQuery): Promise<RoleView[]> {
    await this.access.authorize(actor.userId, { permissions: ['roles:read'] });
    return this.read.listRoles();
  }
}

@QueryHandler(GetRoleQuery)
export class GetRoleHandler implements IQueryHandler<GetRoleQuery> {
  constructor(
    private readonly read: AccessReadRepository,
    private readonly access: AccessControlService,
  ) {}

  async execute({ actor, roleId }: GetRoleQuery): Promise<RoleView> {
    await this.access.authorize(actor.userId, { permissions: ['roles:read'] });
    const role = await this.read.getRole(roleId);
    if (!role) throw new NotFoundError('role');
    return role;
  }
}

@QueryHandler(ListPermissionsQuery)
export class ListPermissionsHandler implements IQueryHandler<ListPermissionsQuery> {
  constructor(
    private readonly read: AccessReadRepository,
    private readonly access: AccessControlService,
  ) {}

  async execute({ actor }: ListPermissionsQuery): Promise<PermissionView[]> {
    await this.access.authorize(actor.userId, { permissions: ['permissions:read'] });
    return this.read.listPermissions();
  }
}

@QueryHandler(GetUserRolesQuery)
export class GetUserRolesHandler implements IQueryHandler<GetUserRolesQuery> {
  constructor(
    private readonly read: AccessReadRepository,
    private readonly access: AccessControlService,
  ) {}

  async execute({ actor, userId }: GetUserRolesQuery): Promise<UserRoleView[]> {
    await this.access.authorize(actor.userId, { permissions: ['permissions:read'], ownerId: userId });
    return this.read.listUserRoles(userId);
  }
}

@QueryHandler(GetUserPermissionsQuery)
export class GetUserPermissionsHandler implements IQueryHandler<GetUserPermissionsQuery> {
  constructor(
    private readonly read: AccessReadRepository,
    private readonly access: AccessControlService,
  ) {}

  async execute({ actor, userId }: GetUserPermissionsQuery): Promise<EffectivePermissionsView> {
    await this.access.authorize(actor.userId, { permissions: ['permissions:read'], ownerId: userId });
    const profile = await this.read.getProfile(userId);
    return { userId, roles: profile.roles, permissions: profile.permissions };
  }
}
