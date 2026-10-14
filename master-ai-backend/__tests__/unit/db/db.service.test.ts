import { describe, expect, it } from 'vitest';
import { DbService } from '../../../src/db/db.service';

describe('the database pool', () => {
  it('survives an idle connection dropped by the database or the network', () => {
    const db = new DbService();
    // pg emits "error" on the pool when an idle client's socket dies (Supabase's pooler, a NAT, Wi-Fi).
    // With no listener, Node turns that into an uncaught exception and the process dies.
    expect(() => db.pool.emit('error', Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }), {} as never)).not.toThrow();
    void db.pool.end();
  });

  it('keeps connections alive and lets idle ones go before a hosted pooler drops them', () => {
    const db = new DbService();
    expect(db.pool.options.keepAlive).toBe(true);
    expect(db.pool.options.idleTimeoutMillis).toBeLessThanOrEqual(60_000);
    void db.pool.end();
  });
});
