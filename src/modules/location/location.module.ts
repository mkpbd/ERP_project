import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { LocationDirectory } from '../../shared/application/contracts/location-directory.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { DrizzleLocationDirectory } from './infrastructure/persistence/drizzle-location-directory.js';
import { locationRecordTypes } from './infrastructure/persistence/location.record-stores.js';
import { districtsReport } from './infrastructure/reports/districts.report.js';
import { CountriesController, DistrictsController, DivisionsController } from './presentation/location.controllers.js';

/**
 * Countries, divisions and districts. Ported from the old API's Location feature and Admin.Countries.
 * Publishes LocationDirectory for other modules.
 */
@Global()
@Module({
  controllers: [CountriesController, DivisionsController, DistrictsController],
  providers: [{ provide: LocationDirectory, useClass: DrizzleLocationDirectory }],
  exports: [LocationDirectory],
})
export class LocationModule implements OnModuleInit {
  constructor(
    private readonly registry: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
  ) {}

  onModuleInit(): void {
    for (const type of locationRecordTypes(this.context)) this.registry.register(type);
    this.reports.register(districtsReport(this.context));
  }
}
