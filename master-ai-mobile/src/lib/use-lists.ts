import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNetworkState } from 'expo-network';
import { AppState } from 'react-native';
import { api, isNetworkError, queryClient } from './api';
import { canSeeLists } from './lists';
import { useSession } from './session';

/** Every list with its card, for the owner and admins. The tab badge, the Lists tab and a list's heading share it. */
export function useListsOverview() {
  const role = useSession((s) => s.user?.role);
  return useQuery({ queryKey: ['lists'], queryFn: api.lists.overview, enabled: canSeeLists(role) });
}

/** Back from the background, the lists load again, so the badge is current. */
export function refreshListsOnForeground(): () => void {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void queryClient.invalidateQueries({ queryKey: ['lists'] });
  });
  return () => sub.remove();
}

/** No signal: the phone says it has no connection, or a load just failed for want of one. */
export function useOffline(...errors: unknown[]): boolean {
  const net = useNetworkState();
  return net.isConnected === false || errors.some(isNetworkError);
}

/** The pull-to-refresh spinner: on from a pull until that refetch settles, never for a background refetch. */
export function usePullRefresh(refetch: () => Promise<unknown>): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refetch().then(
      () => setRefreshing(false),
      () => setRefreshing(false),
    );
  }, [refetch]);
  return { refreshing, onRefresh };
}
