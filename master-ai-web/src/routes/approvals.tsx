import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Inbox } from 'lucide-react';
import { ApprovalCard } from '@/components/approval-card';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { api } from '@/lib/api';
import { signDecision } from '@/lib/device-key';
import { useSession } from '@/lib/session';
import { cn } from '@/lib/utils';

const LOW_RISK = 60;

export function ApprovalsPage() {
  const queryClient = useQueryClient();
  const role = useSession((s) => s.user?.role);
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  // Everyone sees the approvals they can decide; the owner and admins can widen it.
  const [mine, setMine] = useState(true);
  const list = useQuery({ queryKey: ['approvals', tab, mine], queryFn: () => api.approvals.list(tab, { mine }) });
  // Only agent actions can be approved in a batch; case steps are read and decided one by one.
  const lowRisk = (list.data ?? []).filter((a) => a.kind === 'action' && a.status === 'pending' && a.riskScore < LOW_RISK);

  // Review many low-risk requests as one list; each decision is still signed individually.
  const batch = useMutation({
    mutationFn: async () => {
      const decisions = await Promise.all(
        lowRisk.map(async (a) => ({ approvalId: a.id, decision: 'approved' as const, ...(await signDecision({ approvalId: a.id, decision: 'approved' })) })),
      );
      return api.approvals.batch({ decisions });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['approvals'] }),
  });

  return (
    <div>
      <PageHeader
        lead="Decisions"
        title="waiting for you."
        description="Approvals and sign-offs for your role, and agent steps your rules stopped. The rules, not the AI, decided each one needs a person."
        action={
          lowRisk.length > 1 && (
            <Button variant="secondary" onClick={() => batch.mutate()} loading={batch.isPending}>
              <CheckCheck /> Approve {lowRisk.length} low-risk
            </Button>
          )
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2" role="tablist" aria-label="Approvals">
        {(['pending', 'all'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn('h-9 rounded-full px-4 text-sm transition-colors duration-300 max-sm:h-11', tab === t ? 'nav-active text-fg' : 'text-fg-muted hover:bg-line-5 hover:text-fg')}
          >
            {t === 'pending' ? 'Waiting for you' : 'History'}
          </button>
        ))}
        {role !== 'member' && (
          <label className="ml-auto flex items-center gap-2 text-sm text-fg-lead">
            <input type="checkbox" checked={!mine} onChange={(e) => setMine(!e.target.checked)} className="size-4 accent-[var(--oh-glow)]" />
            Everyone's, not only mine
          </label>
        )}
      </div>
      <ErrorNote error={list.error ?? batch.error} className="mb-4" />
      {list.isLoading ? (
        <Spinner />
      ) : list.data?.length === 0 ? (
        <EmptyState icon={<Inbox />} title={tab === 'pending' ? 'Nothing needs your approval' : 'No approvals yet'}>
          When an agent proposes something risky, irreversible or above a money limit, it lands here.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {[...(list.data ?? [])]
            .sort((a, b) => Number(b.kind === 'case_gate') - Number(a.kind === 'case_gate'))
            .map((a) => (
              <ApprovalCard key={a.id} approval={a} compact={tab === 'all'} />
            ))}
        </div>
      )}
    </div>
  );
}
