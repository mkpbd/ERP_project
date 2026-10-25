import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { LocationDirectory } from '../../shared/application/contracts/location-directory.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { LEAVE_HANDLERS } from './application/leave.handlers.js';
import { LeaveReadRepository } from './application/leave.read-models.js';
import { StaffReadRepository } from './application/read-models.js';
import { STAFF_HANDLERS, StaffChanges } from './application/staff.handlers.js';
import {
  LeavePolicyRepository,
  LeaveRepository,
  OrgStructureRepository,
  StaffFacts,
  StaffFileRepository,
  StaffRepository,
} from './domain/repositories.js';
import { DrizzleLeaveReadRepository } from './infrastructure/persistence/drizzle-leave-read.repository.js';
import {
  DrizzleLeavePolicyRepository,
  DrizzleLeaveRepository,
  DrizzleStaffFacts,
} from './infrastructure/persistence/drizzle-leave.repositories.js';
import { DrizzleStaffReadRepository } from './infrastructure/persistence/drizzle-staff-read.repository.js';
import {
  DrizzleOrgStructureRepository,
  DrizzleStaffFileRepository,
  DrizzleStaffRepository,
} from './infrastructure/persistence/drizzle-staff.repositories.js';
import { hrRecordTypes } from './infrastructure/persistence/hr.record-stores.js';
import { leaveRecordTypes } from './infrastructure/persistence/leave.record-stores.js';
import { employeeCvReport, employeeListReport, newEmployeesReport } from './infrastructure/reports/hr.reports.js';
import {
  leaveApplicationsReport,
  leaveBalancesReport,
  leaveStatementReport,
} from './infrastructure/reports/leave.reports.js';
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
import {
  LeaveApplicationsController,
  LeaveApprovalLevelsController,
  LeaveDelegatesController,
  LeaveRecordsController,
  LeaveTypesController,
  StaffLeaveController,
} from './presentation/leave.controllers.js';

/**
 * HR: organization structure, staff records, holidays and festivals (step 4a);
 * leave policies, applications with multi-level approval, balances (step 4b).
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
    StaffLeaveController,
    LeaveTypesController,
    LeaveApprovalLevelsController,
    LeaveDelegatesController,
    LeaveRecordsController,
    LeaveApplicationsController,
  ],
  providers: [
    ...STAFF_HANDLERS,
    ...LEAVE_HANDLERS,
    StaffChanges,
    { provide: StaffRepository, useClass: DrizzleStaffRepository },
    { provide: OrgStructureRepository, useClass: DrizzleOrgStructureRepository },
    { provide: StaffFileRepository, useClass: DrizzleStaffFileRepository },
    { provide: StaffReadRepository, useClass: DrizzleStaffReadRepository },
    { provide: LeaveRepository, useClass: DrizzleLeaveRepository },
    { provide: LeavePolicyRepository, useClass: DrizzleLeavePolicyRepository },
    { provide: StaffFacts, useClass: DrizzleStaffFacts },
    { provide: LeaveReadRepository, useClass: DrizzleLeaveReadRepository },
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
    for (const type of [...hrRecordTypes(this.context), ...leaveRecordTypes(this.context)]) this.records.register(type);
    this.reports.register(employeeListReport(this.context));
    this.reports.register(newEmployeesReport(this.context));
    this.reports.register(employeeCvReport(this.context, this.locations));
    this.reports.register(leaveApplicationsReport(this.context));
    this.reports.register(leaveBalancesReport(this.context));
    this.reports.register(leaveStatementReport(this.context));
  }
}
