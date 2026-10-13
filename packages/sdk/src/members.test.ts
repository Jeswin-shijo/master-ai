import { describe, expect, it } from 'vitest';
import { AcceptInviteInputSchema, CreateInviteInputSchema, summarizeEvent, UpdateMemberInputSchema } from '@onehuman/schemas';
import { createClient } from './client';

describe('invite and member bodies', () => {
  it('invites an admin or a member, never an owner', () => {
    expect(CreateInviteInputSchema.safeParse({ name: 'Sunita', email: 'sunita@example.com', role: 'member', approverRoles: ['safety-officer'] }).success).toBe(true);
    expect(CreateInviteInputSchema.safeParse({ name: 'Sunita', email: 'sunita@example.com', role: 'owner' }).success).toBe(false);
  });

  it('defaults to a member with no approver roles', () => {
    expect(CreateInviteInputSchema.parse({ name: 'Manoj', email: 'Manoj@Example.com' })).toEqual({ name: 'Manoj', email: 'manoj@example.com', role: 'member', approverRoles: [] });
  });

  it('needs a real password to accept', () => {
    expect(AcceptInviteInputSchema.safeParse({ password: 'short' }).success).toBe(false);
    expect(AcceptInviteInputSchema.safeParse({ password: 'long enough', name: 'Sunita' }).success).toBe(true);
  });

  it('changes something when a member is updated', () => {
    expect(UpdateMemberInputSchema.safeParse({}).success).toBe(false);
    expect(UpdateMemberInputSchema.safeParse({ approverRoles: ['credit-manager'] }).success).toBe(true);
    expect(UpdateMemberInputSchema.safeParse({ staffId: null }).success).toBe(true);
  });

  it('reads member events as sentences', () => {
    expect(summarizeEvent('member.joined', { name: 'Sunita', role: 'member' })).toBe('Sunita joined the company');
    expect(summarizeEvent('member.invited', { name: 'Sunita' })).toBe('Invited Sunita');
  });
});

describe('approvals inbox client', () => {
  it('asks for "mine" when told to', async () => {
    const urls: string[] = [];
    const api = createClient({
      baseUrl: 'http://api.test',
      fetch: (async (url: string) => {
        urls.push(url);
        return new Response('[]', { status: 200 });
      }) as unknown as typeof fetch,
    });
    await api.approvals.list('pending', { mine: true });
    expect(urls[0]).toBe('http://api.test/approvals?status=pending&mine=true');
  });
});
