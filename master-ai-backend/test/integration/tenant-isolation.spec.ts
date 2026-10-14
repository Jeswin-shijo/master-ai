import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../../src/db/db.service';
import { principals, workspaces } from '../../src/db/schema';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;
let b: Org;

beforeAll(async () => {
  h = await boot();
  [a, b] = await Promise.all([newOrg(h, 'power-plant'), newOrg(h, 'hospital')]);
});
afterAll(() => h.close());

describe('row-level security, read from the catalog', () => {
  it('is on for every table that holds a company’s rows, with the tenant policy', async () => {
    const { rows } = await h.owner.query<{ table: string; rls: boolean; policy: string | null }>(`
      select c.relname as table, c.relrowsecurity as rls,
             (select string_agg(p.qual, ' ') from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policy
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and (c.relname = 'tenants' or exists (select 1 from information_schema.columns col
              where col.table_schema = 'public' and col.table_name = c.relname and col.column_name = 'tenant_id'))`);
    expect(rows.length).toBeGreaterThan(25);
    const unprotected = rows.filter((r) => !r.rls || !r.policy?.includes('current_tenant_id()')).map((r) => r.table);
    expect(unprotected, 'tables with a tenant_id but no row-level security (add it in a _rls.sql migration)').toEqual([]);
  });

  it("gives the app's role no way around it: no superuser, no BYPASSRLS, owns no table", async () => {
    const { rows } = await h.owner.query<{ rolsuper: boolean; rolbypassrls: boolean; owned: string }>(`
      select r.rolsuper, r.rolbypassrls,
             (select count(*) from pg_tables t where t.schemaname = 'public' and t.tableowner = r.rolname)::text as owned
      from pg_roles r where r.rolname = 'onehuman_app'`);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, owned: '0' });
  });

  it('keeps the audit log append-only and logins undeletable for the app', async () => {
    const can = async (table: string, privilege: string) =>
      (await h.owner.query<{ ok: boolean }>(`select has_table_privilege('onehuman_app', $1, $2) as ok`, [table, privilege])).rows[0]!.ok;
    expect(await can('audit_events', 'INSERT')).toBe(true);
    expect(await can('audit_events', 'UPDATE')).toBe(false);
    expect(await can('audit_events', 'DELETE')).toBe(false);
    expect(await can('users', 'DELETE')).toBe(false);
  });
});

describe('row-level security, as the app sees it', () => {
  it("shows a company only its own people and workspaces", async () => {
    const db = h.get(DbService);
    const seen = await db.tenant(a.tenantId, async (tx) => ({
      people: await tx.select({ tenantId: principals.tenantId }).from(principals),
      workspaces: await tx.select({ id: workspaces.id }).from(workspaces),
    }));
    expect(seen.people.length).toBeGreaterThan(0);
    expect(new Set(seen.people.map((p) => p.tenantId))).toEqual(new Set([a.tenantId]));
    expect(seen.workspaces.map((w) => w.id)).toEqual([a.workspaceId]);
  });

  it("can't read another company's row even by its id", async () => {
    const db = h.get(DbService);
    const found = await db.tenant(a.tenantId, (tx) => tx.select().from(workspaces).where(eq(workspaces.id, b.workspaceId)));
    expect(found).toEqual([]);
  });

  it("can't write a row into another company", async () => {
    const db = h.get(DbService);
    const err = await db
      .tenant(a.tenantId, (tx) => tx.insert(principals).values({ id: randomUUID(), tenantId: b.tenantId, kind: 'human', displayName: 'Intruder', role: 'admin' }))
      .then(() => null, (e: Error) => e);
    expect((err?.cause as Error | undefined)?.message).toMatch(/violates row-level security policy/);
  });

  it('sees no company rows at all outside a company’s transaction', async () => {
    const rows = await h.get(DbService).global.select().from(principals);
    expect(rows).toEqual([]);
  });
});
