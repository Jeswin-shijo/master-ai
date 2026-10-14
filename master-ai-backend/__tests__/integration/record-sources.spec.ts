import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { resolveTool } from '@onehuman/agent-kit';
import { ConnectorsService } from '../../src/connectors/connectors.service';
import { DbService } from '../../src/db/db.service';
import { auditEvents, records } from '../../src/db/schema';
import { RecordsService } from '../../src/records/records.service';
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

describe('how each item came in', () => {
  const rows = (tenantId: string) => h.get(DbService).tenant(tenantId, (tx) => tx.select().from(records));

  it('marks seeded items as samples, not checked, with references pointing at sample items', async () => {
    const all = await rows(a.tenantId);
    expect(new Set(all.map((r) => r.source))).toEqual(new Set(['sample']));
    expect(all.every((r) => r.checkedAt === null)).toBe(true);
    const bill = all.find((r) => r.entity === 'Bill')!;
    expect(all.some((r) => r.entity === 'Party' && r.id === bill.data.party)).toBe(true);
  });

  it("checks the owner's own items, not a member's", async () => {
    const svc = h.get(RecordsService);
    const mine = await svc.createFromApi(a.tenantId, a.session.principalId, 'owner', 'Party', { name: 'Owner Traders', partyType: 'retailer' });
    const theirs = await svc.createFromApi(a.tenantId, a.session.principalId, 'member', 'Party', { name: 'Member Traders', partyType: 'retailer' });
    const all = await rows(a.tenantId);
    expect(all.find((r) => r.id === mine.id)).toMatchObject({ source: 'manual', createdBy: a.session.principalId, checkedBy: a.session.principalId });
    expect(all.find((r) => r.id === theirs.id)).toMatchObject({ source: 'manual', checkedBy: null, checkedAt: null });
  });

  it("says an AI agent added or changed an item; an agent's change clears the check and is audited with the old and new values", async () => {
    const db = h.get(DbService);
    const connectors = h.get(ConnectorsService);
    const toolCallId = randomUUID();
    const owner = await h.get(RecordsService).createFromApi(a.tenantId, a.session.principalId, 'owner', 'Party', { name: 'Checked Traders', partyType: 'retailer', city: 'Kochi' });
    const result = await db.tenant(a.tenantId, async (tx) => {
      const ws = await h.get(RecordsService).activeWorkspace(tx);
      const ctx = { tx, tenantId: a.tenantId, workspace: ws, toolCallId, actor: { id: null, kind: 'agent' as const } };
      const created = (await connectors.execute(ctx, resolveTool(ws.pack, 'records.create')!, { entity: 'Party', data: { name: 'Agent Traders', partyType: 'retailer' } })) as { id: string };
      await connectors.execute(ctx, resolveTool(ws.pack, 'records.update')!, { entity: 'Party', id: owner.id, patch: { city: 'Pune' } });
      return created;
    });
    const all = await rows(a.tenantId);
    expect(all.find((r) => r.id === result.id)).toMatchObject({ source: 'agent', sourceRef: toolCallId, checkedAt: null });
    expect(all.find((r) => r.id === owner.id)).toMatchObject({ updatedVia: 'agent', updatedRef: toolCallId, checkedBy: null, checkedAt: null });
    const [event] = await db.tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.refId, owner.id)).then((e) => e.filter((x) => x.type === 'record.updated')));
    expect(event!.payload).toMatchObject({ entity: 'Party', title: 'Checked Traders', via: 'agent', changes: [{ field: 'city', from: 'Kochi', to: 'Pune' }] });
  });

  it('records nothing when an update changes nothing', async () => {
    const db = h.get(DbService);
    const owner = await h.get(RecordsService).createFromApi(a.tenantId, a.session.principalId, 'owner', 'Party', { name: 'Same Traders', partyType: 'retailer' });
    await db.tenant(a.tenantId, async (tx) => {
      const ws = await h.get(RecordsService).activeWorkspace(tx);
      await h.get(RecordsService).update(tx, a.tenantId, ws, 'Party', owner.id, { name: 'Same Traders' }, { actor: { id: null, kind: 'agent' }, via: 'agent' });
    });
    const events = await db.tenant(a.tenantId, (tx) => tx.select().from(auditEvents).where(eq(auditEvents.refId, owner.id)));
    expect(events.map((e) => e.type)).toEqual(['record.created']);
    expect((await rows(a.tenantId)).find((r) => r.id === owner.id)!.checkedBy).toBe(a.session.principalId);
  });
});
