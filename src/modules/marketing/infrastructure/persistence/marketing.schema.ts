import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { doctors } from '../../../hospital/infrastructure/persistence/hospital.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
// The same list as the domain's (kept literal here so drizzle-kit loads this file on its own).
const PERSON_KINDS = ['manager', 'officer', 'agent'] as const;
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};

// Old Marketing.MarketingZone.
export const marketingZones = pgTable(
  'marketing_zones',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('marketing_zones_name_uq').on(sql`lower(${t.name})`)],
);

// Old Marketing.MarketingArea: the areas of a zone.
export const marketingAreas = pgTable(
  'marketing_areas',
  {
    id: uuid('id').primaryKey(),
    zoneId: uuid('zone_id')
      .notNull()
      .references(() => marketingZones.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('marketing_areas_name_uq').on(t.zoneId, sql`lower(${t.name})`)],
);

// Old MarketingManager, MarketingJOfficerOrMedia (officers) and MarketingAgent / Media: the marketing team, each
// officer under a manager and each agent under an officer; an officer works a zone (old MarketingZoneMapping).
export const marketingPeople = pgTable(
  'marketing_people',
  {
    id: uuid('id').primaryKey(),
    kind: text('kind', { enum: PERSON_KINDS }).notNull(),
    name: text('name').notNull(),
    /** Old MarketingCodeNo / Media CodeNo. */
    code: text('code'),
    phone: text('phone'),
    parentId: uuid('parent_id').references((): AnyPgColumn => marketingPeople.id, { onDelete: 'restrict' }),
    zoneId: uuid('zone_id').references(() => marketingZones.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('marketing_people_code_uq').on(sql`upper(${t.code})`),
    index('marketing_people_parent_idx').on(t.parentId),
    check('marketing_people_parent_ck', sql`(${t.kind} = 'manager') = (${t.parentId} is null)`),
    check('marketing_people_zone_ck', sql`${t.zoneId} is null or ${t.kind} = 'officer'`),
  ],
);

// The referring doctors an officer looks after: what the hospital bills on their referrals counts to the officer.
export const marketingDoctors = pgTable('marketing_doctors', {
  doctorId: uuid('doctor_id')
    .primaryKey()
    .references(() => doctors.id, { onDelete: 'cascade' }),
  officerId: uuid('officer_id')
    .notNull()
    .references(() => marketingPeople.id, { onDelete: 'cascade' }),
});

// Old MPOSalesTarget (per officer) and GrossSalesTarget (no officer): a month's target.
export const marketingTargets = pgTable(
  'marketing_targets',
  {
    id: uuid('id').primaryKey(),
    officerId: uuid('officer_id').references(() => marketingPeople.id, { onDelete: 'cascade' }),
    year: smallint('year').notNull(),
    month: smallint('month').notNull(),
    amount: money('amount').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('marketing_targets_uq').on(
      sql`coalesce(${t.officerId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.year,
      t.month,
    ),
    check('marketing_targets_month_ck', sql`${t.month} between 1 and 12 and ${t.year} between 2000 and 2100`),
    check('marketing_targets_amount_ck', sql`${t.amount} >= 0`),
  ],
);
