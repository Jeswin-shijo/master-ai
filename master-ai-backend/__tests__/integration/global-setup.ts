import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

/** A fresh, migrated `onehuman_test` database for each run (URLs from vitest.integration.config.mts). */
export default async function setup() {
  const TEST_DATABASE = 'onehuman_test';
  const admin = new pg.Client({ connectionString: process.env.INTEGRATION_ADMIN_URL });
  await admin.connect().catch((err: Error) => {
    throw new Error(`Integration specs need Postgres (pnpm infra:up): ${err.message}`);
  });
  await admin.query(`drop database if exists ${TEST_DATABASE} with (force)`);
  await admin.query(`create database ${TEST_DATABASE}`);
  await admin.query(`grant connect on database ${TEST_DATABASE} to onehuman_app`);
  await admin.end();

  const owner = new pg.Pool({ connectionString: process.env.INTEGRATION_OWNER_URL });
  await owner.query('create extension if not exists vector');
  await owner.query('create extension if not exists citext');
  await migrate(drizzle(owner), { migrationsFolder: resolve(__dirname, '../../drizzle') });
  await owner.end();
}
