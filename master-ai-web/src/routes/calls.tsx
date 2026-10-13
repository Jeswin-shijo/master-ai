import { useQuery } from '@tanstack/react-query';
import { PhoneCall } from 'lucide-react';
import { Link } from 'react-router';
import { DelegationCard } from '@/components/delegation-card';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Every job handed to the team and every call made about it, newest first. */
export function CallsPage() {
  const delegations = useQuery({ queryKey: ['delegations', 'all'], queryFn: () => api.delegations.list() });
  const calls = useSession((s) => s.tenant?.settings.calls);
  const open = (delegations.data ?? []).filter((d) => d.stage !== 'closed');
  const closed = (delegations.data ?? []).filter((d) => d.stage === 'closed');

  return (
    <div className="space-y-6">
      <PageHeader
        lead="Calls with"
        title="your team."
        description={
          <>
            Work delegated to the team by phone: assign → follow up → confirm.{' '}
            {calls?.provider === 'twilio'
              ? 'Real phone calls through Twilio.'
              : calls?.simulatorMode === 'interactive'
                ? 'Simulator: calls ring in this app; answer as the staff member to try it.'
                : 'Simulator: simulated staff answer automatically.'}{' '}
            <Link to="/settings" className="text-accent hover:underline">Call settings</Link>
          </>
        }
      />
      {delegations.isLoading && <Spinner />}
      <ErrorNote error={delegations.error} />
      {delegations.data?.length === 0 && (
        <EmptyState icon={<PhoneCall />} title="No calls yet">
          Give the company a goal like “Make sure the hotel rooms are inspected before Friday”. The work coordinator will phone the person in charge.
        </EmptyState>
      )}
      {open.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-fg-muted">With the team now</h2>
          {open.map((d) => (
            <DelegationCard key={d.id} delegation={d} />
          ))}
        </section>
      )}
      {closed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-fg-muted">Finished</h2>
          {closed.map((d) => (
            <DelegationCard key={d.id} delegation={d} />
          ))}
        </section>
      )}
    </div>
  );
}
