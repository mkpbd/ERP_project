import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { DbContext } from '../../../database/drizzle-transaction-manager.js';
import type {
  DashboardDimension,
  DashboardHead,
  DashboardRange,
  DashboardRow,
  DashboardUnit,
} from '../../application/dashboards.js';

/** At most this many rows in a split; the rest are summed as "Other". */
const MAX_ROWS = 25;

export interface SqlHeadSpec {
  readonly key: string;
  readonly label: string;
  readonly unit: DashboardUnit;
  readonly finance?: boolean;
  readonly hint?: string;
  /** The rows counted or summed: `from … join …`, without the word FROM. */
  readonly from: SQL;
  /** The day a row falls on; none for a head that stands as of now. */
  readonly day?: (range: DashboardRange) => SQL;
  /** Which rows count, besides the days. */
  readonly where?: (range: DashboardRange) => SQL;
  /** `count(*)`, `sum(…)` and the like. */
  readonly value: SQL;
  /** The splits besides the day: a label for each row. */
  readonly dimensions?: Readonly<
    Record<string, { readonly label: string; readonly expr: SQL; /** Labels are user ids. */ readonly users?: boolean }>
  >;
}

const round = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;

/** A timestamp's day in the organisation's time zone. */
export const dayOf = (column: SQLWrapper, range: DashboardRange): SQL =>
  sql`(${column} at time zone ${range.timeZone})::date`;

/** A dashboard head counted or summed in SQL, split by day and by the dimensions given. */
export function sqlHead(context: DbContext, spec: SqlHeadSpec): DashboardHead {
  const conditions = (range: DashboardRange): SQL => {
    const parts = [
      ...(spec.day ? [sql`${spec.day(range)} between ${range.from}::date and ${range.to}::date`] : []),
      ...(spec.where ? [spec.where(range)] : []),
    ];
    return parts.length === 0 ? sql`true` : sql.join(parts, sql` and `);
  };
  const dimensions: DashboardDimension[] = [
    ...(spec.day ? [{ key: 'day', label: 'Day' }] : []),
    ...Object.entries(spec.dimensions ?? {}).map(([key, { label, users }]) => ({
      key,
      label,
      ...(users ? { users } : {}),
    })),
  ];
  return {
    key: spec.key,
    label: spec.label,
    unit: spec.unit,
    finance: spec.finance ?? spec.unit === 'money',
    ...(spec.hint ? { hint: spec.hint } : {}),
    current: !spec.day,
    dimensions,
    async total(range) {
      const result = await context.db.execute<{ value: string | null }>(
        sql`select coalesce(${spec.value}, 0) as value from ${spec.from} where ${conditions(range)}`,
      );
      return round(result.rows[0]?.value);
    },
    async breakdown(range, dimension) {
      const label =
        dimension === 'day' && spec.day
          ? sql`to_char(${spec.day(range)}, 'YYYY-MM-DD')`
          : spec.dimensions?.[dimension]?.expr;
      if (!label) throw new Error(`Head ${spec.key} does not split by ${dimension}`);
      const order = dimension === 'day' ? sql`1 asc` : sql`2 desc, 1 asc`;
      const result = await context.db.execute<{ label: string | null; value: string | null }>(
        sql`select coalesce((${label})::text, '—') as label, coalesce(${spec.value}, 0) as value
            from ${spec.from} where ${conditions(range)} group by 1 order by ${order}`,
      );
      const rows: DashboardRow[] = result.rows.map((row) => ({ label: row.label ?? '—', value: round(row.value) }));
      if (dimension === 'day' || rows.length <= MAX_ROWS) return rows;
      const rest = rows.slice(MAX_ROWS - 1).reduce((sum, row) => sum + Math.round(row.value * 100), 0) / 100;
      return [...rows.slice(0, MAX_ROWS - 1), { label: 'Other', value: rest }];
    },
  };
}
