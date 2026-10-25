/**
 * Applies pending, reviewed migrations from src/database/migrations.
 * Run with a database role that owns the schema (not the application role).
 */
import { runMigrations } from '../database/run-migrations.js';
import { loadLocalEnv } from './load-env.js';

loadLocalEnv();
const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set MIGRATION_DATABASE_URL or DATABASE_URL');
  process.exit(1);
}

await runMigrations(url);
console.log('Migrations applied');
