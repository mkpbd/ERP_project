import { Controller, Get, Query } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page } from '../../../shared/application/pagination.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import {
  isoDate,
  pageMetaShape,
  paginationShape,
  responseDto,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import { GetAuditLogsQuery, type AuditLogView } from '../application/audit-log.queries.js';

const outcome = z.enum(['success', 'failure', 'denied']);

export class AuditLogQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    actorUserId: z.uuid().optional(),
    action: z.string().max(100).optional(),
    resourceType: z.string().max(50).optional(),
    resourceId: z.string().max(200).optional(),
    outcome: outcome.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
) {}

const auditLogShape = {
  id: z.uuid(),
  occurredAt: isoDate,
  actorUserId: z.uuid().nullable(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string().nullable(),
  outcome,
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  correlationId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
};

export class AuditLogPageResponseDto extends responseDto({
  items: z.array(z.object(auditLogShape)),
  ...pageMetaShape,
}) {}

@ApiTags('audit')
@ApiBearerAuth()
@Controller({ path: 'audit-logs', version: '1' })
export class AuditLogsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Search the audit log, newest first' })
  @ApiOkResponse({ type: AuditLogPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: AuditLogQueryDto): Promise<Page<AuditLogView>> {
    return this.queryBus.execute(new GetAuditLogsQuery(actor, query));
  }
}
