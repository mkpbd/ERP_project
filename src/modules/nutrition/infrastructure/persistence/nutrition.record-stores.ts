import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import { DIET_MANAGE, DIET_READ, NUTRITION_RECORDS } from '../../application/nutrition.messages.js';
import { dietPlans, mealTypes } from './nutrition.schema.js';

export function nutritionRecordTypes(context: DbContext): RecordType[] {
  return [
    {
      name: NUTRITION_RECORDS.mealType,
      readPermission: DIET_READ,
      managePermission: DIET_MANAGE,
      store: new DrizzleRecordStore(context, mealTypes, {
        name: NUTRITION_RECORDS.mealType,
        orderBy: [mealTypes.servedAt],
        filters: { isActive: mealTypes.isActive },
        search: [mealTypes.name],
        unique: { nutrition_meal_types_name_uq: { code: 'meal_name_taken', message: 'This meal exists' } },
      }),
    },
    {
      name: NUTRITION_RECORDS.dietPlan,
      readPermission: DIET_READ,
      managePermission: DIET_MANAGE,
      store: new DrizzleRecordStore(context, dietPlans, {
        name: NUTRITION_RECORDS.dietPlan,
        orderBy: [dietPlans.name],
        filters: { isActive: dietPlans.isActive },
        search: [dietPlans.name],
        unique: { nutrition_diet_plans_name_uq: { code: 'plan_name_taken', message: 'This diet exists' } },
      }),
    },
  ];
}
