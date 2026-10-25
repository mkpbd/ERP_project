import { Global, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { AccessControl } from '../../shared/application/contracts/access-control.js';
import { AccessControlService } from './application/access-control.service.js';
import { PermissionCacheInvalidationHandler } from './application/events/permission-cache.handlers.js';
import {
  GetRoleHandler,
  GetUserPermissionsHandler,
  GetUserRolesHandler,
  ListPermissionsHandler,
  ListRolesHandler,
} from './application/handlers/access-control.query-handlers.js';
import {
  AssignUserRoleHandler,
  RevokeUserRoleHandler,
  SyncPermissionCatalogHandler,
} from './application/handlers/assignment.handlers.js';
import {
  CreateRoleHandler,
  DeleteRoleHandler,
  GrantRolePermissionsHandler,
  RevokeRolePermissionHandler,
  UpdateRoleHandler,
} from './application/handlers/role.handlers.js';
import { ACCESS_CONTROL_SETTINGS, AccessReadRepository } from './application/read-models.js';
import { PermissionRepository, RoleRepository, UserRoleRepository } from './domain/repositories.js';
import { DrizzleAccessReadRepository } from './infrastructure/persistence/drizzle-access-read.repository.js';
import {
  DrizzlePermissionRepository,
  DrizzleRoleRepository,
  DrizzleUserRoleRepository,
} from './infrastructure/persistence/drizzle-role.repository.js';
import {
  PermissionsController,
  RolesController,
  UserAccessController,
} from './presentation/access-control.controllers.js';
import { AuthorizationGuard } from './presentation/authorization.guard.js';

/** Roles, permissions and the authorization policy. Publishes the AccessControl contract. */
@Global()
@Module({
  controllers: [RolesController, PermissionsController, UserAccessController],
  providers: [
    CreateRoleHandler,
    UpdateRoleHandler,
    DeleteRoleHandler,
    GrantRolePermissionsHandler,
    RevokeRolePermissionHandler,
    AssignUserRoleHandler,
    RevokeUserRoleHandler,
    SyncPermissionCatalogHandler,
    ListRolesHandler,
    GetRoleHandler,
    ListPermissionsHandler,
    GetUserRolesHandler,
    GetUserPermissionsHandler,
    PermissionCacheInvalidationHandler,
    AccessControlService,
    AuthorizationGuard,
    { provide: AccessControl, useExisting: AccessControlService },
    {
      provide: ACCESS_CONTROL_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ profileCacheTtlSeconds: config.auth.permissionCacheTtlSeconds }),
    },
    { provide: RoleRepository, useClass: DrizzleRoleRepository },
    { provide: UserRoleRepository, useClass: DrizzleUserRoleRepository },
    { provide: PermissionRepository, useClass: DrizzlePermissionRepository },
    { provide: AccessReadRepository, useClass: DrizzleAccessReadRepository },
  ],
  exports: [AccessControl, AuthorizationGuard],
})
export class AccessControlModule implements OnApplicationBootstrap {
  constructor(private readonly syncCatalog: SyncPermissionCatalogHandler) {}

  /** Keeps the permissions table and the super-admin role in step with the code catalog. */
  async onApplicationBootstrap(): Promise<void> {
    await this.syncCatalog.execute();
  }
}
