import { describe, expect, it } from 'vitest';
import type { calls, staff } from '../../../src/db/schema';
import { toCall } from '../../../src/voice/call-record';

const now = new Date('2026-10-15T10:00:00Z');
const call = (over: Partial<typeof calls.$inferSelect>): typeof calls.$inferSelect => ({
  id: 'c1', tenantId: 't1', delegationId: null, checkinId: null, staffId: null, contactName: null, contactPhone: null, recordId: null, followUp: null,
  stage: 'chase', attempt: 1, status: 'ringing', provider: 'simulator', providerCallId: null, scheduledFor: now, startedAt: null, endedAt: null,
  transcript: [], summary: null, outcome: null, extracted: {}, costInr: 0, createdAt: now, ...over,
});
const anil = { id: 's1', name: 'Anil Kumar', title: 'Engineer' } as typeof staff.$inferSelect;

describe('a call as the apps see it', () => {
  it('names the outside party and the item it is about', () => {
    const c = toCall(call({ contactName: 'Sri Ganesh Traders', contactPhone: '+919847011111', extracted: { about: { listId: 'bills', itemId: 'r1', title: 'S-1042' } } }), null, 'S-1042');
    expect(c).toMatchObject({ staffId: null, staffName: 'Sri Ganesh Traders', staffTitle: 'Outside party', contact: { name: 'Sri Ganesh Traders', phone: '+919847011111' }, about: { listId: 'bills', itemId: 'r1', title: 'S-1042' } });
  });

  it('keeps a team member as before, with no contact', () => {
    const c = toCall(call({ staffId: 's1', stage: 'checkin' }), anil, 'Daily update');
    expect(c).toMatchObject({ staffId: 's1', staffName: 'Anil Kumar', staffTitle: 'Engineer', contact: null, about: null, delegationTitle: 'Daily update' });
  });
});
