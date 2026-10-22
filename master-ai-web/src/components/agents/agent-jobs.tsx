import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import type { JobRunStatus, JobRunView, JobView } from '@onehuman/schemas';
import type { ApiClient } from '@onehuman/sdk';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { api } from '@/lib/api';
import { RUN_STATUS_WORDS, SKIP_WORDS } from '@/lib/job-card';
import { cn, timeAgo } from '@/lib/utils';

const RUN_TONE: Record<JobRunStatus, BadgeTone> = { done: 'success', stopped: 'neutral', needs_person: 'warning', running: 'info', failed: 'danger' };

/** The switch: a job that is on goes off, and the other way round. */
export function switchJob(client: { jobs: Pick<ApiClient['jobs'], 'switch'> }, job: JobView) {
  return client.jobs.switch(job.id, { enabled: !job.enabled });
}

/** An agent's jobs, one row each: what starts it, its switch, its daily limit, Run now and how it last went. Hidden when it has none. */
export function AgentJobs({ jobs, canManage }: { jobs: JobView[]; canManage: boolean }) {
  const id = useId();
  if (jobs.length === 0) return null;
  return (
    <div role="group" aria-labelledby={id} className="space-y-1.5">
      <h3 id={id} className="text-xs font-medium text-fg-muted">
        Jobs
      </h3>
      <ul className="divide-y divide-border rounded-md border border-border">
        {jobs.map((j) => (
          <JobRow key={j.id} job={j} canManage={canManage} />
        ))}
      </ul>
    </div>
  );
}

function RunLine({ run }: { run: JobRunView }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <Badge tone={RUN_TONE[run.status]}>{RUN_STATUS_WORDS[run.status]}</Badge>
      <span>{timeAgo(run.finishedAt ?? run.createdAt)}</span>
      {run.summary && <span className="text-fg">{run.summary}</span>}
    </span>
  );
}

function JobRow({ job, canManage }: { job: JobView; canManage: boolean }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['agents'] });
  const [limit, setLimit] = useState(String(job.dailyCap));
  const [text, setText] = useState('');
  const [history, setHistory] = useState(false);
  const toggle = useMutation({ mutationFn: () => switchJob(api, job), onSuccess: refresh });
  const cap = useMutation({ mutationFn: (dailyCap: number) => api.jobs.switch(job.id, { dailyCap }), onSuccess: refresh });
  const run = useMutation({
    mutationFn: () => api.jobs.run(job.id, text.trim() ? { input: text.trim() } : {}),
    onSuccess: () => {
      setText('');
      return Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['job-runs', job.id] })]);
    },
  });
  const runs = useQuery({ queryKey: ['job-runs', job.id], queryFn: () => api.jobs.runs(job.id), enabled: history });

  const wanted = Number(limit);
  const limitOk = Number.isInteger(wanted) && wanted >= 1 && wanted <= 500;
  const saveLimit = () => {
    if (!limitOk) return setLimit(String(job.dailyCap));
    if (wanted !== job.dailyCap) cap.mutate(wanted);
  };
  const started = run.data;

  return (
    <li className="space-y-2 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-fg">{job.name}</p>
          <p className="text-xs text-fg-muted">{job.triggerText}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={job.enabled}
          aria-label={job.name}
          disabled={!canManage || toggle.isPending}
          onClick={() => toggle.mutate()}
          className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50', job.enabled ? 'bg-primary' : 'bg-muted')}
        >
          <span className={cn('absolute top-0.5 size-5 rounded-full bg-surface shadow transition-transform', job.enabled ? 'translate-x-5' : 'translate-x-0.5')} />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          Daily limit
          <Input
            type="number"
            min={1}
            max={500}
            step={1}
            className="w-20"
            value={limit}
            disabled={!canManage || cap.isPending}
            onChange={(e) => setLimit(e.target.value)}
            onBlur={saveLimit}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          runs
        </label>
        {canManage && (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {job.trigger === 'manual' && (
              <Input
                className="min-w-40 flex-1"
                aria-label={`What should ${job.name} look at? (optional)`}
                placeholder="What should it look at? (optional)"
                maxLength={4000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            )}
            <Button type="button" size="sm" variant="secondary" loading={run.isPending} onClick={() => run.mutate()}>
              <Play /> Run now
            </Button>
          </div>
        )}
      </div>

      {!limitOk && <p className="text-xs text-warning">The daily limit is between 1 and 500 runs.</p>}
      {started && <p className="text-xs text-fg-muted">{'skipped' in started ? SKIP_WORDS[started.skipped] : 'Started. Its result shows here when it finishes.'}</p>}

      <p className="text-xs text-fg-muted">Last run: {job.lastRun ? <RunLine run={job.lastRun} /> : 'Not run yet'}</p>

      {job.lastRun && (
        <details onToggle={(e) => setHistory(e.currentTarget.open)} className="text-xs text-fg-muted">
          <summary className="cursor-pointer">Earlier runs</summary>
          {runs.data && (
            <ul className="mt-1 space-y-1">
              {runs.data.slice(0, 10).map((r) => (
                <li key={r.id}>
                  <RunLine run={r} />
                </li>
              ))}
            </ul>
          )}
          <ErrorNote error={runs.error} className="mt-1" />
        </details>
      )}
      <ErrorNote error={toggle.error ?? cap.error ?? run.error} />
    </li>
  );
}
