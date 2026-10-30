/** Rows read from the old database (SQL Server), a page at a time. */
export abstract class LegacySource {
  /** Runs a read-only query with named parameters (@name) and returns its rows. */
  abstract query<T extends Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>;
  abstract close(): Promise<void>;
}

/** Old id → new id for each kind of record, loaded and saved through the run. */
export abstract class IdMap {
  abstract get(entity: string, oldId: string): Promise<string | null>;
  abstract has(entity: string, oldId: string): Promise<boolean>;
  abstract set(entity: string, oldId: string, newId: string): Promise<void>;
}

export interface LoaderReport {
  readonly loader: string;
  read: number;
  written: number;
  /** Already loaded by an earlier run. */
  kept: number;
  rejected: number;
  /** Reason → count, and a few old ids of each. */
  reasons: Record<string, { count: number; examples: string[] }>;
  notes: string[];
}

export interface EtlContext {
  readonly source: LegacySource;
  readonly ids: IdMap;
  readonly now: Date;
  /** Rows read at a time. */
  readonly batchSize: number;
}

/** One kind of record brought over: reads the old rows, transforms them, writes what is new. */
export interface Loader {
  readonly name: string;
  /** Loaders whose records this one refers to (they run first). */
  readonly dependsOn: readonly string[];
  run(context: EtlContext, report: LoaderReport): Promise<void>;
}

export function newReport(loader: string): LoaderReport {
  return { loader, read: 0, written: 0, kept: 0, rejected: 0, reasons: {}, notes: [] };
}

export function noteRejection(report: LoaderReport, oldId: string, reason: string): void {
  report.rejected += 1;
  const entry = (report.reasons[reason] ??= { count: 0, examples: [] });
  entry.count += 1;
  if (entry.examples.length < 5) entry.examples.push(oldId);
}

/** The loaders asked for, with what they depend on, in an order where each comes after its dependencies. */
export function plan(all: readonly Loader[], wanted: readonly string[] | null): Loader[] {
  const byName = new Map(all.map((loader) => [loader.name, loader]));
  const ordered: Loader[] = [];
  const visiting = new Set<string>();
  const visit = (name: string) => {
    if (ordered.some((loader) => loader.name === name)) return;
    const loader = byName.get(name);
    if (!loader) throw new Error(`Unknown loader ${name}; known: ${[...byName.keys()].join(', ')}`);
    if (visiting.has(name)) throw new Error(`Loaders depend on each other in a circle at ${name}`);
    visiting.add(name);
    for (const dependency of loader.dependsOn) visit(dependency);
    visiting.delete(name);
    ordered.push(loader);
  };
  for (const name of wanted ?? all.map((loader) => loader.name)) visit(name);
  return ordered;
}
