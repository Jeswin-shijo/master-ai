import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthResponse } from '@onehuman/schemas';

/**
 * One phone, one person at a time: whatever the last person's screens loaded
 * (their approvals, their cases, who they are) must not reach the next person.
 */

const session = vi.hoisted(() => ({ token: 't', signIn: vi.fn(async () => undefined), signOut: vi.fn(async () => undefined) }));
vi.mock('../src/lib/config', () => ({ API_URL: 'http://localhost:3000' }));
vi.mock('../src/lib/session', () => ({ useSession: { getState: () => session } }));

const { endSession, queryClient, startSession } = await import('../src/lib/api');

describe('signing in and out on a shared phone', () => {
  beforeEach(() => {
    queryClient.setQueryData(['me'], { user: { principalId: 'sunita' } });
    queryClient.setQueryData(['approvals', 'pending'], { list: [{ id: 'hot-work-gate' }], offline: false });
  });

  it("forgets the last person's data when they sign out", async () => {
    await endSession();
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
    expect(queryClient.getQueryData(['approvals', 'pending'])).toBeUndefined();
    expect(session.signOut).toHaveBeenCalled();
  });

  it('starts the next person with nothing from before', async () => {
    await startSession({ token: 'manoj' } as AuthResponse);
    expect(queryClient.getQueryData(['me'])).toBeUndefined();
    expect(session.signIn).toHaveBeenCalledWith({ token: 'manoj' });
  });
});
