import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import type { AuthResponse, SessionUser, TenantSummary } from '@onehuman/schemas';

const KEY = 'onehuman.session';

interface SessionState {
  ready: boolean;
  token: string | null;
  user: SessionUser | null;
  tenant: TenantSummary | null;
  restore: () => Promise<void>;
  signIn: (auth: AuthResponse) => Promise<void>;
  setTenant: (tenant: TenantSummary) => void;
  signOut: () => Promise<void>;
}

/** Session token lives in the OS keychain / keystore, never in plain storage. */
export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  token: null,
  user: null,
  tenant: null,
  restore: async () => {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Pick<SessionState, 'token' | 'user' | 'tenant'>;
        set({ ...saved, ready: true });
        return;
      }
    } catch {
      // Unreadable entry: start signed out.
    }
    set({ ready: true });
  },
  signIn: async (auth) => {
    const next = { token: auth.token, user: auth.user, tenant: auth.tenant };
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    set(next);
  },
  setTenant: (tenant) => {
    set({ tenant });
    const { token, user } = get();
    void SecureStore.setItemAsync(KEY, JSON.stringify({ token, user, tenant }));
  },
  signOut: async () => {
    await SecureStore.deleteItemAsync(KEY);
    set({ token: null, user: null, tenant: null });
  },
}));
