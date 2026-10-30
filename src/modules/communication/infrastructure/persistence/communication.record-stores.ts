import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { COMMUNICATION_RECORDS, CONTENT_MANAGE } from '../../application/communication.ports.js';
import { healthTips } from './communication.schema.js';

export function communicationRecordTypes(context: DbContext): RecordType[] {
  return [
    {
      name: COMMUNICATION_RECORDS.healthTip,
      readPermission: CONTENT_MANAGE,
      managePermission: CONTENT_MANAGE,
      store: new DrizzleRecordStore(context, healthTips, {
        name: COMMUNICATION_RECORDS.healthTip,
        orderBy: [healthTips.displayOrder, healthTips.title],
        filters: { isActive: healthTips.isActive, category: healthTips.category },
        search: [healthTips.title, healthTips.titleBn],
      }),
    },
  ];
}
