import { create } from 'zustand';
import type { AuthResponse, Company, SessionUser, TenantSummary } from '@onehuman/schemas';

const STORAGE_KEY = 'onehuman.session';

interface SessionState {
  token: string | null;
  user: SessionUser | null;
  tenant: TenantSummary | null;
  /** Every company this login belongs to. */
  companies: Company[];
  signIn: (auth: AuthResponse) => void;
  setTenant: (tenant: TenantSummary) => void;
  /** Fresh role and approver roles from /auth/me: a change applies without signing in again. */
  setUser: (user: SessionUser, companies: Company[]) => void;
  signOut: () => void;
}

type Saved = Pick<SessionState, 'token' | 'user' | 'tenant' | 'companies'>;

function load(): Saved {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { companies: [], ...(JSON.parse(raw) as Partial<Saved>) } as Saved;
  } catch {
    // Storage blocked or corrupt: start signed out.
  }
  return { token: null, user: null, tenant: null, companies: [] };
}

function save(state: Saved) {
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
    const next = { token: auth.token, user: auth.user, tenant: auth.tenant, companies: auth.companies ?? [] };
    save(next);
    set(next);
  },
  setTenant: (tenant) => {
    const next = { token: get().token, user: get().user, tenant, companies: get().companies };
    save(next);
    set({ tenant });
  },
  setUser: (user, companies) => {
    const next = { token: get().token, user, tenant: get().tenant, companies };
    save(next);
    set({ user, companies });
  },
  signOut: () => {
    save({ token: null, user: null, tenant: null, companies: [] });
    set({ token: null, user: null, tenant: null, companies: [] });
  },
}));
