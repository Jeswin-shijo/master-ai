import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/audit/audit.service';
import { DbService } from '../../src/db/db.service';
import { boot, newOrg, type Harness } from './harness';

let h: Harness;
let audit: AuditService;
let db: DbService;

beforeAll(async () => {
  h = await boot();
  audit = h.get(AuditService);
  db = h.get(DbService);
});
afterAll(() => h.close());

const note = (tenantId: string, n: number) =>
  db.tenant(tenantId, (tx) => audit.append(tx, tenantId, { type: 'tenant.settings_updated', actor: { id: null, kind: 'system' }, payload: { n } }));

describe('the audit log', () => {
  it('verifies end to end for a new company', async () => {
    const org = await newOrg(h);
    const v = await audit.verify(org.tenantId);
    expect(v).toMatchObject({ ok: true, firstBrokenSeq: null });
    expect(v.checked).toBe(v.headSeq);
    expect(v.checked).toBeGreaterThan(1);
  });

  it('numbers changes made at the same moment one after another, with no gaps or forks', async () => {
    const org = await newOrg(h);
    const before = (await audit.verify(org.tenantId)).headSeq;
    await Promise.all(Array.from({ length: 20 }, (_, n) => note(org.tenantId, n)));
    const { rows } = await h.owner.query<{ seq: string }>(`select seq::text from audit_events where tenant_id = $1 and seq > $2 order by seq`, [org.tenantId, before]);
    expect(rows.map((r) => Number(r.seq))).toEqual(Array.from({ length: 20 }, (_, i) => before + i + 1));
    expect(await audit.verify(org.tenantId)).toMatchObject({ ok: true, checked: before + 20 });
  });

  it('keeps no line for a change that was rolled back', async () => {
    const org = await newOrg(h);
    const before = (await audit.verify(org.tenantId)).headSeq;
    await db
      .tenant(org.tenantId, async (tx) => {
        await audit.append(tx, org.tenantId, { type: 'tenant.settings_updated', actor: { id: null, kind: 'system' }, payload: { lost: true } });
        throw new Error('the change failed');
      })
      .catch(() => undefined);
    await note(org.tenantId, 1);
    const v = await audit.verify(org.tenantId);
    expect(v).toMatchObject({ ok: true, headSeq: before + 1 });
  });

  it('refuses an edit even from the table owner', async () => {
    const org = await newOrg(h);
    await expect(h.owner.query(`update audit_events set payload = '{}' where tenant_id = $1 and seq = 1`, [org.tenantId])).rejects.toThrow(/append-only/);
    await expect(h.owner.query(`delete from audit_events where tenant_id = $1 and seq = 1`, [org.tenantId])).rejects.toThrow(/append-only/);
  });

  it('finds an edit made around those guards, and says which line', async () => {
    const org = await newOrg(h);
    await note(org.tenantId, 1);
    const client = await h.owner.connect();
    try {
      await client.query('begin');
      await client.query('alter table audit_events disable trigger audit_events_no_update');
      await client.query(`update audit_events set payload = '{"n": 999}' where tenant_id = $1 and seq = 2`, [org.tenantId]);
      await client.query('alter table audit_events enable trigger audit_events_no_update');
      await client.query('commit');
    } finally {
      client.release();
    }
    expect(await audit.verify(org.tenantId)).toMatchObject({ ok: false, firstBrokenSeq: 2 });
  });

  it('finds the last line deleted around the guards', async () => {
    const org = await newOrg(h);
    await note(org.tenantId, 1);
    const head = (await audit.verify(org.tenantId)).headSeq;
    const client = await h.owner.connect();
    try {
      await client.query('begin');
      await client.query('alter table audit_events disable trigger audit_events_no_update');
      await client.query(`delete from audit_events where tenant_id = $1 and seq = $2`, [org.tenantId, head]);
      await client.query('alter table audit_events enable trigger audit_events_no_update');
      await client.query('commit');
    } finally {
      client.release();
    }
    expect(await audit.verify(org.tenantId)).toMatchObject({ ok: false, headSeq: head, checked: head - 1 });
  });
});
