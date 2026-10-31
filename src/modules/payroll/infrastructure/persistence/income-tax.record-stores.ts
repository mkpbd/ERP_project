import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { and, gte, lte, ne } from 'drizzle-orm';
import { ConflictError } from '../../../../shared/domain/errors.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { INCOME_TAX_YEAR, PAYROLL_MANAGE, PAYROLL_READ, TAX_CHALLAN } from '../../application/payroll.constants.js';
import { incomeTaxYears, taxChallans } from './payroll.schema.js';

export function incomeTaxRecordTypes(context: DbContext): RecordType[] {
  return [
    {
      // Tax law, not personal data: anyone signed in may read it.
      name: INCOME_TAX_YEAR,
      readPermission: null,
      managePermission: PAYROLL_MANAGE,
      store: new DrizzleRecordStore(context, incomeTaxYears, {
        name: INCOME_TAX_YEAR,
        orderBy: [incomeTaxYears.startsOn],
        unique: {
          income_tax_years_label_uq: { code: 'income_tax_year_exists', message: 'A tax year with this label exists' },
          income_tax_years_start_uq: { code: 'income_tax_year_exists', message: 'A tax year starting then exists' },
        },
        // Tax years must not overlap: a pay month has to fall in exactly one.
        guard: async (row) => {
          const startsOn = row['startsOn'];
          const endsOn = row['endsOn'];
          if (typeof startsOn !== 'string' || typeof endsOn !== 'string') return;
          const overlapping = await context.db
            .select({ id: incomeTaxYears.id })
            .from(incomeTaxYears)
            .where(
              and(
                lte(incomeTaxYears.startsOn, endsOn),
                gte(incomeTaxYears.endsOn, startsOn),
                typeof row['id'] === 'string' ? ne(incomeTaxYears.id, row['id']) : undefined,
              ),
            )
            .limit(1);
          if (overlapping.length > 0) {
            throw new ConflictError('income_tax_year_overlaps', 'The dates overlap another tax year');
          }
        },
      }),
    },
    {
      name: TAX_CHALLAN,
      readPermission: PAYROLL_READ,
      managePermission: PAYROLL_MANAGE,
      store: new DrizzleRecordStore(context, taxChallans, {
        name: TAX_CHALLAN,
        orderBy: [taxChallans.payYear, taxChallans.payMonth],
        filters: { staffId: taxChallans.staffId, payYear: taxChallans.payYear },
        search: [taxChallans.challanNo],
        unique: {
          payroll_tax_challans_month_uq: {
            code: 'tax_challan_month_taken',
            message: 'The person has a challan for this pay month',
          },
        },
        references: { payroll_tax_challans_staff_id_staff_records_id_fk: 'staff' },
      }),
    },
  ];
}
