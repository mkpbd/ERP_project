import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  type Type,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../application/actor.js';
import {
  CreateRecordCommand,
  DeleteRecordCommand,
  GetRecordQuery,
  ListRecordsQuery,
  UpdateRecordCommand,
  type RecordFilter,
} from '../application/records.js';
import { CurrentUser, RequirePermissions, type PermissionName } from './auth.decorators.js';
import { IdParamDto } from './zod/common.schemas.js';
import { createZodDto, type ZodDtoClass } from './zod/zod-dto.js';

export class NoFilterDto extends createZodDto(z.object({})) {}

export interface RecordControllerOptions {
  /** Class name, also used in OpenAPI operation ids (e.g. `ServiceUnitsController`). */
  readonly className: string;
  /** Route below /api/v1 (e.g. `admin/service-units`). */
  readonly path: string;
  readonly tag: string;
  /** Registered RecordType name. */
  readonly type: string;
  /** Human-readable singular, for summaries ("service unit"). */
  readonly label: string;
  readonly create: ZodDtoClass;
  readonly update: ZodDtoClass;
  readonly response: ZodDtoClass;
  readonly filter?: ZodDtoClass;
  /** Omit when any signed-in user may read. Must match the RecordType. */
  readonly readPermission?: PermissionName;
  readonly managePermission: PermissionName;
}

/**
 * Builds the standard CRUD controller for a RecordType:
 * GET /, GET /:id, POST /, PATCH /:id, DELETE /:id.
 * Validation and OpenAPI come from the given Zod DTOs.
 */
export function createRecordController(options: RecordControllerOptions): Type<unknown> {
  const { type } = options;

  @ApiTags(options.tag)
  @ApiBearerAuth()
  @Controller({ path: options.path, version: '1' })
  class RecordController {
    constructor(
      private readonly commandBus: CommandBus,
      private readonly queryBus: QueryBus,
    ) {}

    list(actor: Actor, filter: RecordFilter): Promise<unknown[]> {
      return this.queryBus.execute(new ListRecordsQuery(type, actor, filter));
    }

    get(actor: Actor, params: IdParamDto): Promise<unknown> {
      return this.queryBus.execute(new GetRecordQuery(type, actor, params.id));
    }

    async create(actor: Actor, dto: object): Promise<unknown> {
      const { id } = await this.commandBus.execute(new CreateRecordCommand(type, actor, dto));
      return this.queryBus.execute(new GetRecordQuery(type, actor, id));
    }

    async update(actor: Actor, params: IdParamDto, dto: object): Promise<unknown> {
      await this.commandBus.execute(new UpdateRecordCommand(type, actor, params.id, dto));
      return this.queryBus.execute(new GetRecordQuery(type, actor, params.id));
    }

    async remove(actor: Actor, params: IdParamDto): Promise<void> {
      await this.commandBus.execute(new DeleteRecordCommand(type, actor, params.id));
    }
  }
  Object.defineProperty(RecordController, 'name', { value: options.className });

  const read = options.readPermission ? [RequirePermissions(options.readPermission)] : [];
  const manage = RequirePermissions(options.managePermission);
  const { label, response } = options;

  route(RecordController, 'list', {
    decorators: [
      Get(),
      ...read,
      ApiOperation({ summary: `List ${label} records` }),
      ApiOkResponse({ type: response, isArray: true }),
    ],
    params: [CurrentUser(), Query()],
    types: [Object, options.filter ?? NoFilterDto],
  });
  route(RecordController, 'get', {
    decorators: [Get(':id'), ...read, ApiOperation({ summary: `Get a ${label}` }), ApiOkResponse({ type: response })],
    params: [CurrentUser(), Param()],
    types: [Object, IdParamDto],
  });
  route(RecordController, 'create', {
    decorators: [
      Post(),
      manage,
      ApiOperation({ summary: `Create a ${label}` }),
      ApiCreatedResponse({ type: response }),
    ],
    params: [CurrentUser(), Body()],
    types: [Object, options.create],
  });
  route(RecordController, 'update', {
    decorators: [Patch(':id'), manage, ApiOperation({ summary: `Edit a ${label}` }), ApiOkResponse({ type: response })],
    params: [CurrentUser(), Param(), Body()],
    types: [Object, IdParamDto, options.update],
  });
  route(RecordController, 'remove', {
    decorators: [
      Delete(':id'),
      manage,
      HttpCode(HttpStatus.NO_CONTENT),
      ApiOperation({ summary: `Delete a ${label} that nothing refers to` }),
      ApiNoContentResponse(),
    ],
    params: [CurrentUser(), Param()],
    types: [Object, IdParamDto],
  });

  return RecordController;
}

/**
 * Applies what `@Get() method(@CurrentUser() actor, @Body() dto: Dto)` would
 * apply, including the parameter types the validation pipe and Swagger read.
 */
function route(
  target: Type<unknown>,
  method: string,
  spec: { decorators: MethodDecorator[]; params: ParameterDecorator[]; types: unknown[] },
): void {
  const prototype = target.prototype as object;
  Reflect.defineMetadata('design:paramtypes', spec.types, prototype, method);
  spec.params.forEach((decorator, index) => decorator(prototype, method, index));
  const descriptor = Object.getOwnPropertyDescriptor(prototype, method);
  if (!descriptor) throw new Error(`${target.name} has no method ${method}`);
  // Decorators apply bottom-up, as they would when written above the method.
  for (const decorator of [...spec.decorators].reverse()) decorator(prototype, method, descriptor);
}
