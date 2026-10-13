import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { AppShell } from '@/components/app-shell';
import { queryClient } from '@/lib/api';
import { useSession } from '@/lib/session';
import { AgentsPage } from '@/routes/agents';
import { ApprovalsPage } from '@/routes/approvals';
import { AuditPage } from '@/routes/audit';
import { LoginPage, SignupPage } from '@/routes/auth';
import { InvitePage } from '@/routes/invite';
import { CommandCenterPage } from '@/routes/command-center';
import { GoalDetailPage } from '@/routes/goal-detail';
import { KnowledgePage } from '@/routes/knowledge';
import { OnboardingPage } from '@/routes/onboarding';
import { PackPage } from '@/routes/pack';
import { RecordsPage } from '@/routes/records';
import { SettingsPage } from '@/routes/settings';
import { CallsPage } from '@/routes/calls';
import { ReportsPage } from '@/routes/reports';
import { RoutineBoardPage, RoutinesPage } from '@/routes/routines';
import { TeamPage } from '@/routes/team';
import { WorkflowsPage } from '@/routes/workflows';
import { applyTheme, installPrintTheme, readTheme } from '@/lib/theme';
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

const router = createBrowserRouter([
  { path: '/login', element: <PublicOnly><LoginPage /></PublicOnly> },
  { path: '/signup', element: <PublicOnly><SignupPage /></PublicOnly> },
  { path: '/onboarding', element: <RequireSession onboarded={false}><OnboardingPage /></RequireSession> },
  {
    element: <RequireSession><AppShell /></RequireSession>,
    children: [
      { index: true, element: <CommandCenterPage /> },
      { path: 'goals/:id', element: <GoalDetailPage /> },
      { path: 'workflows', element: <WorkflowsPage /> },
      { path: 'approvals', element: <ApprovalsPage /> },
      { path: 'calls', element: <CallsPage /> },
      { path: 'reports', element: <ReportsPage /> },
      { path: 'routines', element: <RoutinesPage /> },
      { path: 'routines/:id', element: <RoutineBoardPage /> },
      { path: 'team', element: <TeamPage /> },
      { path: 'agents', element: <AgentsPage /> },
      { path: 'records', element: <RecordsPage /> },
      { path: 'knowledge', element: <KnowledgePage /> },
      { path: 'pack', element: <PackPage /> },
      { path: 'audit', element: <AuditPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
  { path: '/invite/:tenantId/:token', element: <InvitePage /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
