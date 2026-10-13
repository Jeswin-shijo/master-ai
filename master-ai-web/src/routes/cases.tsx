import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Plus, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { PRIORITY_IDS, STAGE_KEYS, type Case, type PriorityId, type StageKey } from '@onehuman/schemas';
import { StageDots } from '@/components/stage-dots';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { EmptyState, ErrorNote, PageHeader, Spinner } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form';
import { api } from '@/lib/api';
import { caseMatches, dotsFromCase, dueWords, FINAL_STATUSES, priorityTone, stageNames, statusWords, WAITING_ON_PEOPLE, type CaseFilters } from '@/lib/cases';
import { useNewRequest } from '@/lib/new-request';
import { cn } from '@/lib/utils';

const STATUS_TABS = [
  { value: 'open', label: 'Open' },
  { value: 'waiting', label: 'Waiting on people' },
  { value: 'closed', label: 'Finished' },
  { value: 'all', label: 'All' },
] as const;

function CaseRow({ c, names, now }: { c: Case; names: Record<StageKey, string>; now: Date }) {
  const ended = FINAL_STATUSES.includes(c.status);
  const due = ended ? null : dueWords(c.resolveBy, now);
  return (
    <li>
      <Link
        to={`/cases/${c.id}`}
        className="glass flex flex-col gap-3 rounded-lg p-4 transition-colors duration-300 hover:bg-line-5 sm:flex-row sm:items-center sm:gap-6"
      >
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            <span className="font-medium tabular-nums">{c.code}</span>
            <span aria-hidden>·</span>
            <span className="max-w-full truncate">{c.requester.name}</span>
            {c.categoryName && (
              <>
                <span aria-hidden>·</span>
                <span>{c.categoryName}</span>
              </>
            )}
          </p>
          <p className="mt-1 line-clamp-2 text-sm font-medium text-fg [overflow-wrap:anywhere]">{c.title}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {c.priority && <Chip tone={priorityTone(c.priority)}>{c.priority}</Chip>}
            {c.department && <Chip>{c.department}</Chip>}
            {c.assignee && <Chip>{c.assignee.name}</Chip>}
            {due && <Chip tone={due.late ? 'danger' : 'neutral'}>{due.text}</Chip>}
          </div>
        </div>
        <div className="shrink-0 sm:w-60">
          <StageDots states={dotsFromCase(c)} names={STAGE_KEYS.map((k) => names[k])} />
          <p className="mt-1.5 text-xs">
            <span className={cn(WAITING_ON_PEOPLE.includes(c.status) ? 'text-warning' : 'text-fg-body')}>{statusWords(c.status)}</span>
            {!ended && <span className="text-fg-muted"> · {names[c.stage]}</span>}
          </p>
        </div>
      </Link>
    </li>
  );
}

/** Every case, searchable by number, title or requester and filterable by stage, priority, status and assignee. */
export function CasesPage() {
  const [params, setParams] = useSearchParams();
  const showNewRequest = useNewRequest((s) => s.show);
  const q = params.get('q') ?? '';
  // A search looks through finished cases too.
  const statusTab = params.get('status') ?? (q ? 'all' : 'open');
  const filters: CaseFilters = {
    q,
    stage: (params.get('stage') ?? '') as StageKey | '',
    priority: (params.get('priority') ?? '') as PriorityId | '',
    status: statusTab === 'all' ? '' : (statusTab as CaseFilters['status']),
    assignee: params.get('assignee') ?? '',
  };
  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const cases = useQuery({ queryKey: ['cases', 'all'], queryFn: () => api.cases.list('all') });
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: api.workspaces.list });
  const lifecycle = workspaces.data?.[0]?.pack.lifecycle;
  const names = stageNames(lifecycle);
  const plural = lifecycle?.case.plural ?? 'Cases';
  const shown = (cases.data ?? []).filter((c) => caseMatches(c, filters));
  const now = new Date();

  return (
    <div>
      <PageHeader
        lead={`${plural},`}
        title="from request to report."
        description="Every request runs the same 8 stages. Open one to see where it is and who it waits on."
        action={
          <Button onClick={() => showNewRequest()}>
            <Plus /> New request
          </Button>
        }
      />

      <div className="glass mb-4 flex flex-col gap-3 rounded-lg p-3 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
          <Input value={q} onChange={(e) => set('q', e.target.value)} placeholder="Number, title or who asked" aria-label={`Search ${plural.toLowerCase()}`} className="pl-9" />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
          <Select aria-label="Stage" value={filters.stage} onChange={(e) => set('stage', e.target.value)}>
            <option value="">Every stage</option>
            {STAGE_KEYS.map((k, i) => (
              <option key={k} value={k}>
                {i + 1}. {names[k]}
              </option>
            ))}
          </Select>
          <Select aria-label="Priority" value={filters.priority} onChange={(e) => set('priority', e.target.value)}>
            <option value="">Any priority</option>
            {PRIORITY_IDS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
          <Input aria-label="Assigned to" placeholder="Assigned to" value={filters.assignee} onChange={(e) => set('assignee', e.target.value)} className="col-span-2 sm:col-span-1 lg:w-44" />
        </div>
      </div>

      <div role="tablist" aria-label="Status" className="mb-5 flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            aria-selected={statusTab === t.value}
            onClick={() => set('status', t.value)}
            className={cn(
              'h-9 rounded-full px-4 text-sm transition-colors duration-300 max-sm:h-11',
              statusTab === t.value ? 'nav-active text-fg' : 'text-fg-muted hover:bg-line-5 hover:text-fg',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ErrorNote error={cases.error} className="mb-4" />
      {cases.isLoading ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <EmptyState icon={<FolderKanban />} title={q ? `Nothing matches “${q}”` : `No ${plural.toLowerCase()} here`}>
          Requests from your team, your customers' form and your systems all land here.
        </EmptyState>
      ) : (
        <ul className="space-y-3" aria-label={plural}>
          {shown.map((c) => (
            <CaseRow key={c.id} c={c} names={names} now={now} />
          ))}
        </ul>
      )}
    </div>
  );
}
