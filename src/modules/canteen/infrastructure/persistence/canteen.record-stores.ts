import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { CANTEEN_MANAGE, CANTEEN_READ, CANTEEN_RECORDS } from '../../application/canteen.messages.js';
import { canteenGroups, canteenItems, canteenMembers, canteenOutlets } from './canteen.schema.js';

export function canteenRecordTypes(context: DbContext): RecordType[] {
  const access = { readPermission: CANTEEN_READ, managePermission: CANTEEN_MANAGE };
  return [
    {
      name: CANTEEN_RECORDS.group,
      ...access,
      store: new DrizzleRecordStore(context, canteenGroups, {
        name: CANTEEN_RECORDS.group,
        orderBy: [canteenGroups.name],
        filters: { isActive: canteenGroups.isActive },
        search: [canteenGroups.name],
        unique: { canteen_groups_name_uq: { code: 'group_name_taken', message: 'This group exists' } },
      }),
    },
    {
      name: CANTEEN_RECORDS.item,
      ...access,
      store: new DrizzleRecordStore(context, canteenItems, {
        name: CANTEEN_RECORDS.item,
        orderBy: [canteenItems.name],
        filters: { isActive: canteenItems.isActive, groupId: canteenItems.groupId },
        search: [canteenItems.name, canteenItems.code],
        unique: {
          canteen_items_code_uq: { code: 'item_code_taken', message: 'Another item has this code' },
          canteen_items_name_uq: { code: 'item_name_taken', message: 'This item is on the menu' },
        },
        references: {
          canteen_items_group_id_canteen_groups_id_fk: 'canteen_group',
          canteen_items_stock_variant_id_item_variants_id_fk: 'store_item',
        },
      }),
    },
    {
      name: CANTEEN_RECORDS.outlet,
      ...access,
      store: new DrizzleRecordStore(context, canteenOutlets, {
        name: CANTEEN_RECORDS.outlet,
        orderBy: [canteenOutlets.name],
        filters: { isActive: canteenOutlets.isActive },
        search: [canteenOutlets.name],
        unique: { canteen_outlets_name_uq: { code: 'outlet_name_taken', message: 'This outlet exists' } },
        references: { canteen_outlets_store_department_id_store_departments_id_fk: 'store_department' },
      }),
    },
    {
      name: CANTEEN_RECORDS.member,
      ...access,
      store: new DrizzleRecordStore(context, canteenMembers, {
        name: CANTEEN_RECORDS.member,
        orderBy: [canteenMembers.name],
        filters: { isActive: canteenMembers.isActive },
        search: [canteenMembers.name, canteenMembers.mobileNo],
        unique: { canteen_members_mobile_uq: { code: 'member_mobile_taken', message: 'A member has this mobile' } },
      }),
    },
  ];
}
