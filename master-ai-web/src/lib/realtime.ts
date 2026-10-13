import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { connectRealtime, type RealtimeStatus } from '@onehuman/sdk';
import type { RealtimeEvent } from '@onehuman/schemas';
import { API_URL } from './api';
import { useSession } from './session';

type Listener = (e: RealtimeEvent) => void;
const listeners = new Set<Listener>();

/** Subscribe a component to the live event feed. */
export function useRealtimeEvents(listener: Listener) {
  useEffect(() => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [listener]);
}

/**
 * One WebSocket per signed-in tab. Every committed audit event invalidates the
 * queries it affects, so every screen updates live without polling.
 */
export function useRealtimeConnection(): RealtimeStatus {
  const token = useSession((s) => s.token);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('closed');

  useEffect(() => {
    if (!token) return;
    const conn = connectRealtime({
      baseUrl: API_URL,
      token,
      onStatus: (s) => {
        setStatus(s);
        if (s === 'open') void queryClient.invalidateQueries();
      },
      onEvent: (event) => {
        const [area] = event.type.split('.');
        if (event.goalId) void queryClient.invalidateQueries({ queryKey: ['goal', event.goalId] });
        if (area === 'goal' || area === 'task') void queryClient.invalidateQueries({ queryKey: ['goals'] });
        if (area === 'approval' || area === 'action' || area === 'policy') void queryClient.invalidateQueries({ queryKey: ['approvals'] });
        if (area === 'agent' || area === 'autonomy' || area === 'approval') void queryClient.invalidateQueries({ queryKey: ['agents'] });
        if (area === 'record' || area === 'action') void queryClient.invalidateQueries({ queryKey: ['records'] });
        if (area === 'call' || area === 'delegation') {
          void queryClient.invalidateQueries({ queryKey: ['calls'] });
          void queryClient.invalidateQueries({ queryKey: ['delegations'] });
          void queryClient.invalidateQueries({ queryKey: ['team'] });
        }
        if (area === 'staff') void queryClient.invalidateQueries({ queryKey: ['team'] });
        if (area === 'routine' || area === 'checkin' || area === 'call') {
          void queryClient.invalidateQueries({ queryKey: ['routines'] });
          void queryClient.invalidateQueries({ queryKey: ['routine'] });
        }
        if (area === 'case' || area === 'approval') {
          void queryClient.invalidateQueries({ queryKey: ['cases'] });
          if (area === 'case' && event.refId) void queryClient.invalidateQueries({ queryKey: ['case', event.refId] });
          if (area === 'approval') void queryClient.invalidateQueries({ queryKey: ['case'] });
        }
        if (area === 'member' || area === 'invite') {
          void queryClient.invalidateQueries({ queryKey: ['members'] });
          void queryClient.invalidateQueries({ queryKey: ['invites'] });
        }
        if (area === 'intake_key') void queryClient.invalidateQueries({ queryKey: ['intake-keys'] });
        if (area === 'tenant' || area === 'workspace' || area === 'pack') {
          void queryClient.invalidateQueries({ queryKey: ['tenant'] });
          void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
        }
        if (area === 'pack') {
          void queryClient.invalidateQueries({ queryKey: ['pack-updates'] });
          void queryClient.invalidateQueries({ queryKey: ['policy'] });
        }
        void queryClient.invalidateQueries({ queryKey: ['ops'] });
        void queryClient.invalidateQueries({ queryKey: ['audit'] });
        for (const l of listeners) l(event);
      },
    });
    return () => conn.close();
  }, [token, queryClient]);

  return status;
}
