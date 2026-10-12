import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { config } from '../config';

/** Runs migrations as the owner role. The app itself never connects as owner. */
async function main() {
  const pool = new Pool({ connectionString: config.DATABASE_URL });
  try {
    await migrate(drizzle(pool), { migrationsFolder: resolve(__dirname, '../../drizzle') });
    console.log('migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
