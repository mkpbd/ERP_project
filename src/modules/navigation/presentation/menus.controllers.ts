import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  CreateMenuCommand,
  DeleteMenuCommand,
  SetRoleMenusCommand,
  UpdateMenuCommand,
} from '../application/commands/navigation.commands.js';
import {
  GetMenuQuery,
  GetMyMenusQuery,
  GetRoleMenusQuery,
  ListMenusQuery,
  ResolveMenuPathQuery,
} from '../application/queries/navigation.queries.js';
import type { MenuTrailView, MenuTreeItemView, RoleMenusView } from '../application/read-models.js';
import {
  CreateMenuDto,
  GrantedMenusResponseDto,
  MenuResponseDto,
  MenuTrailResponseDto,
  ResolveMenuQueryDto,
  RoleMenusResponseDto,
  SetRoleMenusDto,
  UpdateMenuDto,
} from './dto/navigation.dto.js';

@ApiTags('menus')
@ApiBearerAuth()
@Controller({ path: 'menus', version: '1' })
export class MenusController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('menus:read')
  @ApiOperation({ summary: 'Every menu in tree order (depth-first, siblings by display order)' })
  @ApiOkResponse({ type: MenuResponseDto, isArray: true })
  list(@CurrentUser() actor: Actor): Promise<MenuTreeItemView[]> {
    return this.queryBus.execute(new ListMenusQuery(actor));
  }

  // Declared before ':id' so the literal segments win.
  @Get('me')
  @ApiOperation({ summary: 'Your navigation: active menus your roles hold, with their parents, in tree order' })
  @ApiOkResponse({ type: MenuResponseDto, isArray: true })
  mine(@CurrentUser() actor: Actor): Promise<MenuTreeItemView[]> {
    return this.queryBus.execute(new GetMyMenusQuery(actor));
  }

  @Get('resolve')
  @ApiOperation({ summary: 'The menu you can use for a frontend route, with its ancestors (breadcrumbs)' })
  @ApiOkResponse({ type: MenuTrailResponseDto })
  resolve(@CurrentUser() actor: Actor, @Query() query: ResolveMenuQueryDto): Promise<MenuTrailView> {
    return this.queryBus.execute(new ResolveMenuPathQuery(actor, query.path));
  }

  @Post()
  @RequirePermissions('menus:manage')
  @ApiOperation({ summary: 'Create a menu. The path is stored normalized (leading slash, lower case).' })
  @ApiCreatedResponse({ type: MenuResponseDto })
  async create(@CurrentUser() actor: Actor, @Body() dto: CreateMenuDto): Promise<MenuTreeItemView> {
    const { id } = await this.commandBus.execute(new CreateMenuCommand(actor, dto));
    return this.queryBus.execute(new GetMenuQuery(actor, id));
  }

  @Get(':id')
  @RequirePermissions('menus:read')
  @ApiOkResponse({ type: MenuResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<MenuTreeItemView> {
    return this.queryBus.execute(new GetMenuQuery(actor, params.id));
  }

  @Patch(':id')
  @RequirePermissions('menus:manage')
  @ApiOperation({ summary: 'Edit, move, activate or deactivate a menu' })
  @ApiOkResponse({ type: MenuResponseDto })
  async update(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: UpdateMenuDto,
  ): Promise<MenuTreeItemView> {
    await this.commandBus.execute(new UpdateMenuCommand(actor, params.id, dto));
    return this.queryBus.execute(new GetMenuQuery(actor, params.id));
  }

  @Delete(':id')
  @RequirePermissions('menus:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a menu without sub-menus. Role grants for it are removed.' })
  @ApiNoContentResponse()
  async remove(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<void> {
    await this.commandBus.execute(new DeleteMenuCommand(actor, params.id));
  }
}

@ApiTags('roles')
@ApiBearerAuth()
@Controller({ path: 'roles', version: '1' })
export class RoleMenusController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get(':id/menus')
  @RequirePermissions('menus:read')
  @ApiOkResponse({ type: RoleMenusResponseDto })
  menus(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<RoleMenusView> {
    return this.queryBus.execute(new GetRoleMenusQuery(actor, params.id));
  }

  @Put(':id/menus')
  @RequirePermissions('menus:assign')
  @ApiOperation({
    summary:
      "Replace a role's menus. Parents of listed menus are granted too. " +
      'Without menus:access-all you can only add or remove menus you can use yourself.',
  })
  @ApiOkResponse({ type: GrantedMenusResponseDto })
  setMenus(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: SetRoleMenusDto,
  ): Promise<{ menuIds: string[] }> {
    return this.commandBus.execute(new SetRoleMenusCommand(actor, params.id, dto.menuIds));
  }
}
