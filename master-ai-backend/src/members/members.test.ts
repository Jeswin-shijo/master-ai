import { describe, expect, it } from 'vitest';
import { LifecycleSchema } from '@onehuman/schemas';
import { mergeLifecycles } from '@onehuman/agent-kit';
import { hashInviteToken, inviterStillAllowed, inviteStatus, memberChangeRefusal, newInviteToken, principalChanges, unknownApproverRoles } from './invite-rules';

describe('invite tokens', () => {
  it('are long, random and kept only as a hash', () => {
    const a = newInviteToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(newInviteToken().token);
    expect(a.hash).toBe(hashInviteToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
});

describe('invite status', () => {
  const now = new Date('2026-10-13T10:00:00Z');
  const base = { acceptedAt: null, revokedAt: null, expiresAt: new Date('2026-10-20T10:00:00Z') };

  it('tells pending, accepted, revoked and expired apart', () => {
    expect(inviteStatus(base, now)).toBe('pending');
    expect(inviteStatus({ ...base, acceptedAt: now }, now)).toBe('accepted');
    expect(inviteStatus({ ...base, revokedAt: now }, now)).toBe('revoked');
    expect(inviteStatus({ ...base, expiresAt: new Date('2026-10-13T09:59:59Z') }, now)).toBe('expired');
  });
});

describe('approver roles', () => {
  const lc = mergeLifecycles([LifecycleSchema.parse({ roles: [{ id: 'safety-officer', name: 'Safety officer', approves: 'Hot work' }] })]);

  it('names roles the organization does not have, and never grants "owner"', () => {
    expect(unknownApproverRoles(['safety-officer'], lc)).toEqual([]);
    expect(unknownApproverRoles(['safety-officer', 'chief-wizard', 'owner'], lc)).toEqual(['chief-wizard', 'owner']);
  });
});

describe('who may change whom', () => {
  const owner = { id: 'p-owner', role: 'owner' as const };
  const admin = { id: 'p-admin', role: 'admin' as const };

  it('refuses changes to the owner and to yourself', () => {
    expect(memberChangeRefusal(admin, { id: 'p-owner', role: 'owner' }, { approverRoles: [] })).toMatch(/owner/);
    expect(memberChangeRefusal(admin, { id: 'p-admin', role: 'admin' }, { approverRoles: ['safety-officer'] })).toMatch(/your own/);
    expect(memberChangeRefusal(owner, { id: 'p-owner', role: 'owner' }, { remove: true })).toMatch(/owner/);
  });

  it('lets the owner and admins change other people', () => {
    expect(memberChangeRefusal(admin, { id: 'p-m', role: 'member' }, { role: 'admin' })).toBeNull();
    expect(memberChangeRefusal(owner, { id: 'p-admin', role: 'admin' }, { remove: true })).toBeNull();
  });
});

describe('updating a member', () => {
  it('changes nothing on the principal when only the staff link changes', () => {
    expect(principalChanges({ staffId: null })).toBeNull();
    expect(principalChanges({ staffId: 's1' })).toBeNull();
  });

  it('keeps the access fields that were given', () => {
    expect(principalChanges({ role: 'admin' })).toEqual({ role: 'admin' });
    expect(principalChanges({ approverRoles: [] })).toEqual({ approverRoles: [] });
  });
});

describe('an invite after its maker lost access', () => {
  it('works only while the person who made it is still an active owner or admin', () => {
    expect(inviterStillAllowed({ role: 'admin', status: 'active' })).toBe(true);
    expect(inviterStillAllowed({ role: 'owner', status: 'active' })).toBe(true);
    expect(inviterStillAllowed({ role: 'admin', status: 'retired' })).toBe(false);
    expect(inviterStillAllowed({ role: 'member', status: 'active' })).toBe(false);
    expect(inviterStillAllowed(null)).toBe(false);
  });
});
