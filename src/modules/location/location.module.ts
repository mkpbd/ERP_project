import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { locationRecordTypes } from './infrastructure/persistence/location.record-stores.js';
import { CountriesController, DistrictsController, DivisionsController } from './presentation/location.controllers.js';

/** Countries, divisions and districts. Ported from the old API's Location feature and Admin.Countries. */
@Module({ controllers: [CountriesController, DivisionsController, DistrictsController] })
export class LocationModule implements OnModuleInit {
  constructor(
    private readonly registry: RecordTypeRegistry,
    private readonly context: DbContext,
  ) {}

  onModuleInit(): void {
    for (const type of locationRecordTypes(this.context)) this.registry.register(type);
  }
}
