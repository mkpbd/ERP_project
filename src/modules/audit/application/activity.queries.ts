import { Inject } from '@nestjs/common';
import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { UserDirectory } from '../../../shared/application/contracts/user-directory.js';
import { DomainError } from '../../../shared/domain/errors.js';
import { dayBounds } from '../../../shared/domain/zoned-time.js';

/** Days asked of the log at most at once. */
export const MAX_DAYS = 366;

export interface ActivitySummary {
  readonly from: string;
  readonly to: string;
  readonly totals: {
    readonly total: number;
    readonly failures: number;
    readonly denied: number;
    readonly users: number;
  };
  readonly byDay: {
    readonly day: string;
    readonly total: number;
    readonly failures: number;
    readonly denied: number;
    readonly users: number;
  }[];
  /** Hour of day (0–23, the organisation's time). */
  readonly byHour: { readonly hour: number; readonly total: number }[];
  /** The part of the action before its first dot: auth, user, clinical … */
  readonly byModule: { readonly module: string; readonly total: number; readonly failures: number }[];
  readonly topActions: { readonly action: string; readonly total: number; readonly failures: number }[];
  /** The most active users. */
  readonly topUsers: { readonly userId: string; readonly name: string; readonly total: number }[];
}

export interface SignIn {
  readonly occurredAt: Date;
  readonly outcome: 'success' | 'failure' | 'denied';
  readonly reason: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export abstract class ActivityReadRepository {
  /** Counts over [from, to), days and hours in the time zone. */
  abstract summary(
    from: Date,
    to: Date,
    timeZone: string,
  ): Promise<Omit<ActivitySummary, 'from' | 'to' | 'topUsers'> & { topUsers: { userId: string; total: number }[] }>;
  abstract signIns(userId: string, from: Date, to: Date): Promise<SignIn[]>;
}

export const AUDIT_SETTINGS = Symbol('AUDIT_SETTINGS');
export interface AuditSettings {
  readonly timeZone: string;
}

/** [start of the first day, start of the day after the last) in the time zone; at most MAX_DAYS days. */
export function period(from: string, to: string, timeZone: string): [Date, Date] {
  if (from > to) throw new DomainError('invalid_period', 'The start date is after the end date');
  const start = dayBounds(from, timeZone)[0];
  const end = dayBounds(to, timeZone)[1];
  if ((end.getTime() - start.getTime()) / 86_400_000 > MAX_DAYS + 1) {
    throw new DomainError('invalid_period', `Ask for at most ${MAX_DAYS} days at once`);
  }
  return [start, end];
}

export class ActivitySummaryQuery extends Query<ActivitySummary> {
  constructor(
    readonly actor: Actor,
    readonly from: string,
    readonly to: string,
  ) {
    super();
  }
}

export class SignInHistoryQuery extends Query<SignIn[]> {
  constructor(
    readonly actor: Actor,
    readonly userId: string,
    readonly from: string,
    readonly to: string,
  ) {
    super();
  }
}

/** Old HealthSnapshot: what happened over the days — per day and hour, by module and action, and who was active. */
@QueryHandler(ActivitySummaryQuery)
export class ActivitySummaryHandler implements IQueryHandler<ActivitySummaryQuery> {
  constructor(
    private readonly read: ActivityReadRepository,
    private readonly access: AccessControl,
    private readonly users: UserDirectory,
    @Inject(AUDIT_SETTINGS) private readonly settings: AuditSettings,
  ) {}

  async execute({ actor, from, to }: ActivitySummaryQuery): Promise<ActivitySummary> {
    await this.access.authorize(actor.userId, { permissions: ['audit:read'] });
    return activitySummary(this.read, this.users, this.settings.timeZone, from, to);
  }
}

export async function activitySummary(
  read: ActivityReadRepository,
  users: UserDirectory,
  timeZone: string,
  from: string,
  to: string,
): Promise<ActivitySummary> {
  const [start, end] = period(from, to, timeZone);
  const summary = await read.summary(start, end, timeZone);
  const ids = summary.topUsers.map((entry) => entry.userId);
  const names = new Map((ids.length ? await users.findSummaries(ids) : []).map((user) => [user.id, user.displayName]));
  return {
    ...summary,
    from,
    to,
    topUsers: summary.topUsers.map((entry) => ({ ...entry, name: names.get(entry.userId) ?? '' })),
  };
}

/** A user's sign-ins, successful and failed, newest first: the auditor's, or one's own. */
@QueryHandler(SignInHistoryQuery)
export class SignInHistoryHandler implements IQueryHandler<SignInHistoryQuery> {
  constructor(
    private readonly read: ActivityReadRepository,
    private readonly access: AccessControl,
    @Inject(AUDIT_SETTINGS) private readonly settings: AuditSettings,
  ) {}

  async execute({ actor, userId, from, to }: SignInHistoryQuery): Promise<SignIn[]> {
    await this.access.authorize(actor.userId, { permissions: ['audit:read'], ownerId: userId });
    const [start, end] = period(from, to, this.settings.timeZone);
    return this.read.signIns(userId, start, end);
  }
}
