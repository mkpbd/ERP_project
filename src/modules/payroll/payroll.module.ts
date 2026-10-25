import { Module, type OnModuleInit } from '@nestjs/common';
import { DbContext } from '../../database/drizzle-transaction-manager.js';
import { StaffDirectory } from '../../shared/application/contracts/staff-directory.js';
import { RecordTypeRegistry } from '../../shared/application/records.js';
import { ReportRegistry } from '../../shared/application/reports.js';
import { PayrollReadRepository } from './application/read-models.js';
import { SALARY_HANDLERS, SalaryChanges } from './application/salary.handlers.js';
import { SalaryIncrementRepository, SalaryPolicyRepository, StaffSalaryRepository } from './domain/repositories.js';
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
 * Payroll: salary policies, each person's salary structure and yearly increments (step 5a).
 */
@Module({
  controllers: [SalaryPoliciesController, SalaryReviewCyclesController, SalariesController, IncrementsController],
  providers: [
    ...SALARY_HANDLERS,
    SalaryChanges,
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
  ) {}

  onModuleInit(): void {
    for (const type of payrollRecordTypes(this.context)) this.records.register(type);
    this.reports.register(salaryStructureReport(this.context, this.staff));
    this.reports.register(incrementStatementReport(this.context, this.staff));
  }
}
