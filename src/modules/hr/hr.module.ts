import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { LocationDirectory } from '../../shared/application/contracts/location-directory.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { StaffReadRepository } from './application/read-models.js';
import { STAFF_HANDLERS, StaffChanges } from './application/staff.handlers.js';
import { OrgStructureRepository, StaffFileRepository, StaffRepository } from './domain/repositories.js';
import { DrizzleStaffReadRepository } from './infrastructure/persistence/drizzle-staff-read.repository.js';
import {
  DrizzleOrgStructureRepository,
  DrizzleStaffFileRepository,
  DrizzleStaffRepository,
} from './infrastructure/persistence/drizzle-staff.repositories.js';
import { hrRecordTypes } from './infrastructure/persistence/hr.record-stores.js';
import { employeeCvReport, employeeListReport, newEmployeesReport } from './infrastructure/reports/hr.reports.js';
import {
  DepartmentInchargesController,
  DesignationsController,
  FestivalsController,
  GovtHolidaysController,
  HrDepartmentsController,
  HrDivisionsController,
  HrSubDepartmentsController,
  StaffController,
} from './presentation/hr.controllers.js';

/**
 * HR step 4a: organization structure, staff records, holidays and festivals.
 * Ported from the old API's HR feature (StaffRecords and its child tables).
 */
@Module({
  controllers: [
    HrDivisionsController,
    HrDepartmentsController,
    HrSubDepartmentsController,
    DesignationsController,
    FestivalsController,
    GovtHolidaysController,
    DepartmentInchargesController,
    StaffController,
  ],
  providers: [
    ...STAFF_HANDLERS,
    StaffChanges,
    { provide: StaffRepository, useClass: DrizzleStaffRepository },
    { provide: OrgStructureRepository, useClass: DrizzleOrgStructureRepository },
    { provide: StaffFileRepository, useClass: DrizzleStaffFileRepository },
    { provide: StaffReadRepository, useClass: DrizzleStaffReadRepository },
  ],
})
export class HrModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly locations: LocationDirectory,
  ) {}

  onModuleInit(): void {
    for (const type of hrRecordTypes(this.context)) this.records.register(type);
    this.reports.register(employeeListReport(this.context));
    this.reports.register(newEmployeesReport(this.context));
    this.reports.register(employeeCvReport(this.context, this.locations));
  }
}
