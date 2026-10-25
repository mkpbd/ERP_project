import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { ConflictError } from '../../../../shared/domain/errors.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import {
  FESTIVAL_BONUS,
  PAYROLL_MANAGE,
  PAYROLL_READ,
  PF_LEDGER_ENTRY,
  STAFF_DUE,
} from '../../application/payroll.constants.js';
import { DrizzleFestivalBonusRepository } from './drizzle-bonus.repositories.js';
import { festivalBonuses, pfLedgerEntries, staffDues } from './payroll.schema.js';

export function bonusRecordTypes(context: DbContext): RecordType[] {
  const bonuses = new DrizzleFestivalBonusRepository(context);
  const payroll = { readPermission: PAYROLL_READ, managePermission: PAYROLL_MANAGE };
  return [
    {
      name: FESTIVAL_BONUS,
      ...payroll,
      store: new DrizzleRecordStore(context, festivalBonuses, {
        name: FESTIVAL_BONUS,
        orderBy: [festivalBonuses.payYear, festivalBonuses.payMonth],
        filters: { festivalId: festivalBonuses.festivalId, payYear: festivalBonuses.payYear },
        unique: {
          festival_bonuses_festival_period_uq: {
            code: 'festival_bonus_exists',
            message: 'This festival already has a bonus in that month; edit it instead',
          },
        },
        references: { festival_bonuses_festival_id_festivals_id_fk: 'festival' },
        // Changing a bonus that has a sheet would make the sheet wrong: reverse the sheet first.
        guard: async (row) => {
          if (typeof row['id'] === 'string' && (await bonuses.sheetStatus(row['id'])) !== 'none') {
            throw new ConflictError('festival_bonus_has_sheet', 'Reverse the bonus sheet before changing the bonus');
          }
        },
      }),
    },
    {
      name: PF_LEDGER_ENTRY,
      ...payroll,
      store: new DrizzleRecordStore(context, pfLedgerEntries, {
        name: PF_LEDGER_ENTRY,
        orderBy: [pfLedgerEntries.entryDate, pfLedgerEntries.createdAt],
        filters: {
          staffId: pfLedgerEntries.staffId,
          from: { column: pfLedgerEntries.entryDate, op: 'gte' },
          to: { column: pfLedgerEntries.entryDate, op: 'lte' },
        },
        references: { pf_ledger_entries_staff_id_staff_records_id_fk: 'staff' },
      }),
    },
    {
      name: STAFF_DUE,
      ...payroll,
      store: new DrizzleRecordStore(context, staffDues, {
        name: STAFF_DUE,
        orderBy: [staffDues.entryDate, staffDues.createdAt],
        filters: {
          staffId: staffDues.staffId,
          serviceUnitId: staffDues.serviceUnitId,
          from: { column: staffDues.entryDate, op: 'gte' },
          to: { column: staffDues.entryDate, op: 'lte' },
        },
        references: {
          staff_dues_staff_id_staff_records_id_fk: 'staff',
          staff_dues_service_unit_id_service_units_id_fk: 'service_unit',
        },
      }),
    },
  ];
}
