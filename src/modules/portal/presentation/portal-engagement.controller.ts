import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { AuthRateLimit, Public } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto, responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  PortalChatMessagesQuery,
  PortalChatsQuery,
  PortalSendChatCommand,
  PortalStartChatCommand,
  PortalTipsQuery,
} from '../application/portal-engagement.handlers.js';
import type { PortalClaims } from '../application/portal.ports.js';
import { CurrentPatient, PortalGuard } from './portal.guard.js';

class PortalTipQueryDto extends createZodDto(z.object({ category: z.string().trim().min(1).max(60).optional() })) {}
class PortalChatStartDto extends createZodDto(
  z.strictObject({ topic: z.string().max(150), text: z.string().max(2000) }),
) {}
class PortalChatTextDto extends createZodDto(z.strictObject({ text: z.string().max(2000) })) {}
class PortalAfterQueryDto extends createZodDto(
  z.object({
    after: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
  }),
) {}

class PortalTipsResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      titleBn: z.string().nullable(),
      summary: z.string().nullable(),
      summaryBn: z.string().nullable(),
      body: z.string(),
      bodyBn: z.string().nullable(),
      category: z.string().nullable(),
      imageUrl: z.string().nullable(),
      isPinned: z.boolean(),
    }),
  ),
}) {}
class PortalChatsResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      topic: z.string(),
      status: z.enum(['open', 'closed']),
      startedAt: z.date(),
      lastMessageAt: z.date(),
      unread: z.int(),
    }),
  ),
}) {}
class PortalMessagesResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      sender: z.enum(['patient', 'staff']),
      senderName: z.string(),
      text: z.string(),
      sentAt: z.date(),
    }),
  ),
}) {}
class PortalChatIdResponseDto extends responseDto({ id: z.uuid() }) {}

/** Health tips for anyone, and the signed-in patient's chats with the hospital (old LiveChat). */
@ApiTags('portal')
@Public()
@Controller({ path: 'portal', version: '1' })
export class PortalEngagementController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('health-tips')
  @ApiOperation({ summary: 'Health tips being published, pinned first (no sign-in needed)' })
  @ApiOkResponse({ type: PortalTipsResponseDto })
  async tips(@Query() query: PortalTipQueryDto) {
    return { items: await this.queryBus.execute(new PortalTipsQuery(query.category ?? null)) };
  }

  @Get('chats')
  @UseGuards(PortalGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: PortalChatsResponseDto })
  async chats(@CurrentPatient() patient: PortalClaims) {
    return { items: await this.queryBus.execute(new PortalChatsQuery(patient)) };
  }

  @Post('chats')
  @UseGuards(PortalGuard)
  @AuthRateLimit()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start a chat with its first message (at most 3 open at once)' })
  @ApiCreatedResponse({ type: PortalChatIdResponseDto })
  start(@CurrentPatient() patient: PortalClaims, @Body() dto: PortalChatStartDto) {
    return this.commandBus.execute(new PortalStartChatCommand(patient, dto.topic, dto.text));
  }

  @Get('chats/:id/messages')
  @UseGuards(PortalGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Messages after a moment (for polling), oldest first; the staff ones are then read' })
  @ApiOkResponse({ type: PortalMessagesResponseDto })
  async messages(
    @CurrentPatient() patient: PortalClaims,
    @Param() params: IdParamDto,
    @Query() query: PortalAfterQueryDto,
  ) {
    return { items: await this.queryBus.execute(new PortalChatMessagesQuery(patient, params.id, query.after ?? null)) };
  }

  @Post('chats/:id/messages')
  @UseGuards(PortalGuard)
  @ApiBearerAuth()
  @ApiCreatedResponse({ type: PortalChatIdResponseDto })
  send(@CurrentPatient() patient: PortalClaims, @Param() params: IdParamDto, @Body() dto: PortalChatTextDto) {
    return this.commandBus.execute(new PortalSendChatCommand(patient, params.id, dto.text));
  }
}
