import { Module, type OnModuleInit } from '@nestjs/common';
import { ReportRegistry } from '../../shared/application/reports.js';
import {
  GetMigrationRunHandler,
  ListMigrationRunsHandler,
  MigrationReadRepository,
} from './application/migration.queries.js';
import { DrizzleMigrationReadRepository } from './infrastructure/persistence/drizzle-migration.repository.js';
import { reconciliationReport } from './infrastructure/reports/migration.reports.js';
import { MigrationController } from './presentation/migration.controller.js';

/**
 * The data migration from the old system (step 13): the runs of the `npm run etl` tool and the cut-over
 * reconciliations, read and printed here for sign-off. The tool itself runs from the command line (src/cli).
 */
@Module({
  controllers: [MigrationController],
  providers: [
    ListMigrationRunsHandler,
    GetMigrationRunHandler,
    { provide: MigrationReadRepository, useClass: DrizzleMigrationReadRepository },
  ],
})
export class DataMigrationModule implements OnModuleInit {
  constructor(
    private readonly reports: ReportRegistry,
    private readonly read: MigrationReadRepository,
  ) {}

  onModuleInit(): void {
    this.reports.register(reconciliationReport(this.read));
  }
}
