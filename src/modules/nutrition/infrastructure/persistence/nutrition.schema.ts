import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  primaryKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { admissions, bedCategories, patients } from '../../../hospital/infrastructure/persistence/hospital.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};

// Old Nutrition.MealType (Name, OrderValue): breakfast, lunch, snacks, dinner … and when they go out.
export const mealTypes = pgTable(
  'nutrition_meal_types',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    /** When the kitchen serves it (HH:MM, the organisation's time). */
    servedAt: text('served_at').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('nutrition_meal_types_name_uq').on(sql`lower(${t.name})`),
    check('nutrition_meal_types_time_ck', sql`${t.servedAt} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  ],
);

// Old CabinTypeAndMealMapping: the meals each bed category gets.
export const categoryMeals = pgTable(
  'nutrition_category_meals',
  {
    bedCategoryId: uuid('bed_category_id')
      .notNull()
      .references(() => bedCategories.id, { onDelete: 'cascade' }),
    mealTypeId: uuid('meal_type_id')
      .notNull()
      .references(() => mealTypes.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.bedCategoryId, t.mealTypeId] })],
);

// Old FoodPatternGroup: a diet (normal, diabetic, soft, liquid …).
export const dietPlans = pgTable(
  'nutrition_diet_plans',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('nutrition_diet_plans_name_uq').on(sql`lower(${t.name})`)],
);

// Old FoodPattern with its FoodPatternDetail items: what a diet serves at a meal, as written.
export const planMenus = pgTable(
  'nutrition_plan_menus',
  {
    planId: uuid('plan_id')
      .notNull()
      .references(() => dietPlans.id, { onDelete: 'cascade' }),
    mealTypeId: uuid('meal_type_id')
      .notNull()
      .references(() => mealTypes.id, { onDelete: 'cascade' }),
    menu: text('menu').notNull(),
  },
  (t) => [primaryKey({ columns: [t.planId, t.mealTypeId] })],
);

// Old Canteen.IPDFoodIndent (IsContinue, StoppedDate): the diet an admitted patient is on, from when to when. A new
// order ends the one before.
export const dietOrders = pgTable(
  'nutrition_diet_orders',
  {
    id: uuid('id').primaryKey(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    /** Null when nothing by mouth. */
    planId: uuid('plan_id').references(() => dietPlans.id, { onDelete: 'restrict' }),
    nilByMouth: boolean('nil_by_mouth').notNull(),
    /** Allergies, restrictions, texture … for the kitchen. */
    remarks: text('remarks'),
    fromAt: tz('from_at').notNull(),
    toAt: tz('to_at'),
    orderedBy: uuid('ordered_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    endedBy: uuid('ended_by').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('nutrition_diet_orders_admission_idx').on(t.admissionId, t.fromAt),
    uniqueIndex('nutrition_diet_orders_current_uq')
      .on(t.admissionId)
      .where(sql`${t.toAt} is null`),
    check('nutrition_diet_orders_plan_ck', sql`${t.nilByMouth} = (${t.planId} is null)`),
  ],
);

// Old FoodDeliverable (Status, ReviewedByUserId): a meal taken to the patient (or refused).
export const mealServices = pgTable(
  'nutrition_meal_services',
  {
    id: uuid('id').primaryKey(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    dietOrderId: uuid('diet_order_id')
      .notNull()
      .references(() => dietOrders.id, { onDelete: 'restrict' }),
    mealTypeId: uuid('meal_type_id')
      .notNull()
      .references(() => mealTypes.id, { onDelete: 'restrict' }),
    serviceDay: day('service_day').notNull(),
    status: text('status', { enum: ['served', 'refused'] }).notNull(),
    note: text('note'),
    servedBy: uuid('served_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    servedAt: tz('served_at').notNull(),
  },
  (t) => [uniqueIndex('nutrition_meal_services_uq').on(t.admissionId, t.mealTypeId, t.serviceDay)],
);
