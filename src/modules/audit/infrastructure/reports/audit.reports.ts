import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { defineReport, type ReportDefinition } from '../../../../shared/application/reports.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { activitySummary, period, type ActivityReadRepository } from '../../application/activity.queries.js';
import type { AuditLogReadRepository } from '../../application/audit-log.queries.js';

const template = (name: string) => fileURLToPath(new URL(`./${name}.hbs`, import.meta.url));
const day = z.iso.date();
/** Rows printed at most. */
const MAX_ROWS = 5000;

/** Old HisActivityLog view printed: the audit log over days, by user, action or outcome, newest first. */
export function auditLogReport(read: AuditLogReadRepository, users: UserDirectory, timeZone: string): ReportDefinition {
  return defineReport({
    key: 'audit.log',
    title: 'Audit log',
    group: 'Administration',
    description: `What was done over days, by whom and with what outcome (at most ${MAX_ROWS} entries, newest first).`,
    params: z.strictObject({
      from: day,
      to: day,
      actorUserId: z.uuid().optional(),
      action: z.string().trim().min(1).max(100).optional(),
      outcome: z.enum(['success', 'failure', 'denied']).optional(),
    }),
    async load(params) {
      const [start, end] = period(params.from, params.to, timeZone);
      const page = await read.list({
        page: 1,
        pageSize: MAX_ROWS,
        from: start,
        to: new Date(end.getTime() - 1),
        ...(params.actorUserId ? { actorUserId: params.actorUserId } : {}),
        ...(params.action ? { action: params.action } : {}),
        ...(params.outcome ? { outcome: params.outcome } : {}),
      });
      const ids = [...new Set(page.items.flatMap((row) => (row.actorUserId ? [row.actorUserId] : [])))];
      const names = new Map(
        (ids.length ? await users.findSummaries(ids) : []).map((user) => [user.id, user.displayName]),
      );
      const rows = page.items.map((row) => ({
        occurredAt: row.occurredAt,
        user: row.actorUserId ? (names.get(row.actorUserId) ?? row.actorUserId) : '—',
        action: row.action,
        resource: row.resourceId ? `${row.resourceType} ${row.resourceId}` : row.resourceType,
        outcome: row.outcome,
        ipAddress: row.ipAddress,
      }));
      return { rows, total: page.total, cut: page.total > rows.length };
    },
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('audit-log'), landscape: true },
    xlsx: (data) => ({
      columns: [
        { key: 'occurredAt', header: 'When', format: 'datetime', width: 20 },
        { key: 'user', header: 'User', width: 24 },
        { key: 'action', header: 'Action', width: 30 },
        { key: 'resource', header: 'Resource', width: 40 },
        { key: 'outcome', header: 'Outcome', width: 10 },
        { key: 'ipAddress', header: 'IP', width: 16 },
      ],
      rows: data.rows,
    }),
  });
}

/** Old HealthSnapshot: activity over days by day, hour, module and action; the most active users. */
export function activitySummaryReport(
  read: ActivityReadRepository,
  users: UserDirectory,
  timeZone: string,
): ReportDefinition {
  return defineReport({
    key: 'audit.activity',
    title: 'Activity summary',
    group: 'Administration',
    description: 'Actions over days: per day and hour, by module and action, failures and denials, active users.',
    params: z.strictObject({ from: day, to: day }),
    load: (params) => activitySummary(read, users, timeZone, params.from, params.to),
    describe: (params) => `${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('activity') },
    xlsx: (data) => ({
      columns: [
        { key: 'day', header: 'Day', width: 12 },
        { key: 'total', header: 'Actions', format: 'integer' },
        { key: 'failures', header: 'Failures', format: 'integer' },
        { key: 'denied', header: 'Denied', format: 'integer' },
        { key: 'users', header: 'Users', format: 'integer' },
      ],
      rows: data.byDay,
    }),
  });
}

/** A user's sign-ins, successful and failed, with where from. */
export function signInsReport(read: ActivityReadRepository, users: UserDirectory, timeZone: string): ReportDefinition {
  return defineReport({
    key: 'audit.sign-ins',
    title: 'Sign-in history',
    group: 'Administration',
    description: "A user's sign-ins over days: when, from which address and browser, and why one failed.",
    params: z.strictObject({ userId: z.uuid(), from: day, to: day }),
    async load(params) {
      const [user] = await users.findSummaries([params.userId]);
      if (!user) throw new NotFoundError('user');
      const [start, end] = period(params.from, params.to, timeZone);
      const rows = await read.signIns(params.userId, start, end);
      return {
        user: { name: user.displayName, email: user.email },
        rows,
        failed: rows.filter((row) => row.outcome !== 'success').length,
      };
    },
    describe: (params, data) => `${data.user.name} · ${params.from} to ${params.to}`,
    pdf: { engine: 'html', template: template('sign-ins') },
    xlsx: (data) => ({
      columns: [
        { key: 'occurredAt', header: 'When', format: 'datetime', width: 20 },
        { key: 'outcome', header: 'Outcome', width: 10 },
        { key: 'reason', header: 'Reason', width: 20 },
        { key: 'ipAddress', header: 'IP', width: 16 },
        { key: 'userAgent', header: 'Browser', width: 50 },
      ],
      rows: data.rows.map((row) => ({ ...row })),
    }),
  });
}
