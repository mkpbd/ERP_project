import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { UserDirectory } from '../../../shared/application/contracts/user-directory.js';
import {
  DashboardRegistry,
  type DashboardDimension,
  type DashboardHead,
  type DashboardRange,
  type DashboardRow,
  type DashboardSection,
  type DashboardUnit,
} from '../../../shared/application/dashboards.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { REPORTING_SETTINGS, type ReportingSettings } from './ports.js';

/** Money figures on the dashboard (old management dashboard's collection, sales and dues). */
export const DASHBOARD_FINANCE = 'dashboard:finance';
/** The longest span a dashboard is worked out over. */
const MAX_DAYS = 366;
/** How long a figure is kept before it is worked out again. */
const CACHE_MS = 60_000;

export interface DashboardHeadView {
  readonly key: string;
  readonly label: string;
  readonly unit: DashboardUnit;
  readonly hint: string | null;
  readonly current: boolean;
  readonly value: number;
  /** The same head over the days just before, as many of them; null for a head as of now. */
  readonly previous: number | null;
  readonly dimensions: readonly DashboardDimension[];
}

export interface DashboardView {
  readonly from: string;
  readonly to: string;
  readonly previousFrom: string;
  readonly previousTo: string;
  readonly sections: { key: string; title: string; heads: DashboardHeadView[] }[];
}

export interface DashboardBreakdownView {
  readonly key: string;
  readonly label: string;
  readonly unit: DashboardUnit;
  readonly dimension: string;
  readonly rows: DashboardRow[];
}

export class GetDashboardQuery extends Query<DashboardView> {
  constructor(
    readonly actor: Actor,
    readonly from: string | undefined,
    readonly to: string | undefined,
  ) {
    super();
  }
}

export class GetDashboardBreakdownQuery extends Query<DashboardBreakdownView> {
  constructor(
    readonly actor: Actor,
    readonly key: string,
    readonly from: string | undefined,
    readonly to: string | undefined,
    readonly dimension: string | undefined,
  ) {
    super();
  }
}

const DAY_MS = 86_400_000;
const shift = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** What the user may see of the dashboard, the days asked, and a short-lived cache of the figures. */
export class DashboardDesk {
  private readonly cache = new Map<string, { at: number; value: Promise<unknown> }>();

  constructor(
    readonly registry: DashboardRegistry,
    private readonly access: AccessControl,
    private readonly clock: Clock,
    private readonly settings: ReportingSettings,
    private readonly users: UserDirectory,
  ) {}

  /** A split by user names its rows. */
  async named(rows: DashboardRow[]): Promise<DashboardRow[]> {
    const ids = rows.map((row) => row.label).filter((label) => /^[0-9a-f-]{36}$/.test(label));
    const names = new Map((await this.users.findSummaries(ids)).map((user) => [user.id, user.displayName]));
    return rows.map((row) => ({ ...row, label: names.get(row.label) ?? row.label }));
  }

  /** The days asked (today when none), never backwards nor longer than a year. */
  range(from: string | undefined, to: string | undefined): DashboardRange {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.settings.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(this.clock.now());
    const end = to ?? from ?? today;
    const start = from ?? end;
    if (start > end) throw new DomainError('invalid_period', 'The start date is after the end date');
    if ((Date.parse(end) - Date.parse(start)) / DAY_MS >= MAX_DAYS) {
      throw new DomainError('period_too_long', `A dashboard covers at most ${MAX_DAYS} days`);
    }
    return { from: start, to: end, today, timeZone: this.settings.timeZone };
  }

  /** The sections the user may see, with the heads in them they may see. */
  async visible(userId: string): Promise<{ section: DashboardSection; heads: DashboardHead[] }[]> {
    const { permissions } = await this.access.getProfile(userId);
    const finance = permissions.has(DASHBOARD_FINANCE);
    return this.registry
      .all()
      .filter((section) => section.permissions.some((permission) => permissions.has(permission)))
      .map((section) => ({ section, heads: section.heads.filter((head) => finance || !head.finance) }))
      .filter((entry) => entry.heads.length > 0);
  }

  cached<T>(key: string, work: () => Promise<T>): Promise<T> {
    const now = this.clock.now().getTime();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.value as Promise<T>;
    const value = work();
    this.cache.set(key, { at: now, value });
    // A failure is not kept.
    value.catch(() => this.cache.delete(key));
    if (this.cache.size > 2_000) {
      for (const [old, entry] of this.cache) if (now - entry.at >= CACHE_MS) this.cache.delete(old);
    }
    return value;
  }

  previous(range: DashboardRange): DashboardRange {
    const days = (Date.parse(range.to) - Date.parse(range.from)) / DAY_MS + 1;
    return { ...range, from: shift(range.from, -days), to: shift(range.from, -1) };
  }
}

/**
 * Old management and department dashboards in one: each module's section the user may see (by its permissions),
 * every head over the days asked and over as many days before, money only with dashboard:finance.
 */
@QueryHandler(GetDashboardQuery)
export class GetDashboardHandler implements IQueryHandler<GetDashboardQuery> {
  constructor(private readonly desk: DashboardDesk) {}

  async execute({ actor, from, to }: GetDashboardQuery): Promise<DashboardView> {
    const range = this.desk.range(from, to);
    const before = this.desk.previous(range);
    const sections = [];
    for (const { section, heads } of await this.desk.visible(actor.userId)) {
      const views = await Promise.all(
        heads.map(async (head) => {
          const value = await this.desk.cached(`${head.key}|${range.from}|${range.to}|${range.today}`, () =>
            head.total(range),
          );
          const previous = head.current
            ? null
            : await this.desk.cached(`${head.key}|${before.from}|${before.to}|${range.today}`, () =>
                head.total(before),
              );
          return {
            key: head.key,
            label: head.label,
            unit: head.unit,
            hint: head.hint ?? null,
            current: head.current ?? false,
            value,
            previous,
            dimensions: head.dimensions,
          };
        }),
      );
      sections.push({ key: section.key, title: section.title, heads: views });
    }
    return { from: range.from, to: range.to, previousFrom: before.from, previousTo: before.to, sections };
  }
}

/** Old dashboard drill-down: one head split by one of its dimensions (by day when none is asked). */
@QueryHandler(GetDashboardBreakdownQuery)
export class GetDashboardBreakdownHandler implements IQueryHandler<GetDashboardBreakdownQuery> {
  constructor(private readonly desk: DashboardDesk) {}

  async execute({ actor, key, from, to, dimension }: GetDashboardBreakdownQuery): Promise<DashboardBreakdownView> {
    const range = this.desk.range(from, to);
    const visible = (await this.desk.visible(actor.userId)).flatMap((entry) => entry.heads);
    const head = visible.find((candidate) => candidate.key === key);
    if (!head) throw new NotFoundError('dashboard_head');
    const by = dimension ?? head.dimensions[0]?.key;
    if (!by || !head.dimensions.some((entry) => entry.key === by)) {
      throw new DomainError(
        'invalid_dimension',
        `${head.label} splits by ${head.dimensions.map((d) => d.key).join(', ')}`,
      );
    }
    const split = head.dimensions.find((entry) => entry.key === by)!;
    const rows = await this.desk.cached(`${head.key}|${range.from}|${range.to}|${range.today}|${by}`, async () => {
      const found = await head.breakdown(range, by);
      return split.users ? this.desk.named(found) : found;
    });
    return { key: head.key, label: head.label, unit: head.unit, dimension: by, rows };
  }
}

export const DASHBOARD_PROVIDERS = [
  {
    provide: DashboardDesk,
    inject: [DashboardRegistry, AccessControl, Clock, REPORTING_SETTINGS, UserDirectory],
    useFactory: (
      registry: DashboardRegistry,
      access: AccessControl,
      clock: Clock,
      settings: ReportingSettings,
      users: UserDirectory,
    ) => new DashboardDesk(registry, access, clock, settings, users),
  },
  GetDashboardHandler,
  GetDashboardBreakdownHandler,
];
