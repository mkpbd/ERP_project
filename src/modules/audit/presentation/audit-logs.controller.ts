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
import { ActivitySummaryQuery, SignInHistoryQuery } from '../application/activity.queries.js';
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

const day = z.iso.date();
class AuditPeriodQueryDto extends createZodDto(z.object({ from: day, to: day })) {}
class AuditSignInQueryDto extends createZodDto(z.object({ userId: z.uuid(), from: day, to: day })) {}
const count = z.int();
class AuditActivityResponseDto extends responseDto({
  from: z.string(),
  to: z.string(),
  totals: z.object({ total: count, failures: count, denied: count, users: count }),
  byDay: z.array(z.object({ day: z.string(), total: count, failures: count, denied: count, users: count })),
  byHour: z.array(z.object({ hour: count, total: count })),
  byModule: z.array(z.object({ module: z.string(), total: count, failures: count })),
  topActions: z.array(z.object({ action: z.string(), total: count, failures: count })),
  topUsers: z.array(z.object({ userId: z.uuid(), name: z.string(), total: count })),
}) {}
class AuditSignInsResponseDto extends responseDto({
  items: z.array(
    z.object({
      occurredAt: isoDate,
      outcome,
      reason: z.string().nullable(),
      ipAddress: z.string().nullable(),
      userAgent: z.string().nullable(),
    }),
  ),
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

  @Get('summary')
  @RequirePermissions('audit:read')
  @ApiOperation({ summary: 'Activity over days: per day and hour, by module and action, failures, active users' })
  @ApiOkResponse({ type: AuditActivityResponseDto })
  summary(@CurrentUser() actor: Actor, @Query() query: AuditPeriodQueryDto) {
    return this.queryBus.execute(new ActivitySummaryQuery(actor, query.from, query.to));
  }

  @Get('sign-ins')
  @ApiOperation({ summary: "A user's sign-ins, successful and failed (audit:read, or one's own)" })
  @ApiOkResponse({ type: AuditSignInsResponseDto })
  async signIns(@CurrentUser() actor: Actor, @Query() query: AuditSignInQueryDto) {
    return { items: await this.queryBus.execute(new SignInHistoryQuery(actor, query.userId, query.from, query.to)) };
  }
}
