import { describe, expect, it } from 'vitest';
import { navFor } from '../../../src/lib/nav';

const labels = (role: 'owner' | 'admin' | 'member') => navFor(role).map((i) => i.label);

describe('navigation by access role', () => {
  it('members see the work pages only', () => {
    expect(labels('member')).toEqual(['Home', 'Cases', 'Approvals', 'Team', 'Routines', 'Calls', 'Reports', 'Knowledge']);
  });

  it('the owner and admins also see the admin pages', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(labels(role)).toEqual(expect.arrayContaining(['Lists', 'Workflows', 'Agents', 'Industry pack', 'Audit', 'Settings']));
    }
  });

  it('puts Lists right under Cases, and has no Records page', () => {
    const owner = labels('owner');
    expect(owner.indexOf('Lists')).toBe(owner.indexOf('Cases') + 1);
    expect(owner).not.toContain('Records');
  });
});
