import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { BB_MANAGE, BB_READ, BLOOD_RECORDS } from '../../application/blood.messages.js';
import { componentTypes } from './blood-bank.schema.js';

export function bloodBankRecordTypes(context: DbContext): RecordType[] {
  return [
    {
      name: BLOOD_RECORDS.componentType,
      readPermission: BB_READ,
      managePermission: BB_MANAGE,
      store: new DrizzleRecordStore(context, componentTypes, {
        name: BLOOD_RECORDS.componentType,
        orderBy: [componentTypes.name],
        filters: { isActive: componentTypes.isActive },
        search: [componentTypes.name, componentTypes.code],
        unique: {
          blood_component_types_name_uq: { code: 'component_name_taken', message: 'This component exists' },
          blood_component_types_code_uq: { code: 'component_code_taken', message: 'Another component has this code' },
        },
      }),
    },
  ];
}
