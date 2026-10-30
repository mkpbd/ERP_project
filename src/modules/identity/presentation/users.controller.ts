import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
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
import type { Page } from '../../../shared/application/pagination.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  ActivateUserCommand,
  CreateUserCommand,
  DeactivateUserCommand,
  RevokeUserSessionsCommand,
  UpdateUserCommand,
} from '../application/commands/user.commands.js';
import {
  GetCurrentUserQuery,
  GetUserByIdQuery,
  ListUserSessionsQuery,
  ListUsersQuery,
} from '../application/queries/user.queries.js';
import type { CurrentUserView, SessionView, UserView } from '../application/read-models.js';
import {
  CreatedResponseDto,
  CreateUserDto,
  CurrentUserResponseDto,
  ListUsersQueryDto,
  RevokedCountResponseDto,
  SessionResponseDto,
  UpdateUserDto,
  UserPageResponseDto,
  UserResponseDto,
} from './dto/identity.dto.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller({ path: 'users', version: '1' })
export class UsersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Current user with effective roles and permissions' })
  @ApiOkResponse({ type: CurrentUserResponseDto })
  me(@CurrentUser() actor: Actor): Promise<CurrentUserView> {
    return this.queryBus.execute(new GetCurrentUserQuery(actor));
  }

  @Patch('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update your own profile' })
  @ApiNoContentResponse()
  async updateMe(@CurrentUser() actor: Actor, @Body() dto: UpdateUserDto): Promise<void> {
    await this.commandBus.execute(new UpdateUserCommand(actor, actor.userId, dto.displayName));
  }

  @Get()
  @RequirePermissions('users:read')
  @ApiOperation({ summary: 'List users (paginated, filterable)' })
  @ApiOkResponse({ type: UserPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: ListUsersQueryDto): Promise<Page<UserView>> {
    return this.queryBus.execute(new ListUsersQuery(actor, query));
  }

  @Post()
  @RequirePermissions('users:create')
  @ApiOperation({ summary: 'Create a user (email pre-verified)' })
  @ApiCreatedResponse({ type: CreatedResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateUserDto): Promise<{ id: string }> {
    return this.commandBus.execute(
      new CreateUserCommand(actor, dto.email, dto.password, dto.displayName, dto.username ?? null),
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a user. Requires users:read unless it is yourself.' })
  @ApiOkResponse({ type: UserResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<UserView> {
    return this.queryBus.execute(new GetUserByIdQuery(actor, params.id));
  }

  @Patch(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Update a user. Requires users:update unless it is yourself.' })
  @ApiNoContentResponse()
  async update(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: UpdateUserDto): Promise<void> {
    await this.commandBus.execute(new UpdateUserCommand(actor, params.id, dto.displayName));
  }

  @Post(':id/deactivate')
  @RequirePermissions('users:deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate a user and revoke their sessions' })
  @ApiNoContentResponse()
  async deactivate(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<void> {
    await this.commandBus.execute(new DeactivateUserCommand(actor, params.id));
  }

  @Post(':id/activate')
  @RequirePermissions('users:deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Reactivate a user' })
  @ApiNoContentResponse()
  async activate(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<void> {
    await this.commandBus.execute(new ActivateUserCommand(actor, params.id));
  }

  @Get(':id/sessions')
  @RequirePermissions('users:read')
  @ApiOperation({ summary: "A user's active sessions: when, from where, last used" })
  @ApiOkResponse({ type: SessionResponseDto, isArray: true })
  sessions(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<SessionView[]> {
    return this.queryBus.execute(new ListUserSessionsQuery(actor, params.id));
  }

  @Delete(':id/sessions')
  @RequirePermissions('sessions:revoke')
  @ApiOperation({ summary: "Revoke all of a user's sessions" })
  @ApiOkResponse({ type: RevokedCountResponseDto })
  revokeSessions(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<{ revoked: number }> {
    return this.commandBus.execute(new RevokeUserSessionsCommand(actor, params.id));
  }
}
