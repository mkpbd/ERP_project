import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import type { TransactionManager } from '../../shared/application/ports/transaction-manager.js';
import { IdMap, newReport, plan, type LegacySource, type Loader, type LoaderReport } from './etl.js';
import { etlIdMap, etlRuns } from '../../modules/data-migration/infrastructure/persistence/data-migration.schema.js';

/** The id map in etl_id_map, read once per kind and kept in memory through the run (written in its transaction). */
export class DrizzleIdMap extends IdMap {
  private readonly cache = new Map<string, Map<string, string>>();

  constructor(private readonly db: DbContext) {
    super();
  }

  private async kind(entity: string): Promise<Map<string, string>> {
    let map = this.cache.get(entity);
    if (!map) {
      const rows = await this.db.db
        .select({ oldId: etlIdMap.oldId, newId: etlIdMap.newId })
        .from(etlIdMap)
        .where(eq(etlIdMap.entity, entity));
      map = new Map(rows.map((row) => [row.oldId.toLowerCase(), row.newId]));
      this.cache.set(entity, map);
    }
    return map;
  }

  async get(entity: string, oldId: string): Promise<string | null> {
    return (await this.kind(entity)).get(oldId.toLowerCase()) ?? null;
  }

  async has(entity: string, oldId: string): Promise<boolean> {
    return (await this.kind(entity)).has(oldId.toLowerCase());
  }

  async set(entity: string, oldId: string, newId: string): Promise<void> {
    await this.db.db
      .insert(etlIdMap)
      .values({ entity, oldId: oldId.toLowerCase(), newId })
      .onConflictDoNothing({ target: [etlIdMap.entity, etlIdMap.oldId] });
    (await this.kind(entity)).set(oldId.toLowerCase(), newId);
  }
}

class DryRunRollback extends Error {}

export interface EtlRun {
  readonly runId: string;
  readonly dryRun: boolean;
  readonly reports: LoaderReport[];
}

/**
 * Runs the loaders asked for (with what they depend on). A real run commits each loader on its own, so a later failure
 * keeps what was loaded and a re-run carries on; a dry run does everything in one transaction and rolls it back, so
 * the database's own checks still speak. Every run is logged in etl_runs.
 */
export async function runEtl(params: {
  db: DbContext;
  tx: TransactionManager;
  source: LegacySource;
  loaders: readonly Loader[];
  only: readonly string[] | null;
  dryRun: boolean;
  batchSize?: number;
  now?: Date;
  log?: (report: LoaderReport) => void;
}): Promise<EtlRun> {
  const ordered = plan(params.loaders, params.only);
  const runId = randomUUID();
  const now = params.now ?? new Date();
  await params.db.db.insert(etlRuns).values({
    id: runId,
    startedAt: now,
    dryRun: params.dryRun,
    loaders: ordered.map((loader) => loader.name),
    status: 'running',
  });
  const reports: LoaderReport[] = [];
  const runLoader = async (loader: Loader, ids: IdMap) => {
    const report = newReport(loader.name);
    await loader.run({ source: params.source, ids, now, batchSize: params.batchSize ?? 2000 }, report);
    reports.push(report);
    params.log?.(report);
  };
  try {
    if (params.dryRun) {
      await params.tx
        .run(async () => {
          const ids = new DrizzleIdMap(params.db);
          for (const loader of ordered) await runLoader(loader, ids);
          throw new DryRunRollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof DryRunRollback)) throw error;
        });
    } else {
      for (const loader of ordered) {
        await params.tx.run(() => runLoader(loader, new DrizzleIdMap(params.db)));
      }
    }
  } catch (error) {
    await params.db.db
      .update(etlRuns)
      .set({ status: 'failed', finishedAt: new Date(), report: reports, error: String(error).slice(0, 2000) })
      .where(eq(etlRuns.id, runId));
    throw error;
  }
  await params.db.db
    .update(etlRuns)
    .set({
      status: 'done',
      finishedAt: new Date(),
      written: reports.reduce((sum, report) => sum + report.written, 0),
      rejected: reports.reduce((sum, report) => sum + report.rejected, 0),
      report: reports,
    })
    .where(eq(etlRuns.id, runId));
  return { runId, dryRun: params.dryRun, reports };
}
