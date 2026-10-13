import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';
import type { AuthResponse, Company, SessionUser, TenantSummary } from '@onehuman/schemas';

const KEY = 'onehuman.session';

interface SessionState {
  ready: boolean;
  token: string | null;
  user: SessionUser | null;
  tenant: TenantSummary | null;
  /** Every company this login belongs to. */
  companies: Company[];
  restore: () => Promise<void>;
  signIn: (auth: AuthResponse) => Promise<void>;
  setTenant: (tenant: TenantSummary) => void;
  /** Fresh role and approver roles from /auth/me. */
  setUser: (user: SessionUser, companies: Company[]) => void;
  signOut: () => Promise<void>;
}

/** Session token lives in the OS keychain / keystore, never in plain storage. */
export const useSession = create<SessionState>((set, get) => ({
  ready: false,
  token: null,
  user: null,
  tenant: null,
  companies: [],
  restore: async () => {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as Pick<SessionState, 'token' | 'user' | 'tenant'> & { companies?: Company[] };
        set({ ...saved, companies: saved.companies ?? [], ready: true });
        return;
      }
    } catch {
      // Unreadable entry: start signed out.
    }
    set({ ready: true });
  },
  signIn: async (auth) => {
    const next = { token: auth.token, user: auth.user, tenant: auth.tenant, companies: auth.companies ?? [] };
    await SecureStore.setItemAsync(KEY, JSON.stringify(next));
    set(next);
  },
  setTenant: (tenant) => {
    set({ tenant });
    const { token, user, companies } = get();
    void SecureStore.setItemAsync(KEY, JSON.stringify({ token, user, tenant, companies }));
  },
  setUser: (user, companies) => {
    set({ user, companies });
    const { token, tenant } = get();
    void SecureStore.setItemAsync(KEY, JSON.stringify({ token, user, tenant, companies }));
  },
  signOut: async () => {
    await SecureStore.deleteItemAsync(KEY);
    set({ token: null, user: null, tenant: null, companies: [] });
  },
}));
