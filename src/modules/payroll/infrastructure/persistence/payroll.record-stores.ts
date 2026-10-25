import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { PAYROLL_MANAGE, SALARY_POLICY, SALARY_REVIEW_CYCLE } from '../../application/payroll.constants.js';
import { salaryPolicies, salaryReviewCycles } from './payroll.schema.js';

export function payrollRecordTypes(context: DbContext): RecordType[] {
  // Policies and cycles hold no personal data; anyone signed in may read them (dropdowns).
  const payroll = { readPermission: null, managePermission: PAYROLL_MANAGE };
  return [
    {
      name: SALARY_POLICY,
      ...payroll,
      store: new DrizzleRecordStore(context, salaryPolicies, {
        name: SALARY_POLICY,
        orderBy: [salaryPolicies.name],
        unique: {
          salary_policies_name_uq: { code: 'salary_policy_name_taken', message: 'A policy with this name exists' },
        },
      }),
    },
    {
      name: SALARY_REVIEW_CYCLE,
      ...payroll,
      store: new DrizzleRecordStore(context, salaryReviewCycles, {
        name: SALARY_REVIEW_CYCLE,
        orderBy: [salaryReviewCycles.name],
        unique: {
          salary_review_cycles_name_uq: {
            code: 'salary_review_cycle_name_taken',
            message: 'A review cycle with this name exists',
          },
        },
      }),
    },
  ];
}
