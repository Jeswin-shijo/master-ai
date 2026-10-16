import { describe, expect, it } from 'vitest';
import type { DbService } from '../../../src/db/db.service';
import { NotificationsService } from '../../../src/notifications/notifications.service';
import { pushAudience } from '../../../src/notifications/audience';

const people = [
  { id: 'owner', role: 'owner', status: 'active', approverRoles: [] },
  { id: 'admin', role: 'admin', status: 'active', approverRoles: [] },
  { id: 'safety', role: 'member', status: 'active', approverRoles: ['safety-officer'] },
  { id: 'clerk', role: 'member', status: 'active', approverRoles: [] },
  { id: 'gone', role: 'member', status: 'retired', approverRoles: ['safety-officer'] },
];

describe('who gets a push', () => {
  it("sends a role's approvals to its holders and the owner", () => {
    expect(pushAudience(people, { role: 'safety-officer' }).sort()).toEqual(['owner', 'safety']);
  });

  it('sends owner-routed and company news to the owner and admins only', () => {
    expect(pushAudience(people, { role: 'owner' }).sort()).toEqual(['admin', 'owner']);
    expect(pushAudience(people, 'managers').sort()).toEqual(['admin', 'owner']);
  });
});

describe('a push that cannot find who to tell', () => {
  it('does not reject when the database fails, so a fire-and-forget push cannot end the process', async () => {
    const db = { tenant: async () => { throw new Error('db down'); } } as unknown as DbService;
    await expect(new NotificationsService(db).pushToManagers('t', { title: 'a', body: 'b' })).resolves.toBeUndefined();
  });
});
