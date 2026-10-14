import { QueryClient } from '@tanstack/react-query';
import { ApiError, createClient } from '@onehuman/sdk';
import { useSession } from './session';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

export const api = createClient({
  baseUrl: API_URL,
  getToken: () => useSession.getState().token,
});

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

/** Signing out forgets every cached answer, so the next person on this computer never sees the last one's data. */
useSession.subscribe((s, prev) => {
  if (prev.token && !s.token) queryClient.clear();
});

/** Sign out on an expired session instead of showing broken pages. */
queryClient.getQueryCache().subscribe((event) => {
  const err = event.query.state.error;
  if (err instanceof ApiError && err.status === 401) useSession.getState().signOut();
});

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
