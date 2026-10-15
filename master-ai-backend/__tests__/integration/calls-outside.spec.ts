import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DbService } from '../../src/db/db.service';
import { calls } from '../../src/db/schema';
import { CallsService } from '../../src/voice/calls.service';
import { boot, newOrg, type Harness, type Org } from './harness';

let h: Harness;
let a: Org;
beforeAll(async () => {
  h = await boot();
  a = await newOrg(h, 'wholesale-retail');
});
afterAll(() => h.close());

describe('calls to outside parties', () => {
  it('lists a call to a party with who it was to and what it was about', async () => {
    const itemId = randomUUID();
    const [row] = await h.get(DbService).tenant(a.tenantId, (tx) =>
      tx
        .insert(calls)
        .values({
          tenantId: a.tenantId,
          stage: 'chase',
          attempt: 1,
          status: 'completed',
          provider: 'simulator',
          contactName: 'Sri Ganesh Traders',
          contactPhone: '+91 98470 11111',
          followUp: 'bills.unpaid-bills',
          extracted: { about: { listId: 'bills', itemId, title: 'S-1042' } },
        })
        .returning(),
    );
    const listed = (await h.get(CallsService).list(a.tenantId)).find((c) => c.id === row!.id);
    expect(listed).toMatchObject({
      staffId: null,
      staffName: 'Sri Ganesh Traders',
      staffTitle: 'Outside party',
      contact: { name: 'Sri Ganesh Traders', phone: '+91 98470 11111' },
      about: { listId: 'bills', itemId, title: 'S-1042' },
      delegationTitle: 'S-1042',
    });
    expect((await h.get(CallsService).get(a.tenantId, row!.id)).staffName).toBe('Sri Ganesh Traders');
  });

  it('refuses a call with nobody to call', async () => {
    type PgErr = { constraint?: string; cause?: { constraint?: string } };
    const err = (await h
      .get(DbService)
      .tenant(a.tenantId, (tx) => tx.insert(calls).values({ tenantId: a.tenantId, stage: 'chase', attempt: 1, provider: 'simulator' }))
      .catch((e: unknown) => e as PgErr)) as PgErr;
    expect(err?.cause?.constraint ?? err?.constraint).toBe('calls_who');
  });
});
