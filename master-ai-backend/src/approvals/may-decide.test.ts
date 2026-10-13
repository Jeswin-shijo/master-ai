import { describe, expect, it } from 'vitest';
import { mayDecide, routeApprover } from './may-decide';

describe('who may decide an approval', () => {
  it('lets the owner decide anything', () => {
    expect(mayDecide({ role: 'owner', approverRoles: [] }, 'safety-officer')).toBe(true);
    expect(mayDecide({ role: 'owner', approverRoles: [] }, 'owner')).toBe(true);
  });

  it('lets an admin decide what goes to the owner, and their own roles', () => {
    expect(mayDecide({ role: 'admin', approverRoles: [] }, 'owner')).toBe(true);
    expect(mayDecide({ role: 'admin', approverRoles: [] }, 'safety-officer')).toBe(false);
    expect(mayDecide({ role: 'admin', approverRoles: ['safety-officer'] }, 'safety-officer')).toBe(true);
  });

  it('lets a member decide only the roles they hold', () => {
    expect(mayDecide({ role: 'member', approverRoles: [] }, 'owner')).toBe(false);
    expect(mayDecide({ role: 'member', approverRoles: ['credit-manager'] }, 'credit-manager')).toBe(true);
    expect(mayDecide({ role: 'member', approverRoles: ['credit-manager'] }, 'branch-manager')).toBe(false);
  });

  it('still lets an access role decide approvals routed to it', () => {
    expect(mayDecide({ role: 'admin', approverRoles: [] }, 'admin')).toBe(true);
  });
});

describe('routing a gate', () => {
  it('goes to the role when someone holds it', () => {
    expect(routeApprover('safety-officer', 2, 'Safety officer')).toEqual({ approver: 'safety-officer', note: null });
  });

  it('falls back to the owner and says why', () => {
    expect(routeApprover('safety-officer', 0, 'Safety officer')).toEqual({
      approver: 'owner',
      note: 'Nobody holds the Safety officer role yet, so it came to the owner.',
    });
  });

  it('keeps owner approvals with the owner', () => {
    expect(routeApprover('owner', 0, 'Owner')).toEqual({ approver: 'owner', note: null });
  });
});
