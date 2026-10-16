import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectRealtime } from '@onehuman/sdk';
import { api } from './api';
import { API_URL } from './config';
import { useSession } from './session';

/** Live updates from the same event stream the web command center uses. */
export function useRealtime() {
  const token = useSession((s) => s.token);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!token) return;
    const conn = connectRealtime({
      baseUrl: API_URL,
      ticket: () => api.auth.streamTicket().then((r) => r.ticket),
      onStatus: (s) => s === 'open' && void queryClient.invalidateQueries(),
      onEvent: (e) => {
        const area = e.type.split('.')[0];
        if (area === 'approval' || area === 'policy' || area === 'action') void queryClient.invalidateQueries({ queryKey: ['approvals'] });
        if (area === 'note' || area === 'record' || area === 'call') {
          for (const key of ['lists', 'list', 'list-item']) void queryClient.invalidateQueries({ queryKey: [key] });
        }
        if (area === 'goal' || area === 'task' || area === 'action') {
          void queryClient.invalidateQueries({ queryKey: ['goals'] });
          if (e.goalId) void queryClient.invalidateQueries({ queryKey: ['goal', e.goalId] });
        }
        if (area === 'tenant') void queryClient.invalidateQueries({ queryKey: ['tenant'] });
        if (area === 'call' || area === 'delegation') void queryClient.invalidateQueries({ queryKey: ['delegations'] });
        if (area === 'routine' || area === 'checkin' || area === 'call') void queryClient.invalidateQueries({ queryKey: ['routines'] });
        if (area === 'case' || area === 'approval') {
          void queryClient.invalidateQueries({ queryKey: ['cases'] });
          void queryClient.invalidateQueries({ queryKey: ['case'] });
        }
        void queryClient.invalidateQueries({ queryKey: ['pulse'] });
      },
    });
    return () => conn.close();
  }, [token, queryClient]);
}
