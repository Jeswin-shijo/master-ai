import { create } from 'zustand';
import type { AuthResponse, SessionUser, TenantSummary } from '@onehuman/schemas';

const STORAGE_KEY = 'onehuman.session';

interface SessionState {
  token: string | null;
  user: SessionUser | null;
  tenant: TenantSummary | null;
  signIn: (auth: AuthResponse) => void;
  setTenant: (tenant: TenantSummary) => void;
  signOut: () => void;
}

function load(): Pick<SessionState, 'token' | 'user' | 'tenant'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Pick<SessionState, 'token' | 'user' | 'tenant'>;
  } catch {
    // Storage blocked or corrupt: start signed out.
  }
  return { token: null, user: null, tenant: null };
}

function save(state: Pick<SessionState, 'token' | 'user' | 'tenant'>) {
  try {
    if (state.token) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Non-fatal.
  }
}

export const useSession = create<SessionState>((set, get) => ({
  ...load(),
  signIn: (auth) => {
    const next = { token: auth.token, user: auth.user, tenant: auth.tenant };
    save(next);
    set(next);
  },
  setTenant: (tenant) => {
    const next = { token: get().token, user: get().user, tenant };
    save(next);
    set({ tenant });
  },
  signOut: () => {
    save({ token: null, user: null, tenant: null });
    set({ token: null, user: null, tenant: null });
  },
}));
