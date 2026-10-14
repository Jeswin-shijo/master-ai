import { Global, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

const commitHooks = new WeakMap<object, (() => void)[]>();

/**
 * Run `cb` once the surrounding transaction commits (e.g. publish a realtime
 * event only for data that is really saved). Outside a transaction it runs now.
 */
export function afterCommit(tx: Tx | Database, cb: () => void): void {
  const hooks = commitHooks.get(tx);
  if (hooks) hooks.push(cb);
  else cb();
}

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  // A hosted database (Supabase's pooler, a cloud NAT) drops idle connections: keep them alive,
  // let idle ones go after 30 s, and treat a dropped idle connection as routine. pg emits it on the
  // pool, and with no listener Node would crash the process.
  readonly pool = new Pool({ connectionString: config.APP_DATABASE_URL, max: 20, keepAlive: true, idleTimeoutMillis: 30_000 }).on('error', (err) =>
    this.logger.warn(`An idle database connection closed (${err.message}); the pool opens a new one when needed`),
  );
  readonly db: Database = drizzle(this.pool, { schema });

  /**
   * Run `fn` in a transaction scoped to one tenant. Row-level security in
   * Postgres hides every other tenant's rows, so a missing WHERE clause can
   * never leak data across companies.
   */
  async tenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const hooks: (() => void)[] = [];
    const result = await this.db.transaction(async (tx) => {
      commitHooks.set(tx, hooks);
      await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
      return fn(tx);
    });
    for (const hook of hooks) {
      try {
        hook();
      } catch (err) {
        console.error('after-commit hook failed', err);
      }
    }
    return result;
  }

  /** Tenant-less access, only for global identity tables (users) and auth lookups. */
  get global(): Database {
    return this.db;
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}

@Global()
@Module({ providers: [DbService], exports: [DbService] })
export class DbModule {}
