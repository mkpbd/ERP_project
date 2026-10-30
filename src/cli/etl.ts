/**
 * The data migration from the old system (SQL Server) into this one.
 *
 *   ETL_SOURCE_URL="Server=…;Database=…;User Id=<read-only>;Password=…;Encrypt=true" npm run etl -- [--dry-run]
 *     [--only=users,patients] [--batch=2000] [--cut-over=2027-01-01]
 *
 * Loaders run with what they depend on, in order. Records already brought over (etl_id_map) are kept, so a run may be
 * repeated. --dry-run does everything in one transaction and rolls it back, printing what would have happened.
 * The connection string is read from the environment only and never printed or stored.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { loadConfig } from '../config/configuration.js';
import { DbContext } from '../database/drizzle-transaction-manager.js';
import { legacyLoaders } from './data-migration/legacy-loaders.js';
import { runEtl } from './data-migration/runner.js';
import { MssqlSource } from './data-migration/mssql-source.js';
import { TransactionManager } from '../shared/application/ports/transaction-manager.js';
import { loadLocalEnv } from './load-env.js';

loadLocalEnv();
const args = process.argv.slice(2);
const flag = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];
const dryRun = args.includes('--dry-run');
const only = flag('only')?.split(',').filter(Boolean) ?? null;
const batchSize = Number(flag('batch') ?? 2000);
const cutOver = flag('cut-over') ?? null;
const sourceUrl = process.env['ETL_SOURCE_URL'];
if (!sourceUrl) {
  console.error('Set ETL_SOURCE_URL to the old SQL Server database (a read-only login)');
  process.exit(1);
}
if (cutOver !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(cutOver) || Number.isNaN(Date.parse(cutOver)))) {
  console.error('--cut-over is a day, YYYY-MM-DD (the first day this system keeps the books)');
  process.exit(1);
}
if (!Number.isInteger(batchSize) || batchSize < 100 || batchSize > 50_000) {
  console.error('--batch is 100 to 50000');
  process.exit(1);
}

const config = loadConfig();
const app = await NestFactory.createApplicationContext(AppModule.register(config), { logger: ['error', 'warn'] });
const source = await MssqlSource.connect(sourceUrl);
let failed = false;
try {
  await app.init();
  const db = app.get(DbContext);
  const run = await runEtl({
    db,
    tx: app.get(TransactionManager),
    source,
    loaders: legacyLoaders(db),
    only,
    dryRun,
    batchSize,
    cutOver,
    timeZone: config.reports.timeZone,
    log: (report) => {
      console.log(
        `${report.loader.padEnd(14)} read ${report.read}, written ${report.written}, kept ${report.kept}, rejected ${report.rejected}`,
      );
      for (const [reason, entry] of Object.entries(report.reasons)) {
        console.log(`  rejected ${reason}: ${entry.count} (e.g. ${entry.examples.join(', ')})`);
      }
      for (const note of report.notes.slice(0, 20)) console.log(`  ${note}`);
      if (report.notes.length > 20) console.log(`  … ${report.notes.length - 20} more notes in etl_runs`);
    },
  });
  console.log(`${dryRun ? 'Dry run' : 'Run'} ${run.runId} done${dryRun ? '; nothing was kept' : ''}`);
} catch (error) {
  failed = true;
  console.error('The data migration failed:', error instanceof Error ? error.message : error);
} finally {
  await source.close();
  await app.close();
}
process.exit(failed ? 1 : 0);
