import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LogOut, Menu, Plus, Power, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router';
import { brandPalette, darkPalette, lightPalette } from '@onehuman/ui';
import { NewRequestDialog } from '@/components/new-request';
import { PhoneSimulator } from '@/components/phone-simulator';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { navFor } from '@/lib/nav';
import { useNewRequest } from '@/lib/new-request';
import { useRealtimeConnection } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

/** Tenant white-labelling: apply the brand colour on top of the shared tokens. */
function useBrandColor(brandColor?: string) {
  useEffect(() => {
    const root = document.documentElement;
    if (!brandColor) {
      ['--oh-primary', '--oh-primary-soft', '--oh-primary-text'].forEach((v) => root.style.removeProperty(v));
      return;
    }
    const choice = root.dataset.theme;
    const dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) || !choice;
    const p = brandPalette(dark ? darkPalette : lightPalette, brandColor);
    root.style.setProperty('--oh-primary', p.primary);
    root.style.setProperty('--oh-primary-soft', p.primarySoft);
    root.style.setProperty('--oh-primary-text', p.primaryText);
  }, [brandColor]);
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function AppShell() {
  const { user, companies, signIn, signOut, setTenant, setUser } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const realtime = useRealtimeConnection();
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState('');
  const showNewRequest = useNewRequest((s) => s.show);
  const manager = user?.role === 'owner' || user?.role === 'admin';

  // Role and approver roles are read fresh, so a change made by the owner shows without signing in again.
  const me = useQuery({ queryKey: ['me'], queryFn: api.auth.me, refetchInterval: 60_000 });
  useEffect(() => {
    if (me.data) setUser(me.data.user, me.data.companies);
  }, [me.data, setUser]);
  const switchCompany = useMutation({
    mutationFn: (tenantId: string) => api.auth.switchCompany(tenantId),
    onSuccess: (auth) => {
      queryClient.clear();
      signIn(auth);
      navigate('/');
    },
  });

  const tenant = useQuery({ queryKey: ['tenant'], queryFn: api.tenant.get });
  const approvals = useQuery({ queryKey: ['approvals', 'pending', true], queryFn: () => api.approvals.list('pending', { mine: true }) });
  useBrandColor(tenant.data?.settings.brandColor);
  useEffect(() => {
    if (tenant.data) setTenant(tenant.data);
  }, [tenant.data, setTenant]);

  const paused = tenant.data?.status === 'paused';
  const killSwitch = useMutation({
    mutationFn: () => (paused ? api.tenant.resume() : api.tenant.pause()),
    onSuccess: (t) => {
      queryClient.setQueryData(['tenant'], t);
      void queryClient.invalidateQueries();
    },
  });

  const pendingCount = approvals.data?.length ?? 0;
  const location = useLocation();
  const outlet = useOutlet();

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {navFor(user?.role).map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) =>
            cn(
              'group relative flex h-10 items-center gap-3 rounded-sm px-2.5 text-sm font-medium transition-colors duration-300',
              isActive ? 'text-fg' : 'text-fg-body/75 hover:bg-line-5 hover:text-fg',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="nav-active" className="nav-active absolute inset-0 -z-10 rounded-sm" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <Icon className={cn('size-[18px]', isActive ? 'text-accent' : 'text-fg-muted')} aria-hidden />
              <span className="flex-1">{label}</span>
              {to === '/approvals' && pendingCount > 0 && <span className="btn-action rounded-full px-1.5 py-px text-xs font-semibold">{pendingCount}</span>}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="page-glow flex h-full print:block print:h-auto">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-64 flex-col border-r border-line-10 bg-background/85 px-3 py-4 backdrop-blur-xl md:static md:flex print:hidden',
          menuOpen ? 'flex' : 'hidden',
        )}
      >
        <div className="flex items-center gap-2.5 px-2">
          <img src="/favicon.svg" alt="" className="size-8" />
          <p className="font-display text-sm font-medium tracking-[0.09em] text-fg">ONEHUMAN OS</p>
        </div>
        <div className="glass mt-5 flex items-center gap-2.5 rounded-md p-2.5">
          <span className="btn-cool grid size-8 shrink-0 place-items-center rounded-sm text-xs font-semibold">{initials(tenant.data?.name ?? '…')}</span>
          {companies.length > 1 ? (
            <Select aria-label="Switch company" className="h-8 min-w-0 flex-1 text-sm" value={user?.tenantId} onChange={(e) => switchCompany.mutate(e.target.value)} disabled={switchCompany.isPending}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          ) : (
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{tenant.data?.name ?? '…'}</p>
          )}
        </div>
        <div className="mt-5 flex-1 overflow-y-auto">{nav}</div>
        <div className="mt-4 space-y-3 border-t border-line-10 px-2 pt-4 text-xs text-fg-muted">
          <div className="flex items-center gap-2">
            <span className={cn('size-2 rounded-full', realtime === 'open' ? 'live-dot bg-success' : realtime === 'connecting' ? 'bg-warning' : 'bg-fg-muted')} aria-hidden />
            {realtime === 'open' ? 'Live' : realtime === 'connecting' ? 'Connecting…' : 'Offline'}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-fg-body">{user?.name}</span>
            <button className="inline-flex items-center gap-1 hover:text-fg" onClick={signOut}>
              <LogOut className="size-3.5" aria-hidden /> Sign out
            </button>
          </div>
        </div>
      </aside>
      {menuOpen && <div className="fixed inset-0 z-20 bg-background/60 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line-10 px-3 sm:gap-3 md:px-6 print:hidden">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <form
            role="search"
            className="relative hidden max-w-sm flex-1 sm:block"
            onSubmit={(e) => {
              e.preventDefault();
              navigate(`/cases${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`);
            }}
          >
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search cases" aria-label="Search cases" className="pl-9" />
          </form>
          <div className="ml-auto flex items-center gap-2">
            <Button onClick={() => showNewRequest()}>
              <Plus /> New request
            </Button>
            {manager && (
              <Button
                variant={paused ? 'success' : 'secondary'}
                onClick={() => {
                  if (paused || window.confirm('Pause every agent in the company? Running work stops at its next step.')) killSwitch.mutate();
                }}
                loading={killSwitch.isPending}
                title="Company-wide kill switch"
                aria-label={paused ? 'Resume all agents' : 'Pause all agents'}
              >
                <Power className={paused ? '' : 'text-danger'} />
                <span className="max-lg:hidden">{paused ? 'Resume all agents' : 'Pause all agents'}</span>
              </Button>
            )}
          </div>
        </header>
        {paused && (
          <div className="border-b border-line-10 bg-warning-soft px-6 py-2 text-sm text-warning print:hidden" role="status">
            The kill switch is on. Every agent is paused and no action can run until you resume.
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8 print:overflow-visible print:p-0">
          <div className="mx-auto max-w-6xl">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 25 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
              >
                {outlet}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      <NewRequestDialog />
      <div className="print:hidden">
        <PhoneSimulator />
      </div>
    </div>
  );
}
