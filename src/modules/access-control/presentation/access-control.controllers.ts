import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
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
  AssignUserRoleCommand,
  CreateRoleCommand,
  DeleteRoleCommand,
  GrantRolePermissionsCommand,
  RevokeRolePermissionCommand,
  RevokeUserRoleCommand,
  UpdateRoleCommand,
} from '../application/commands/access-control.commands.js';
import {
  GetRoleQuery,
  GetUserPermissionsQuery,
  GetUserRolesQuery,
  ListPermissionsQuery,
  ListRolesQuery,
} from '../application/queries/access-control.queries.js';
import type { EffectivePermissionsView, PermissionView, RoleView, UserRoleView } from '../application/read-models.js';
import {
  AssignRoleDto,
  CreateRoleDto,
  EffectivePermissionsResponseDto,
  GrantedPermissionsResponseDto,
  GrantPermissionsDto,
  PermissionResponseDto,
  RolePermissionParamDto,
  RoleResponseDto,
  UpdateRoleDto,
  UserRoleParamDto,
  UserRoleResponseDto,
} from './dto/access-control.dto.js';

@ApiTags('roles')
@ApiBearerAuth()
@Controller({ path: 'roles', version: '1' })
export class RolesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('roles:read')
  @ApiOperation({ summary: 'List roles with their permissions' })
  @ApiOkResponse({ type: RoleResponseDto, isArray: true })
  list(@CurrentUser() actor: Actor): Promise<RoleView[]> {
    return this.queryBus.execute(new ListRolesQuery(actor));
  }

  @Post()
  @RequirePermissions('roles:create')
  @ApiOperation({
    summary: 'Create a role. Initial permissions also need permissions:assign and must all be held by you.',
  })
  @ApiCreatedResponse({ type: RoleResponseDto })
  async create(@CurrentUser() actor: Actor, @Body() dto: CreateRoleDto): Promise<RoleView> {
    const { id } = await this.commandBus.execute(
      new CreateRoleCommand(actor, dto.name, dto.description, dto.permissions),
    );
    return this.queryBus.execute(new GetRoleQuery(actor, id));
  }

  @Get(':id')
  @RequirePermissions('roles:read')
  @ApiOkResponse({ type: RoleResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<RoleView> {
    return this.queryBus.execute(new GetRoleQuery(actor, params.id));
  }

  @Patch(':id')
  @RequirePermissions('roles:update')
  @ApiOperation({ summary: 'Rename or describe a role (system roles are immutable)' })
  @ApiOkResponse({ type: RoleResponseDto })
  async update(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleView> {
    await this.commandBus.execute(new UpdateRoleCommand(actor, params.id, dto));
    return this.queryBus.execute(new GetRoleQuery(actor, params.id));
  }

  @Delete(':id')
  @RequirePermissions('roles:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an unassigned, non-system role' })
  @ApiNoContentResponse()
  async remove(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<void> {
    await this.commandBus.execute(new DeleteRoleCommand(actor, params.id));
  }

  @Get(':id/permissions')
  @RequirePermissions('roles:read')
  @ApiOkResponse({ schema: { type: 'array', items: { type: 'string' } } })
  async permissions(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<string[]> {
    const role = await this.queryBus.execute(new GetRoleQuery(actor, params.id));
    return role.permissions;
  }

  @Post(':id/permissions')
  @RequirePermissions('permissions:assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Grant permissions to a role. You must hold every permission you grant.' })
  @ApiOkResponse({ type: GrantedPermissionsResponseDto })
  grant(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: GrantPermissionsDto,
  ): Promise<{ granted: string[] }> {
    return this.commandBus.execute(new GrantRolePermissionsCommand(actor, params.id, dto.permissions));
  }

  @Delete(':id/permissions/:permission')
  @RequirePermissions('permissions:assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async revoke(@CurrentUser() actor: Actor, @Param() params: RolePermissionParamDto): Promise<void> {
    await this.commandBus.execute(new RevokeRolePermissionCommand(actor, params.id, params.permission));
  }
}

@ApiTags('permissions')
@ApiBearerAuth()
@Controller({ path: 'permissions', version: '1' })
export class PermissionsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @RequirePermissions('permissions:read')
  @ApiOkResponse({ type: PermissionResponseDto, isArray: true })
  list(@CurrentUser() actor: Actor): Promise<PermissionView[]> {
    return this.queryBus.execute(new ListPermissionsQuery(actor));
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UserAccessController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get(':id/roles')
  @ApiOperation({ summary: "A user's roles. Requires permissions:read unless it is yourself." })
  @ApiOkResponse({ type: UserRoleResponseDto, isArray: true })
  roles(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<UserRoleView[]> {
    return this.queryBus.execute(new GetUserRolesQuery(actor, params.id));
  }

  @Post(':id/roles')
  @RequirePermissions('permissions:assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Assign a role. You must hold every permission in the role.' })
  @ApiNoContentResponse()
  async assign(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: AssignRoleDto): Promise<void> {
    await this.commandBus.execute(new AssignUserRoleCommand(actor, params.id, dto.roleId));
  }

  @Delete(':id/roles/:roleId')
  @RequirePermissions('permissions:assign')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a role. The last active super-admin cannot lose the role.' })
  @ApiNoContentResponse()
  async unassign(@CurrentUser() actor: Actor, @Param() params: UserRoleParamDto): Promise<void> {
    await this.commandBus.execute(new RevokeUserRoleCommand(actor, params.id, params.roleId));
  }

  @Get(':id/permissions')
  @ApiOperation({ summary: "A user's effective permissions. Requires permissions:read unless it is yourself." })
  @ApiOkResponse({ type: EffectivePermissionsResponseDto })
  permissions(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<EffectivePermissionsView> {
    return this.queryBus.execute(new GetUserPermissionsQuery(actor, params.id));
  }
}
