import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { AccessControl } from '../../shared/application/contracts/access-control.js';
import { StaffDirectory } from '../../shared/application/contracts/staff-directory.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { PayrollReadRepository } from './application/read-models.js';
import { SALARY_SHEET_HANDLERS, SalarySheetBuilder } from './application/salary-sheet.handlers.js';
import { SALARY_HANDLERS, SalaryChanges } from './application/salary.handlers.js';
import {
  PayPeriods,
  SalaryIncrementRepository,
  SalaryPolicyRepository,
  SalarySheetRepository,
  StaffSalaryRepository,
} from './domain/repositories.js';
import {
  DrizzlePayPeriods,
  DrizzleSalarySheetRepository,
} from './infrastructure/persistence/drizzle-salary-sheet.repositories.js';
import { monthlyInputRecordTypes } from './infrastructure/persistence/monthly-input.record-stores.js';
import {
  departmentSummaryReport,
  payslipReport,
  salaryEnvelopeReport,
  salarySheetReport,
  salaryStatementReport,
} from './infrastructure/reports/sheet.reports.js';
import {
  AllowancePaymentsController,
  ArrearsController,
  DeductionsController,
  OvertimesController,
  PunishmentsController,
  SalaryPaymentsController,
  SalarySheetsController,
  SalaryStopsController,
} from './presentation/salary-sheet.controllers.js';
import {
  DrizzlePayrollReadRepository,
  DrizzleSalaryIncrementRepository,
  DrizzleSalaryPolicyRepository,
  DrizzleStaffSalaryRepository,
} from './infrastructure/persistence/drizzle-salary.repositories.js';
import { payrollRecordTypes } from './infrastructure/persistence/payroll.record-stores.js';
import { incrementStatementReport, salaryStructureReport } from './infrastructure/reports/salary.reports.js';
import {
  IncrementsController,
  SalariesController,
  SalaryPoliciesController,
  SalaryReviewCyclesController,
} from './presentation/payroll.controllers.js';

/**
 * Payroll: salary policies, each person's salary structure and yearly increments (step 5a);
 * monthly inputs, the salary sheet with approval and commit, payslips and payment statements (step 5b).
 */
@Module({
  controllers: [
    SalaryPoliciesController,
    SalaryReviewCyclesController,
    SalariesController,
    IncrementsController,
    OvertimesController,
    DeductionsController,
    PunishmentsController,
    ArrearsController,
    AllowancePaymentsController,
    SalaryPaymentsController,
    SalaryStopsController,
    SalarySheetsController,
  ],
  providers: [
    ...SALARY_HANDLERS,
    ...SALARY_SHEET_HANDLERS,
    SalaryChanges,
    SalarySheetBuilder,
    { provide: SalarySheetRepository, useClass: DrizzleSalarySheetRepository },
    { provide: PayPeriods, useClass: DrizzlePayPeriods },
    { provide: StaffSalaryRepository, useClass: DrizzleStaffSalaryRepository },
    { provide: SalaryPolicyRepository, useClass: DrizzleSalaryPolicyRepository },
    { provide: SalaryIncrementRepository, useClass: DrizzleSalaryIncrementRepository },
    { provide: PayrollReadRepository, useClass: DrizzlePayrollReadRepository },
  ],
})
export class PayrollModule implements OnModuleInit {
  constructor(
    private readonly records: RecordTypeRegistry,
    private readonly reports: ReportRegistry,
    private readonly context: DbContext,
    private readonly staff: StaffDirectory,
    private readonly read: PayrollReadRepository,
    private readonly builder: SalarySheetBuilder,
    private readonly access: AccessControl,
  ) {}

  onModuleInit(): void {
    for (const type of [...payrollRecordTypes(this.context), ...monthlyInputRecordTypes(this.context)]) {
      this.records.register(type);
    }
    this.reports.register(salaryStructureReport(this.context, this.staff));
    this.reports.register(incrementStatementReport(this.context, this.staff));
    this.reports.register(salarySheetReport(this.read, this.builder));
    this.reports.register(payslipReport(this.read, this.staff, this.access));
    this.reports.register(salaryStatementReport(this.read));
    this.reports.register(departmentSummaryReport(this.read));
    this.reports.register(salaryEnvelopeReport(this.read));
  }
}
