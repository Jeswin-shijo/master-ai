import { useQuery } from '@tanstack/react-query';
import type { ApprovalRequest } from '@onehuman/schemas';
import { api, isNetworkError } from './api';
import { cacheApprovals, cachedApprovals } from './offline';

/**
 * What this person may decide: from the server, or from the phone's saved copy
 * when there is no signal. The tab badge, the inbox and the case screen share it.
 */
export function useMyApprovals() {
  return useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: async (): Promise<{ list: ApprovalRequest[]; offline: boolean }> => {
      try {
        const list = await api.approvals.list('pending', { mine: true });
        await cacheApprovals(list);
        return { list, offline: false };
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        return { list: await cachedApprovals(), offline: true };
      }
    },
  });
}
