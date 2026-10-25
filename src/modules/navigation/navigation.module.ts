import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import {
  CreateMenuHandler,
  DeleteMenuHandler,
  SetRoleMenusHandler,
  UpdateMenuHandler,
} from './application/handlers/menu.handlers.js';
import {
  GetMenuHandler,
  GetMyMenusHandler,
  GetRoleMenusHandler,
  ListMenusHandler,
  ResolveMenuPathHandler,
} from './application/handlers/navigation.query-handlers.js';
import { NavigationAccessService } from './application/navigation-access.service.js';
import { NAVIGATION_SETTINGS, NavigationReadRepository } from './application/read-models.js';
import { MenuRepository, RoleMenuRepository } from './domain/repositories.js';
import {
  DrizzleMenuRepository,
  DrizzleRoleMenuRepository,
} from './infrastructure/persistence/drizzle-menu.repository.js';
import { DrizzleNavigationReadRepository } from './infrastructure/persistence/drizzle-navigation-read.repository.js';
import { MenusController, RoleMenusController } from './presentation/menus.controllers.js';
import { MenuAccessGuard } from './presentation/menu-access.guard.js';

/** Menu tree, role menu grants and page-level access (@MenuAccess). Ported from the old API's Menus feature. */
@Module({
  controllers: [MenusController, RoleMenusController],
  providers: [
    CreateMenuHandler,
    UpdateMenuHandler,
    DeleteMenuHandler,
    SetRoleMenusHandler,
    ListMenusHandler,
    GetMenuHandler,
    GetMyMenusHandler,
    ResolveMenuPathHandler,
    GetRoleMenusHandler,
    NavigationAccessService,
    MenuAccessGuard,
    {
      provide: NAVIGATION_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ cacheTtlSeconds: config.auth.permissionCacheTtlSeconds }),
    },
    { provide: MenuRepository, useClass: DrizzleMenuRepository },
    { provide: RoleMenuRepository, useClass: DrizzleRoleMenuRepository },
    { provide: NavigationReadRepository, useClass: DrizzleNavigationReadRepository },
  ],
  exports: [MenuAccessGuard],
})
export class NavigationModule {}
