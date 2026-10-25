import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { COUNTRY, DISTRICT, DIVISION, LOCATION_MANAGE_PERMISSION } from '../../application/record-types.js';
import { countries, districts, divisions } from './location.schema.js';

export function locationRecordTypes(context: DbContext): RecordType[] {
  const managed = { readPermission: null, managePermission: LOCATION_MANAGE_PERMISSION };
  return [
    {
      name: COUNTRY,
      ...managed,
      store: new DrizzleRecordStore(context, countries, {
        name: COUNTRY,
        orderBy: [countries.name],
        unique: {
          countries_name_uq: { code: 'country_name_taken', message: 'A country with this name already exists' },
          countries_short_code_uq: { code: 'country_code_taken', message: 'A country with this code already exists' },
        },
      }),
    },
    {
      name: DIVISION,
      ...managed,
      store: new DrizzleRecordStore(context, divisions, {
        name: DIVISION,
        orderBy: [divisions.name],
        unique: {
          divisions_name_uq: { code: 'division_name_taken', message: 'A division with this name already exists' },
        },
      }),
    },
    {
      name: DISTRICT,
      ...managed,
      store: new DrizzleRecordStore(context, districts, {
        name: DISTRICT,
        orderBy: [districts.name],
        filters: { divisionId: districts.divisionId },
        unique: {
          districts_division_name_uq: {
            code: 'district_name_taken',
            message: 'This division already has a district with this name',
          },
        },
        references: { districts_division_id_divisions_id_fk: DIVISION },
      }),
    },
  ];
}
