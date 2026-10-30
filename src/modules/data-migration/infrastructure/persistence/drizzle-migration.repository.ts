import { Injectable } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  MigrationReadRepository,
  type MigrationRun,
  type MigrationRunDetail,
} from '../../application/migration.queries.js';
import { etlRuns } from './data-migration.schema.js';

const run = {
  id: etlRuns.id,
  startedAt: etlRuns.startedAt,
  finishedAt: etlRuns.finishedAt,
  dryRun: etlRuns.dryRun,
  loaders: etlRuns.loaders,
  status: etlRuns.status,
  written: etlRuns.written,
  rejected: etlRuns.rejected,
  error: etlRuns.error,
};

@Injectable()
export class DrizzleMigrationReadRepository extends MigrationReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  runs(limit: number): Promise<MigrationRun[]> {
    return this.context.db.select(run).from(etlRuns).orderBy(desc(etlRuns.startedAt)).limit(limit);
  }

  async run(id: string): Promise<MigrationRunDetail | null> {
    const [found] = await this.context.db
      .select({ ...run, report: etlRuns.report })
      .from(etlRuns)
      .where(eq(etlRuns.id, id));
    return found ?? null;
  }
}
