import { Module, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { LocationDirectory } from '../../shared/application/contracts/location-directory.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { ATTENDANCE_HANDLERS } from './application/attendance.handlers.js';
import { AttendanceReadRepository } from './application/attendance.read-models.js';
import { LEAVE_HANDLERS } from './application/leave.handlers.js';
import { LeaveReadRepository } from './application/leave.read-models.js';
import { StaffReadRepository } from './application/read-models.js';
import { HR_SETTINGS, ROSTER_HANDLERS } from './application/roster.handlers.js';
import { RosterReadRepository } from './application/roster.read-models.js';
import { STAFF_HANDLERS, StaffChanges } from './application/staff.handlers.js';
import {
  AttendanceRepository,
  LeavePolicyRepository,
  LeaveRepository,
  OrgStructureRepository,
  RosterRepository,
  StaffFacts,
  JobApplicationFileRepository,
  StaffFileRepository,
  StaffRepository,
} from './domain/repositories.js';
import {
  DrizzleAttendanceReadRepository,
  DrizzleAttendanceRepository,
} from './infrastructure/persistence/drizzle-attendance.repositories.js';
import { DrizzleLeaveReadRepository } from './infrastructure/persistence/drizzle-leave-read.repository.js';
import {
  DrizzleLeavePolicyRepository,
  DrizzleLeaveRepository,
  DrizzleStaffFacts,
} from './infrastructure/persistence/drizzle-leave.repositories.js';
import {
  DrizzleRosterReadRepository,
  DrizzleRosterRepository,
} from './infrastructure/persistence/drizzle-roster.repositories.js';
import { DrizzleStaffReadRepository } from './infrastructure/persistence/drizzle-staff-read.repository.js';
import {
  DrizzleOrgStructureRepository,
  DrizzleStaffFileRepository,
  DrizzleStaffRepository,
} from './infrastructure/persistence/drizzle-staff.repositories.js';
import { hrRecordTypes } from './infrastructure/persistence/hr.record-stores.js';
import { leaveRecordTypes } from './infrastructure/persistence/leave.record-stores.js';
import { recruitmentRecordTypes } from './infrastructure/persistence/recruitment.record-stores.js';
import { rosterRecordTypes } from './infrastructure/persistence/roster.record-stores.js';
import { DrizzleJobApplicationFileRepository } from './infrastructure/persistence/drizzle-recruitment.repositories.js';
import { jobApplicationsReport } from './infrastructure/reports/recruitment.reports.js';
import { RECRUITMENT_HANDLERS } from './application/recruitment.handlers.js';
import {
  JobApplicationFilesController,
  JobApplicationsController,
  JobCircularsController,
} from './presentation/recruitment.controllers.js';
import {
  dailyAttendanceReport,
  individualAttendanceReport,
  monthlyAttendanceReport,
} from './infrastructure/reports/attendance.reports.js';
import {
  employeeCvReport,
  employeeListReport,
  idCardReport,
  newEmployeesReport,
} from './infrastructure/reports/hr.reports.js';
import {
  leaveApplicationsReport,
  leaveBalancesReport,
  leaveStatementReport,
} from './infrastructure/reports/leave.reports.js';
import { dutyRosterReport } from './infrastructure/reports/roster.reports.js';
import { AttendanceController, ManualAttendanceController } from './presentation/attendance.controllers.js';
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
import {
  DutyExchangesController,
  ExtraDutiesController,
  RosterController,
  ShiftTypesController,
} from './presentation/roster.controllers.js';

/**
 * HR: organization structure, staff records, holidays and festivals (step 4a);
 * leave policies, applications with multi-level approval, balances (step 4b);
 * shift types, the monthly duty roster, days off, duty exchanges, extra duties (step 4c);
 * attendance: device punches, manual entries with approval, daily status (step 4d);
 * recruitment: job circulars, applicants and their CVs; staff ID cards (step 4e).
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
    ShiftTypesController,
    DutyExchangesController,
    ExtraDutiesController,
    RosterController,
    AttendanceController,
    ManualAttendanceController,
    JobCircularsController,
    JobApplicationsController,
    JobApplicationFilesController,
  ],
  providers: [
    ...STAFF_HANDLERS,
    ...LEAVE_HANDLERS,
    ...ROSTER_HANDLERS,
    ...ATTENDANCE_HANDLERS,
    ...RECRUITMENT_HANDLERS,
    {
      provide: HR_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ timeZone: config.reports.timeZone }),
    },
    StaffChanges,
    { provide: StaffRepository, useClass: DrizzleStaffRepository },
    { provide: OrgStructureRepository, useClass: DrizzleOrgStructureRepository },
    { provide: StaffFileRepository, useClass: DrizzleStaffFileRepository },
    { provide: StaffReadRepository, useClass: DrizzleStaffReadRepository },
    { provide: LeaveRepository, useClass: DrizzleLeaveRepository },
    { provide: LeavePolicyRepository, useClass: DrizzleLeavePolicyRepository },
    { provide: StaffFacts, useClass: DrizzleStaffFacts },
    { provide: LeaveReadRepository, useClass: DrizzleLeaveReadRepository },
    { provide: RosterRepository, useClass: DrizzleRosterRepository },
    { provide: RosterReadRepository, useClass: DrizzleRosterReadRepository },
    { provide: AttendanceRepository, useClass: DrizzleAttendanceRepository },
    { provide: AttendanceReadRepository, useClass: DrizzleAttendanceReadRepository },
    { provide: JobApplicationFileRepository, useClass: DrizzleJobApplicationFileRepository },
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
    for (const type of [
      ...hrRecordTypes(this.context),
      ...leaveRecordTypes(this.context),
      ...rosterRecordTypes(this.context),
      ...recruitmentRecordTypes(this.context),
    ])
      this.records.register(type);
    this.reports.register(employeeListReport(this.context));
    this.reports.register(newEmployeesReport(this.context));
    this.reports.register(employeeCvReport(this.context, this.locations));
    this.reports.register(leaveApplicationsReport(this.context));
    this.reports.register(leaveBalancesReport(this.context));
    this.reports.register(leaveStatementReport(this.context));
    this.reports.register(dutyRosterReport(this.context));
    this.reports.register(dailyAttendanceReport(this.context));
    this.reports.register(monthlyAttendanceReport(this.context));
    this.reports.register(individualAttendanceReport(this.context));
    this.reports.register(idCardReport(this.context));
    this.reports.register(jobApplicationsReport(this.context));
  }
}
