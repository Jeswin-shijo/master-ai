import { describe, expect, it } from 'vitest';
import { needsYouCount } from './pulse';

describe('the pulse says what needs you', () => {
  const pending = ['owner', 'safety-officer', 'safety-officer', 'credit-manager'];

  it('counts only the decisions this person can make', () => {
    expect(needsYouCount({ role: 'member', approverRoles: [] }, pending)).toBe(0);
    expect(needsYouCount({ role: 'member', approverRoles: ['safety-officer'] }, pending)).toBe(2);
    expect(needsYouCount({ role: 'admin', approverRoles: [] }, pending)).toBe(1);
    expect(needsYouCount({ role: 'owner', approverRoles: [] }, pending)).toBe(4);
  });
});
