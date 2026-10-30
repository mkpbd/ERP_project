import { Query, QueryHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { NotFoundError } from '../../../shared/domain/errors.js';

export const MIGRATION_READ = 'migration:read';

/** A run of the data migration from the old system (the `npm run etl` tool), or a reconciliation of the cut-over. */
export interface MigrationRun {
  readonly id: string;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly dryRun: boolean;
  readonly loaders: string[];
  readonly status: 'running' | 'done' | 'failed';
  readonly written: number;
  readonly rejected: number;
  readonly error: string | null;
}

export interface ReconciliationCheck {
  readonly area: string;
  readonly item: string;
  readonly old: number | null;
  readonly new: number | null;
  readonly status: 'ok' | 'check' | 'fail';
  readonly note: string | null;
}

export interface MigrationRunDetail extends MigrationRun {
  /** Each loader's counts and notes, or the reconciliation's checks. */
  readonly report: unknown;
}

export interface Reconciliation {
  readonly run: MigrationRun;
  readonly cutOver: string;
  readonly verdict: 'go' | 'go-with-notes' | 'no-go';
  readonly checks: ReconciliationCheck[];
}

export abstract class MigrationReadRepository {
  /** The runs, newest first. */
  abstract runs(limit: number): Promise<MigrationRun[]>;
  abstract run(id: string): Promise<MigrationRunDetail | null>;
}

/** A reconciliation run's checks, or null when the run is not a reconciliation. */
export function reconciliationOf(run: MigrationRunDetail): Reconciliation | null {
  const report = run.report as Partial<Omit<Reconciliation, 'run'>> & { kind?: string };
  if (report?.kind !== 'reconciliation' || !Array.isArray(report.checks)) return null;
  return {
    run,
    cutOver: String(report.cutOver),
    verdict: report.verdict ?? 'no-go',
    checks: report.checks,
  };
}

export class ListMigrationRunsQuery extends Query<MigrationRun[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class GetMigrationRunQuery extends Query<MigrationRunDetail> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

@QueryHandler(ListMigrationRunsQuery)
export class ListMigrationRunsHandler implements IQueryHandler<ListMigrationRunsQuery> {
  constructor(
    private readonly access: AccessControl,
    private readonly read: MigrationReadRepository,
  ) {}

  async execute({ actor }: ListMigrationRunsQuery) {
    await this.access.authorize(actor.userId, { permissions: [MIGRATION_READ] });
    return this.read.runs(200);
  }
}

@QueryHandler(GetMigrationRunQuery)
export class GetMigrationRunHandler implements IQueryHandler<GetMigrationRunQuery> {
  constructor(
    private readonly access: AccessControl,
    private readonly read: MigrationReadRepository,
  ) {}

  async execute({ actor, id }: GetMigrationRunQuery) {
    await this.access.authorize(actor.userId, { permissions: [MIGRATION_READ] });
    const run = await this.read.run(id);
    if (!run) throw new NotFoundError('migration_run');
    return run;
  }
}
