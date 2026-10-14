import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;

beforeAll(async () => {
  h = await boot();
  a = await newOrg(h, 'wholesale-retail');
});
afterAll(() => h.close());

describe('reading numbers and dates out of records', () => {
  it('turns anything that is not a valid number or date into null instead of failing', async () => {
    const { rows } = await h.owner.query(`
      select try_numeric('48260') as n, try_numeric('abc') as bad_n, try_numeric('NaN') as nan, try_numeric('') as empty,
             try_date('2026-10-14') as d, try_date('2026-13-45') as bad_d, try_date('soon') as word,
             try_timestamptz('2026-10-14T10:00:00Z') as t, try_timestamptz('2026-10-14T99:00:00Z') as bad_t`);
    expect(rows[0]).toMatchObject({ n: '48260', bad_n: null, nan: null, empty: null, bad_d: null, word: null, bad_t: null });
    expect(rows[0].d).not.toBeNull();
    expect(rows[0].t).not.toBeNull();
  });

  it('lets the app role use them', async () => {
    const { rows } = await h.owner.query(`
      select bool_and(has_function_privilege('onehuman_app', f, 'EXECUTE')) as ok
      from unnest(array['try_numeric(text)', 'try_date(text)', 'try_timestamptz(text)']) f`);
    expect(rows[0].ok).toBe(true);
  });
});

describe('the backfill for items saved before this', () => {
  it('marks the sample items seeded at install as samples', async () => {
    await h.owner.query(`update records set source = 'manual' where tenant_id = $1`, [a.tenantId]);
    const sql = readFileSync(join(__dirname, '../../drizzle/0013_record_lists_backfill.sql'), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint').filter((s) => /^\s*(--.*\n\s*)*UPDATE/i.test(s))) {
      await h.owner.query(statement);
    }
    const { rows } = await h.owner.query(`select distinct source from records where tenant_id = $1`, [a.tenantId]);
    expect(rows).toEqual([{ source: 'sample' }]);
  });

  it('starts every item as not checked, with nothing acknowledged', async () => {
    const { rows } = await h.owner.query(
      `select count(*)::int as n from records where tenant_id = $1 and (checked_at is not null or checked_problems <> '{}')`,
      [a.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });
});
