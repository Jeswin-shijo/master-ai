import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { Spinner } from '@/components/ui/feedback';
import { queryClient } from '@/lib/api';
import { useSession } from '@/lib/session';
import { applyTheme, installPrintTheme, readTheme } from '@/lib/theme';
import '@fontsource/red-hat-display/300.css';
import '@fontsource/red-hat-display/400.css';
import '@fontsource/red-hat-text/400.css';
import '@fontsource/red-hat-text/500.css';
import '@fontsource/red-hat-text/600.css';
import './index.css';

applyTheme(readTheme());
installPrintTheme();

function RequireSession({ children, onboarded = true }: { children: ReactNode; onboarded?: boolean }) {
  const { token, tenant } = useSession();
  if (!token) return <Navigate to="/login" replace />;
  if (onboarded && tenant && !tenant.onboarded) return <Navigate to="/onboarding" replace />;
  return children;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const token = useSession((s) => s.token);
  return token ? <Navigate to="/" replace /> : children;
}

// Each page downloads the first time it is opened; the current page stays up meanwhile.
const router = createBrowserRouter([
  {
    hydrateFallbackElement: <Spinner />,
    children: [
      { path: '/login', lazy: () => import('@/routes/auth').then((m) => ({ element: <PublicOnly><m.LoginPage /></PublicOnly> })) },
      { path: '/signup', lazy: () => import('@/routes/auth').then((m) => ({ element: <PublicOnly><m.SignupPage /></PublicOnly> })) },
      { path: '/onboarding', lazy: () => import('@/routes/onboarding').then((m) => ({ element: <RequireSession onboarded={false}><m.OnboardingPage /></RequireSession> })) },
      {
        element: <RequireSession><AppShell /></RequireSession>,
        children: [
          { index: true, lazy: () => import('@/routes/home').then((m) => ({ Component: m.HomePage })) },
          { path: 'cases', lazy: () => import('@/routes/cases').then((m) => ({ Component: m.CasesPage })) },
          { path: 'cases/:id', lazy: () => import('@/routes/case').then((m) => ({ Component: m.CasePage })) },
          { path: 'cases/:id/report', lazy: () => import('@/routes/case-report').then((m) => ({ Component: m.CaseReportPage })) },
          { path: 'goals/:id', lazy: () => import('@/routes/goal-detail').then((m) => ({ Component: m.GoalDetailPage })) },
          { path: 'workflows', lazy: () => import('@/routes/workflows').then((m) => ({ Component: m.WorkflowsPage })) },
          { path: 'approvals', lazy: () => import('@/routes/approvals').then((m) => ({ Component: m.ApprovalsPage })) },
          { path: 'calls', lazy: () => import('@/routes/calls').then((m) => ({ Component: m.CallsPage })) },
          { path: 'reports', lazy: () => import('@/routes/reports').then((m) => ({ Component: m.ReportsPage })) },
          { path: 'routines', lazy: () => import('@/routes/routines').then((m) => ({ Component: m.RoutinesPage })) },
          { path: 'routines/:id', lazy: () => import('@/routes/routines').then((m) => ({ Component: m.RoutineBoardPage })) },
          { path: 'team', lazy: () => import('@/routes/team').then((m) => ({ Component: m.TeamPage })) },
          { path: 'agents', lazy: () => import('@/routes/agents').then((m) => ({ Component: m.AgentsPage })) },
          { path: 'records', lazy: () => import('@/routes/records').then((m) => ({ Component: m.RecordsPage })) },
          { path: 'knowledge', lazy: () => import('@/routes/knowledge').then((m) => ({ Component: m.KnowledgePage })) },
          { path: 'pack', lazy: () => import('@/routes/pack').then((m) => ({ Component: m.PackPage })) },
          { path: 'audit', lazy: () => import('@/routes/audit').then((m) => ({ Component: m.AuditPage })) },
          { path: 'settings', lazy: () => import('@/routes/settings').then((m) => ({ Component: m.SettingsPage })) },
        ],
      },
      { path: '/invite/:tenantId/:token', lazy: () => import('@/routes/invite').then((m) => ({ Component: m.InvitePage })) },
      { path: '/r/:tenantId/:key', lazy: () => import('@/routes/public-form').then((m) => ({ Component: m.PublicFormPage })) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
);
