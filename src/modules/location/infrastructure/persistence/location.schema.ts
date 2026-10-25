import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};

// Old API: Admin.Countries (int ids).
export const countries = pgTable(
  'countries',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    nationality: text('nationality').notNull().default(''),
    shortCode: text('short_code'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('countries_name_uq').on(sql`lower(${t.name})`),
    uniqueIndex('countries_short_code_uq').on(sql`upper(${t.shortCode})`),
    check('countries_name_len_ck', sql`char_length(${t.name}) between 1 and 100`),
  ],
);

// Old API: Location.Divisions (int ids).
export const divisions = pgTable(
  'divisions',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('divisions_name_uq').on(sql`lower(${t.name})`),
    check('divisions_name_len_ck', sql`char_length(${t.name}) between 1 and 100`),
  ],
);

// Old API: Location.Districts (int ids). BnName → name_bn.
export const districts = pgTable(
  'districts',
  {
    id: uuid('id').primaryKey(),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    nameBn: text('name_bn'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('districts_division_name_uq').on(t.divisionId, sql`lower(${t.name})`),
    index('districts_division_idx').on(t.divisionId),
    check('districts_name_len_ck', sql`char_length(${t.name}) between 1 and 100`),
  ],
);
