import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';

export interface AuditLogView {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly outcome: 'success' | 'failure' | 'denied';
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly correlationId: string | null;
  readonly metadata: Record<string, unknown>;
}

export interface AuditLogFilter extends PageRequest {
  readonly actorUserId?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly outcome?: 'success' | 'failure' | 'denied';
  readonly from?: Date;
  readonly to?: Date;
}

export abstract class AuditLogReadRepository {
  abstract list(filter: AuditLogFilter): Promise<Page<AuditLogView>>;
}

export class GetAuditLogsQuery extends Query<Page<AuditLogView>> {
  constructor(
    readonly actor: Actor,
    readonly filter: AuditLogFilter,
  ) {
    super();
  }
}

@QueryHandler(GetAuditLogsQuery)
export class GetAuditLogsHandler implements IQueryHandler<GetAuditLogsQuery> {
  constructor(
    private readonly read: AuditLogReadRepository,
    private readonly accessControl: AccessControl,
  ) {}

  async execute({ actor, filter }: GetAuditLogsQuery): Promise<Page<AuditLogView>> {
    await this.accessControl.authorize(actor.userId, { permissions: ['audit:read'] });
    return this.read.list(filter);
  }
}
