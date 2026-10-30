import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// What each record of the old system became here: re-runs load only what is not mapped yet.
export const etlIdMap = pgTable(
  'etl_id_map',
  {
    /** The kind of record: patient, doctor, user, role … */
    entity: text('entity').notNull(),
    oldId: text('old_id').notNull(),
    newId: uuid('new_id').notNull(),
    loadedAt: tz('loaded_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.entity, t.oldId] })],
);

// Every run of the data migration, dry or not, with what each loader read, wrote, kept and rejected.
export const etlRuns = pgTable('etl_runs', {
  id: uuid('id').primaryKey(),
  startedAt: tz('started_at').notNull(),
  finishedAt: tz('finished_at'),
  dryRun: boolean('dry_run').notNull(),
  loaders: text('loaders').array().notNull(),
  status: text('status', { enum: ['running', 'done', 'failed'] }).notNull(),
  written: integer('written').notNull().default(0),
  rejected: integer('rejected').notNull().default(0),
  report: jsonb('report').$type<unknown>().notNull().default({}),
  error: text('error'),
});
