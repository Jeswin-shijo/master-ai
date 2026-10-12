import { QueryClient } from '@tanstack/react-query';
import { ApiError, createClient } from '@onehuman/sdk';
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

queryClient.getQueryCache().subscribe((event) => {
  const err = event.query.state.error;
  if (err instanceof ApiError && err.status === 401) void useSession.getState().signOut();
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
