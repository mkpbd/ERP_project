import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { InpatientBlood } from '../../shared/application/contracts/inpatient-blood.js';
import { OrganizationProfile } from '../../shared/application/contracts/organization-profile.js';
import { PatientDirectory } from '../../shared/application/contracts/patient-directory.js';
import { UserDirectory } from '../../shared/application/contracts/user-directory.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { BLOOD_HANDLERS } from './application/blood.handlers.js';
import { BB_SETTINGS, BloodReadRepository } from './application/blood.messages.js';
import { BloodRepository } from './domain/repositories.js';
import { bloodBankRecordTypes } from './infrastructure/persistence/blood-bank.record-stores.js';
import {
  DrizzleBloodReadRepository,
  DrizzleBloodRepository,
  DrizzleInpatientBlood,
} from './infrastructure/persistence/drizzle-blood.repositories.js';
import { bloodIssueSlip, bloodStockReport } from './infrastructure/reports/blood.reports.js';
import { BLOOD_CONTROLLERS } from './presentation/blood.controllers.js';

/**
 * Blood bank (old TransfusionMedicine): component types with shelf lives and rates; donors and their donations, each
 * bag screened (HIV, HBsAg, HCV, syphilis, malaria) and split into units held in quarantine until it is clear; requests
 * for a patient's stay or on a diagnostic bill of theirs, units cross-matched and kept for them, then issued. Global: it
 * publishes the blood charged to admissions (InpatientBlood) for the hospital's indoor bill (step 10f).
 */
@Global()
@Module({
  controllers: BLOOD_CONTROLLERS,
  providers: [
    ...BLOOD_HANDLERS,
    { provide: BloodRepository, useClass: DrizzleBloodRepository },
    { provide: BloodReadRepository, useClass: DrizzleBloodReadRepository },
    { provide: InpatientBlood, useClass: DrizzleInpatientBlood },
    {
      provide: BB_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ timeZone: config.reports.timeZone }),
    },
  ],
  exports: [InpatientBlood],
})
export class BloodBankModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly read: BloodReadRepository,
    private readonly patients: PatientDirectory,
    private readonly organization: OrganizationProfile,
    private readonly users: UserDirectory,
  ) {}

  onModuleInit(): void {
    for (const type of bloodBankRecordTypes(this.context)) this.records.register(type);
    this.reports.register(bloodStockReport(this.context));
    this.reports.register(bloodIssueSlip(this.read, this.patients, this.organization, this.users));
  }
}
