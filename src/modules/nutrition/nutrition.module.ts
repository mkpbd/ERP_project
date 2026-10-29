import { Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { Kitchen, NUTRITION_HANDLERS } from './application/nutrition.handlers.js';
import { NUTRITION_SETTINGS, NutritionReadRepository } from './application/nutrition.messages.js';
import { NutritionRepository } from './domain/repositories.js';
import {
  DrizzleNutritionReadRepository,
  DrizzleNutritionRepository,
} from './infrastructure/persistence/drizzle-nutrition.repositories.js';
import { nutritionRecordTypes } from './infrastructure/persistence/nutrition.record-stores.js';
import { kitchenListReport } from './infrastructure/reports/nutrition.reports.js';
import { NUTRITION_CONTROLLERS } from './presentation/nutrition.controllers.js';

/**
 * Nutrition (old Nutrition and the canteen's IPD food indents, step 11d): meal types and the meals each bed category
 * gets, diet plans with a menu per meal, each admitted patient's diet (or nothing by mouth), the kitchen's list of a
 * meal and the meals served or refused. Admissions and beds are read through InpatientRegister.
 */
@Module({
  controllers: NUTRITION_CONTROLLERS,
  providers: [
    ...NUTRITION_HANDLERS,
    { provide: NutritionRepository, useClass: DrizzleNutritionRepository },
    { provide: NutritionReadRepository, useClass: DrizzleNutritionReadRepository },
    {
      provide: NUTRITION_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ timeZone: config.reports.timeZone }),
    },
  ],
})
export class NutritionModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly kitchen: Kitchen,
  ) {}

  onModuleInit(): void {
    for (const type of nutritionRecordTypes(this.context)) this.records.register(type);
    this.reports.register(kitchenListReport(this.kitchen));
  }
}
