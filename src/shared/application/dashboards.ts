/** The days a dashboard is asked for, in the organisation's time zone. */
export interface DashboardRange {
  readonly from: string;
  readonly to: string;
  /** The organisation's today, for heads that stand as of now. */
  readonly today: string;
  readonly timeZone: string;
}

export type DashboardUnit = 'money' | 'count';

export interface DashboardRow {
  readonly label: string;
  readonly value: number;
}

export interface DashboardDimension {
  readonly key: string;
  readonly label: string;
  /** The split's labels are user ids, named by the dashboard from the user directory. */
  readonly users?: boolean;
}

/** One figure on a dashboard (old ManagementDashboardData "head"), and how it splits. */
export interface DashboardHead {
  /** The section's key, a dot and the head's name. */
  readonly key: string;
  readonly label: string;
  readonly unit: DashboardUnit;
  /** Money that only users with dashboard:finance see. */
  readonly finance: boolean;
  readonly hint?: string;
  /** As of now rather than over the days asked (stock, beds, dues): no previous period. */
  readonly current?: boolean;
  /** What it splits by; a head over days splits by day first. */
  readonly dimensions: readonly DashboardDimension[];
  total(range: DashboardRange): Promise<number>;
  breakdown(range: DashboardRange, dimension: string): Promise<DashboardRow[]>;
}

/** A module's part of the dashboard (old department dashboards), seen by users with any of its permissions. */
export interface DashboardSection {
  readonly key: string;
  readonly title: string;
  readonly order: number;
  readonly permissions: readonly string[];
  readonly heads: readonly DashboardHead[];
}

const SECTION_KEY = /^[a-z][a-z0-9-]*$/;

/** The sections modules contribute, as reports are: each module registers its own in onModuleInit. */
export class DashboardRegistry {
  private readonly sections = new Map<string, DashboardSection>();
  private readonly heads = new Map<string, { section: DashboardSection; head: DashboardHead }>();

  register(section: DashboardSection): void {
    if (!SECTION_KEY.test(section.key)) throw new Error(`Invalid dashboard section ${section.key}`);
    if (this.sections.has(section.key)) throw new Error(`Dashboard section ${section.key} is registered twice`);
    for (const head of section.heads) {
      if (!head.key.startsWith(`${section.key}.`)) throw new Error(`Head ${head.key} is not of ${section.key}`);
      if (this.heads.has(head.key)) throw new Error(`Dashboard head ${head.key} is registered twice`);
      if (!head.current && head.dimensions[0]?.key !== 'day') throw new Error(`Head ${head.key} splits by day first`);
    }
    this.sections.set(section.key, section);
    for (const head of section.heads) this.heads.set(head.key, { section, head });
  }

  all(): DashboardSection[] {
    return [...this.sections.values()].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
  }

  head(key: string): { section: DashboardSection; head: DashboardHead } | undefined {
    return this.heads.get(key);
  }
}
