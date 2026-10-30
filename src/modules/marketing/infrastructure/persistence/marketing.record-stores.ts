import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { MARKETING_RECORDS, MKT_MANAGE, MKT_READ } from '../../application/marketing.messages.js';
import { marketingAreas, marketingZones } from './marketing.schema.js';

export function marketingRecordTypes(context: DbContext): RecordType[] {
  const access = { readPermission: MKT_READ, managePermission: MKT_MANAGE };
  return [
    {
      name: MARKETING_RECORDS.zone,
      ...access,
      store: new DrizzleRecordStore(context, marketingZones, {
        name: MARKETING_RECORDS.zone,
        orderBy: [marketingZones.name],
        filters: { isActive: marketingZones.isActive },
        search: [marketingZones.name],
        unique: { marketing_zones_name_uq: { code: 'zone_name_taken', message: 'This zone exists' } },
      }),
    },
    {
      name: MARKETING_RECORDS.area,
      ...access,
      store: new DrizzleRecordStore(context, marketingAreas, {
        name: MARKETING_RECORDS.area,
        orderBy: [marketingAreas.name],
        filters: { isActive: marketingAreas.isActive, zoneId: marketingAreas.zoneId },
        search: [marketingAreas.name],
        unique: { marketing_areas_name_uq: { code: 'area_name_taken', message: 'The zone has this area' } },
        references: { marketing_areas_zone_id_marketing_zones_id_fk: 'marketing_zone' },
      }),
    },
  ];
}
