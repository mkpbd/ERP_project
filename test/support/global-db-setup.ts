import pg from 'pg';
import { runMigrations } from '../../src/database/run-migrations.js';
import { testEnvironment } from './test-env.js';

/** Recreates the test schema from the real migrations once per test run. */
export default async function setup(): Promise<void> {
  const url = testEnvironment().DATABASE_URL!;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('drop schema if exists public cascade');
    await client.query('drop schema if exists drizzle cascade');
    await client.query('create schema public');
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
