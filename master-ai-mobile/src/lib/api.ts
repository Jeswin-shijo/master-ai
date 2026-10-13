import { QueryClient } from '@tanstack/react-query';
import { ApiError, createClient } from '@onehuman/sdk';
import type { AuthResponse } from '@onehuman/schemas';
import { API_URL } from './config';
import { useSession } from './session';

export const api = createClient({ baseUrl: API_URL, getToken: () => useSession.getState().token });

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

/**
 * One phone, one person at a time: whatever the last person's screens loaded
 * (approvals, cases, who they are) is forgotten when a session starts or ends.
 */
export async function startSession(auth: AuthResponse) {
  queryClient.clear();
  await useSession.getState().signIn(auth);
}

export async function endSession() {
  queryClient.clear();
  await useSession.getState().signOut();
}

queryClient.getQueryCache().subscribe((event) => {
  const err = event.query.state.error;
  if (err instanceof ApiError && err.status === 401) void endSession();
});

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}

/** True when the request failed because we're offline (no HTTP response at all). */
export function isNetworkError(err: unknown): boolean {
  return !(err instanceof ApiError) && err instanceof Error;
}
