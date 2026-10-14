import { describe, expect, it } from 'vitest';
import type { AuthResponse } from '@onehuman/schemas';
import { queryClient } from './api';
import { useSession } from './session';

const auth = (token: string) => ({ token, user: { name: 'Asha' }, tenant: { name: 'Kochi Thermal' }, companies: [] }) as unknown as AuthResponse;

describe('the data cache and the session', () => {
  it("forgets the last person's data when they sign out, so the next person on this computer never sees it", () => {
    useSession.getState().signIn(auth('asha'));
    queryClient.setQueryData(['cases'], ['JOB-0001 · Lineman shock']);
    useSession.getState().signOut();
    expect(queryClient.getQueryData(['cases'])).toBeUndefined();
  });

  it('keeps the data while the same person stays signed in', () => {
    useSession.getState().signIn(auth('asha'));
    queryClient.setQueryData(['cases'], ['JOB-0001 · Lineman shock']);
    useSession.getState().setUser({ name: 'Asha K' } as never, []);
    expect(queryClient.getQueryData(['cases'])).toEqual(['JOB-0001 · Lineman shock']);
  });
});
