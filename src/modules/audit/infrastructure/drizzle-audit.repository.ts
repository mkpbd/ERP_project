import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, lte, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../database/drizzle-transaction-manager.js';
import { offsetOf, toPage, type Page } from '../../../shared/application/pagination.js';
import { AuditTrail, type AuditEntry } from '../../../shared/application/ports/audit-trail.js';
import { RequestContext } from '../../../shared/infrastructure/request-context.js';
import { AuditLogReadRepository, type AuditLogFilter, type AuditLogView } from '../application/audit-log.queries.js';
import { auditLogs } from './persistence/audit.schema.js';

/** Writes through the ambient transaction and enriches entries with request metadata. */
@Injectable()
export class DrizzleAuditTrail extends AuditTrail {
  constructor(private readonly context: DbContext) {
    super();
  }

  async record(entry: AuditEntry): Promise<void> {
    const request = RequestContext.current();
    await this.context.db.insert(auditLogs).values({
      id: randomUUID(),
      actorUserId: entry.actorUserId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      outcome: entry.outcome ?? 'success',
      ipAddress: request?.ipAddress ?? null,
      userAgent: request?.userAgent?.slice(0, 512) ?? null,
      requestId: request?.requestId ?? null,
      correlationId: request?.correlationId ?? null,
      metadata: entry.metadata ?? {},
    });
  }
}

@Injectable()
export class DrizzleAuditLogReadRepository extends AuditLogReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async list(filter: AuditLogFilter): Promise<Page<AuditLogView>> {
    const conditions: SQL[] = [];
    if (filter.actorUserId) conditions.push(eq(auditLogs.actorUserId, filter.actorUserId));
    if (filter.action) conditions.push(eq(auditLogs.action, filter.action));
    if (filter.resourceType) conditions.push(eq(auditLogs.resourceType, filter.resourceType));
    if (filter.resourceId) conditions.push(eq(auditLogs.resourceId, filter.resourceId));
    if (filter.outcome) conditions.push(eq(auditLogs.outcome, filter.outcome));
    if (filter.from) conditions.push(gte(auditLogs.occurredAt, filter.from));
    if (filter.to) conditions.push(lte(auditLogs.occurredAt, filter.to));
    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, totals] = await Promise.all([
      this.context.db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ total: count() }).from(auditLogs).where(where),
    ]);
    return toPage(rows, totals[0]?.total ?? 0, filter);
  }
}
