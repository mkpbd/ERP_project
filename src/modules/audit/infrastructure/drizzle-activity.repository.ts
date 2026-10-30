import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { DbContext } from '../../../database/drizzle-transaction-manager.js';
import { ActivityReadRepository, type SignIn } from '../application/activity.queries.js';
import { auditLogs } from './persistence/audit.schema.js';

const total = sql<number>`count(*)`.mapWith(Number);
const failures = sql<number>`count(*) filter (where ${auditLogs.outcome} = 'failure')`.mapWith(Number);
const denied = sql<number>`count(*) filter (where ${auditLogs.outcome} = 'denied')`.mapWith(Number);
const users = sql<number>`count(distinct ${auditLogs.actorUserId})`.mapWith(Number);

/** Counts of the audit log over a period, for the activity summary and sign-in history. */
@Injectable()
export class DrizzleActivityReadRepository extends ActivityReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async summary(from: Date, to: Date, timeZone: string) {
    const within = and(gte(auditLogs.occurredAt, from), lt(auditLogs.occurredAt, to));
    // Grouped by position: the time zone is a parameter, so the same expression in GROUP BY would not match.
    const local = sql`(${auditLogs.occurredAt} at time zone ${timeZone})`;
    const day = sql<string>`to_char(${local}, 'YYYY-MM-DD')`;
    const hour = sql<number>`extract(hour from ${local})::int`.mapWith(Number);
    const module = sql<string>`split_part(${auditLogs.action}, '.', 1)`;
    const [totals] = await this.context.db.select({ total, failures, denied, users }).from(auditLogs).where(within);
    const byDay = await this.context.db
      .select({ day, total, failures, denied, users })
      .from(auditLogs)
      .where(within)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const byHour = await this.context.db
      .select({ hour, total })
      .from(auditLogs)
      .where(within)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    const byModule = await this.context.db
      .select({ module, total, failures })
      .from(auditLogs)
      .where(within)
      .groupBy(sql`1`)
      .orderBy(desc(total), sql`1`);
    const topActions = await this.context.db
      .select({ action: auditLogs.action, total, failures })
      .from(auditLogs)
      .where(within)
      .groupBy(auditLogs.action)
      .orderBy(desc(total), asc(auditLogs.action))
      .limit(20);
    const topUsers = await this.context.db
      .select({ userId: sql<string>`${auditLogs.actorUserId}`, total })
      .from(auditLogs)
      .where(and(within, isNotNull(auditLogs.actorUserId)))
      .groupBy(auditLogs.actorUserId)
      .orderBy(desc(total))
      .limit(10);
    return {
      totals: totals ?? { total: 0, failures: 0, denied: 0, users: 0 },
      byDay,
      byHour,
      byModule,
      topActions,
      topUsers,
    };
  }

  async signIns(userId: string, from: Date, to: Date): Promise<SignIn[]> {
    const rows = await this.context.db
      .select({
        occurredAt: auditLogs.occurredAt,
        outcome: auditLogs.outcome,
        metadata: auditLogs.metadata,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'auth.login'),
          eq(auditLogs.actorUserId, userId),
          gte(auditLogs.occurredAt, from),
          lt(auditLogs.occurredAt, to),
        ),
      )
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1000);
    return rows.map(({ metadata, ...row }) => ({
      ...row,
      reason: typeof metadata['reason'] === 'string' ? metadata['reason'] : null,
    }));
  }
}
