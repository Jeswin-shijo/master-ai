import { describe, expect, it } from 'vitest';
import type { LifecycleRole, Member } from '@onehuman/schemas';
import { canEditMember, canRemoveMember, roleHolders } from './people';

const member = (over: Partial<Member>): Member => ({
  id: 'p1', name: 'Sunita', email: 's@example.com', role: 'member', approverRoles: [], status: 'active', staffId: null, createdAt: '2026-10-13T04:30:00Z', ...over,
});
const roles: LifecycleRole[] = [
  { id: 'owner', name: 'Owner', approves: 'anything' },
  { id: 'safety-officer', name: 'Safety officer', approves: 'hot work and confined spaces' },
  { id: 'finance-head', name: 'Finance head', approves: 'spends above ₹1,00,000' },
];

describe('who approves what', () => {
  it('lists the active holders of each role, and leaves out the owner role', () => {
    const team = [
      member({ id: 'a', name: 'Sunita', approverRoles: ['safety-officer'] }),
      member({ id: 'b', name: 'Manoj', approverRoles: ['safety-officer'], status: 'paused' }),
    ];
    expect(roleHolders(roles, team)).toEqual([
      { role: roles[1], holders: ['Sunita'] },
      { role: roles[2], holders: [] },
    ]);
  });
});

describe('who may change whom', () => {
  const owner = { role: 'owner' as const, principalId: 'o' };
  const admin = { role: 'admin' as const, principalId: 'a' };
  const plain = { role: 'member' as const, principalId: 'm' };

  it('members change nobody, and nobody changes the owner here', () => {
    expect(canEditMember(plain, member({}))).toBe(false);
    expect(canEditMember(admin, member({ role: 'owner' }))).toBe(false);
    expect(canEditMember(owner, member({ role: 'admin' }))).toBe(true);
  });

  it('nobody removes themself', () => {
    expect(canRemoveMember(admin, member({ id: 'a', role: 'admin' }))).toBe(false);
    expect(canRemoveMember(owner, member({ id: 'x' }))).toBe(true);
  });
});
