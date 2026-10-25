import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';

export const PG_POOL = Symbol('PG_POOL');
export const DRIZZLE = Symbol('DRIZZLE');

export type Database = NodePgDatabase;
/** Either the root database or an open transaction; both expose the same query builder. */
export type DbExecutor = PgDatabase<NodePgQueryResultHKT>;

export function createPool(url: string, max: number): pg.Pool {
  return new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'erp-backend',
  });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle({ client: pool });
}
