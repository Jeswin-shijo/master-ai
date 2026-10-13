import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bot,
  BookOpen,
  Database,
  FileText,
  Inbox,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Phone,
  Power,
  Repeat,
  ScrollText,
  Settings,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { NavLink, useLocation, useNavigate, useOutlet } from 'react-router';
import { brandPalette, darkPalette, lightPalette } from '@onehuman/ui';
import { PhoneSimulator } from '@/components/phone-simulator';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { useRealtimeConnection } from '@/lib/realtime';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Hidden from members: only the owner and admins change these. */
  managersOnly?: boolean;
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: 'Work',
    items: [
      { to: '/', label: 'Command center', icon: LayoutDashboard, end: true },
      { to: '/workflows', label: 'Workflows', icon: Workflow },
      { to: '/approvals', label: 'Approvals', icon: Inbox },
      { to: '/routines', label: 'Routines', icon: Repeat },
      { to: '/calls', label: 'Calls', icon: Phone },
      { to: '/reports', label: 'Reports', icon: FileText },
    ],
  },
  {
    section: 'Company',
    items: [
      { to: '/team', label: 'Team', icon: Users },
      { to: '/agents', label: 'Agents', icon: Bot },
      { to: '/records', label: 'Records', icon: Database },
      { to: '/knowledge', label: 'Knowledge', icon: BookOpen },
    ],
  },
  {
    section: 'Admin',
    items: [
      { to: '/pack', label: 'Industry pack', icon: Package, managersOnly: true },
      { to: '/audit', label: 'Audit', icon: ScrollText },
      { to: '/settings', label: 'Settings', icon: Settings, managersOnly: true },
    ],
  },
];

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

export function AppShell() {
  const { user, companies, signIn, signOut, setTenant, setUser } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
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
  const realtime = useRealtimeConnection();
  const [menuOpen, setMenuOpen] = useState(false);

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
  // Keep the leaving page's own content while it animates out.
  const outlet = useOutlet();

  const nav = (
    <nav className="space-y-5" aria-label="Main">
      {NAV.map(({ section, items }) => (
        <div key={section}>
          <p className="mb-1.5 px-2.5 text-[11px] font-semibold tracking-wider text-fg-muted/80 uppercase">{section}</p>
          <div className="space-y-0.5">
            {items.filter((i) => !i.managersOnly || user?.role !== 'member').map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                    isActive ? 'font-medium text-fg' : 'text-fg-muted hover:bg-muted hover:text-fg',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 -z-10 rounded-lg bg-primary-soft" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <Icon className={cn('size-4 transition-transform group-hover:scale-110', isActive && 'text-primary')} aria-hidden />
                    <span className="flex-1">{label}</span>
                    {to === '/approvals' && pendingCount > 0 && (
                      <span className="rounded-full bg-primary px-1.5 py-px text-xs font-semibold text-primary-fg">{pendingCount}</span>
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <MotionConfig reducedMotion="user">
    <div className="flex h-full print:block print:h-auto">
      <aside className={cn('fixed inset-y-0 left-0 z-30 w-60 flex-col border-r border-border bg-surface px-3 py-4 md:static md:flex print:hidden', menuOpen ? 'flex' : 'hidden')}>
        <div className="mb-7 flex items-center gap-2.5 px-2">
          <img src="/favicon.svg" alt="" className="size-8" />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight text-fg">ONEHUMAN OS</p>
            <p className="truncate text-xs text-fg-muted">{tenant.data?.name ?? '…'}</p>
          </div>
        </div>
        {nav}
        <div className="mt-auto space-y-3 px-2 pt-6 text-xs text-fg-muted">
          <div className="flex items-center gap-2">
            <span className={cn('size-2 rounded-full', realtime === 'open' ? 'live-dot bg-success' : realtime === 'connecting' ? 'bg-warning' : 'bg-fg-muted')} aria-hidden />
            {realtime === 'open' ? 'Live' : realtime === 'connecting' ? 'Connecting…' : 'Offline'}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{user?.name}</span>
            <button className="inline-flex items-center gap-1 hover:text-fg" onClick={signOut}>
              <LogOut className="size-3.5" aria-hidden /> Sign out
            </button>
          </div>
        </div>
      </aside>
      {menuOpen && <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden />}

      <div className="flex min-w-0 flex-1 flex-col print:block">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4 md:px-6 print:hidden">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm text-fg-muted">
            {tenant.data && (
              <>
                <span className="font-medium text-fg">{tenant.data.name}</span> · {tenant.data.industry}
              </>
            )}
          </p>
          {companies.length > 1 && (
            <Select aria-label="Switch company" className="w-48" value={user?.tenantId} onChange={(e) => switchCompany.mutate(e.target.value)} disabled={switchCompany.isPending}>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          {user?.role !== 'member' && (
            <Button
              variant={paused ? 'success' : 'secondary'}
              size="sm"
              onClick={() => {
                if (paused || window.confirm('Pause every agent in the company? Running tasks stop at their next step.')) killSwitch.mutate();
              }}
              loading={killSwitch.isPending}
              title="Company-wide kill switch"
            >
              <Power className={paused ? '' : 'text-danger'} />
              {paused ? 'Resume all agents' : 'Pause all agents'}
            </Button>
          )}
        </header>
        {paused && (
          <div className="border-b border-warning/30 bg-warning-soft px-6 py-2 text-sm text-warning print:hidden" role="status">
            The kill switch is on. Every agent is paused and no action can run until you resume.
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 print:overflow-visible print:p-0">
          <div className="mx-auto max-w-6xl">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              >
                {outlet}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      <div className="print:hidden">
        <PhoneSimulator />
      </div>
    </div>
    </MotionConfig>
  );
}
