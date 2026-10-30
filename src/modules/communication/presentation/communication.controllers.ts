import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
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
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import {
  IdParamDto,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  ChatActionCommand,
  MyNoticesQuery,
  ReadNoticeCommand,
  SendNoticeCommand,
  SentNoticesQuery,
  StaffChatMessagesQuery,
  StaffChatsQuery,
} from '../application/communication.handlers.js';
import { COMMUNICATION_RECORDS } from '../application/communication.ports.js';

const moment = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const tipFields = {
  title: z.string().trim().min(1).max(200),
  titleBn: z.string().trim().max(200).nullable(),
  summary: z.string().trim().max(500).nullable(),
  summaryBn: z.string().trim().max(500).nullable(),
  body: z.string().trim().min(1).max(10_000),
  bodyBn: z.string().trim().max(10_000).nullable(),
  category: z.string().trim().max(60).nullable(),
  imageUrl: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullable(),
  isPinned: z.boolean(),
  displayOrder: z.int().min(0).max(1000),
  publishFrom: moment.nullable(),
  publishTo: moment.nullable(),
  isActive: z.boolean(),
};
const tipCreate = z
  .strictObject({
    ...tipFields,
    titleBn: tipFields.titleBn.default(null),
    summary: tipFields.summary.default(null),
    summaryBn: tipFields.summaryBn.default(null),
    bodyBn: tipFields.bodyBn.default(null),
    category: tipFields.category.default(null),
    imageUrl: tipFields.imageUrl.default(null),
    isPinned: z.boolean().default(false),
    displayOrder: tipFields.displayOrder.default(0),
    publishFrom: tipFields.publishFrom.default(null),
    publishTo: tipFields.publishTo.default(null),
    isActive: z.boolean().default(true),
  })
  .refine((tip) => !tip.publishFrom || !tip.publishTo || tip.publishFrom < tip.publishTo, {
    message: 'The window ends after it starts',
    path: ['publishTo'],
  });
class CommCreateTipDto extends createZodDto(tipCreate) {}
class CommUpdateTipDto extends createZodDto(updateSchema(tipFields)) {}
class CommTipFilterDto extends createZodDto(
  z.object({
    q: z.string().trim().min(1).max(100).optional(),
    category: z.string().trim().min(1).max(60).optional(),
    isActive: z.enum(['true', 'false']).optional(),
  }),
) {}
class CommTipResponseDto extends responseDto(
  recordResponseShape({ ...tipFields, publishFrom: z.date().nullable(), publishTo: z.date().nullable() }),
) {}

/** Old Others.HealthTip: what the patient portal shows patients. */
export const HealthTipsController = createRecordController({
  tag: 'communication',
  readPermission: 'content:manage',
  managePermission: 'content:manage',
  className: 'HealthTipsController',
  path: 'communication/health-tips',
  type: COMMUNICATION_RECORDS.healthTip,
  label: 'health tip',
  create: CommCreateTipDto,
  update: CommUpdateTipDto,
  response: CommTipResponseDto,
  filter: CommTipFilterDto,
});

class CommNoticeDto extends createZodDto(
  z
    .strictObject({
      title: z.string().max(150),
      body: z.string().max(4000),
      userIds: z.array(z.uuid()).max(2000).default([]),
      roleIds: z.array(z.uuid()).max(50).default([]),
    })
    .refine((notice) => notice.userIds.length + notice.roleIds.length > 0, {
      message: 'Name users or roles',
      path: ['userIds'],
    }),
) {}
class CommMyNoticesQueryDto extends createZodDto(
  z.object({
    unread: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  }),
) {}
class CommChatsQueryDto extends createZodDto(
  z.object({
    status: z.enum(['open', 'closed']).optional(),
    mine: z
      .enum(['true', 'false'])
      .optional()
      .transform((value) => value === 'true'),
  }),
) {}
class CommAfterQueryDto extends createZodDto(z.object({ after: moment.optional() })) {}
class CommReplyDto extends createZodDto(z.strictObject({ text: z.string().max(2000) })) {}

const noticeShape = {
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  sentBy: z.uuid(),
  sentAt: z.date(),
};
const messageShape = z.object({
  id: z.uuid(),
  sender: z.enum(['patient', 'staff']),
  senderName: z.string(),
  text: z.string(),
  sentAt: z.date(),
});
class CommNoticeSentResponseDto extends responseDto({ id: z.uuid(), recipients: z.int() }) {}
class CommMyNoticesResponseDto extends responseDto({
  items: z.array(z.object({ ...noticeShape, readAt: z.date().nullable() })),
  unread: z.int(),
}) {}
class CommSentNoticesResponseDto extends responseDto({
  items: z.array(z.object({ ...noticeShape, recipients: z.int(), read: z.int() })),
}) {}
class CommChatsResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      patientId: z.uuid(),
      patientName: z.string(),
      uhid: z.int().nullable(),
      topic: z.string(),
      status: z.enum(['open', 'closed']),
      assignedTo: z.uuid().nullable(),
      startedAt: z.date(),
      lastMessageAt: z.date(),
      closedAt: z.date().nullable(),
      unread: z.int(),
    }),
  ),
}) {}
class CommMessagesResponseDto extends responseDto({ items: z.array(messageShape) }) {}
class CommMessageIdResponseDto extends responseDto({ id: z.uuid() }) {}

@ApiTags('communication')
@ApiBearerAuth()
@Controller({ path: 'communication', version: '1' })
export class CommunicationController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('notices')
  @RequirePermissions('notice:send')
  @ApiOperation({ summary: 'A notice to users named and users holding the roles named (active ones, each once)' })
  @ApiCreatedResponse({ type: CommNoticeSentResponseDto })
  send(@CurrentUser() actor: Actor, @Body() dto: CommNoticeDto) {
    return this.commandBus.execute(new SendNoticeCommand(actor, dto));
  }

  @Get('notices/sent')
  @RequirePermissions('notice:send')
  @ApiOkResponse({ type: CommSentNoticesResponseDto })
  async sent(@CurrentUser() actor: Actor) {
    return { items: await this.queryBus.execute(new SentNoticesQuery(actor)) };
  }

  @Get('notices/mine')
  @ApiOperation({ summary: 'My notices, newest first, and how many are unread (any signed-in user)' })
  @ApiOkResponse({ type: CommMyNoticesResponseDto })
  mine(@CurrentUser() actor: Actor, @Query() query: CommMyNoticesQueryDto) {
    return this.queryBus.execute(new MyNoticesQuery(actor, query.unread));
  }

  @Post('notices/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async read(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    await this.commandBus.execute(new ReadNoticeCommand(actor, params.id));
  }

  @Get('chats')
  @RequirePermissions('chat:answer')
  @ApiOperation({ summary: "Patients' chats by state, or mine, with messages not read" })
  @ApiOkResponse({ type: CommChatsResponseDto })
  async chats(@CurrentUser() actor: Actor, @Query() query: CommChatsQueryDto) {
    return { items: await this.queryBus.execute(new StaffChatsQuery(actor, query.status, query.mine)) };
  }

  @Get('chats/:id/messages')
  @RequirePermissions('chat:answer')
  @ApiOperation({ summary: 'Messages (after a moment, for polling); read by the agent who has the chat' })
  @ApiOkResponse({ type: CommMessagesResponseDto })
  async messages(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Query() query: CommAfterQueryDto) {
    return { items: await this.queryBus.execute(new StaffChatMessagesQuery(actor, params.id, query.after ?? null)) };
  }

  @Post('chats/:id/take')
  @RequirePermissions('chat:answer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take the chat (over)' })
  @ApiNoContentResponse()
  async take(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    await this.commandBus.execute(new ChatActionCommand(actor, params.id, 'take', null));
  }

  @Post('chats/:id/messages')
  @RequirePermissions('chat:answer')
  @ApiOperation({ summary: "Reply: an unassigned chat becomes mine; another's is taken over first" })
  @ApiCreatedResponse({ type: CommMessageIdResponseDto })
  reply(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CommReplyDto) {
    return this.commandBus.execute(new ChatActionCommand(actor, params.id, 'reply', dto.text));
  }

  @Post('chats/:id/close')
  @RequirePermissions('chat:answer')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async close(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    await this.commandBus.execute(new ChatActionCommand(actor, params.id, 'close', null));
  }
}

export const COMMUNICATION_CONTROLLERS = [HealthTipsController, CommunicationController];
