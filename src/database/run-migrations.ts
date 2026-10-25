import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase, createPool } from './database.provider.js';

export const MIGRATIONS_FOLDER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Applies pending, version-controlled migrations. Never generates or alters schema on its own. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl, 1);
  try {
    await migrate(createDatabase(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
