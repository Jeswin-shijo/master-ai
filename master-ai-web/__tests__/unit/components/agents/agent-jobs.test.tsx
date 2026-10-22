import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { JobView } from '@onehuman/schemas';
import { AgentJobs, switchJob } from '@/components/agents/agent-jobs';
import { JOB } from './fixtures';

const render = (node: ReactNode) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

describe("an agent's jobs", () => {
  it('shows each job with what starts it, its switch, its daily limit and Run now', () => {
    const html = render(<AgentJobs jobs={[JOB]} canManage />);
    expect(html).toContain('Morning check');
    expect(html).toContain('Every Mon–Sat at 09:00');
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
    expect(html).toContain('Daily limit');
    expect(html).toMatch(/type="number"[^>]*min="1"[^>]*max="500"|min="1"[^>]*max="500"[^>]*type="number"/);
    expect(html).toContain('Run now');
  });

  it('says how the last run went in plain words, with when and its summary', () => {
    const html = render(<AgentJobs jobs={[JOB]} canManage />);
    expect(html).toContain('Needs a person');
    expect(html).toContain('2h ago');
    expect(html).toContain('A consumer mentioned a gas leak');
    expect(render(<AgentJobs jobs={[{ ...JOB, lastRun: null }]} canManage />)).toContain('Not run yet');
  });

  it('gives a manual job a text box for Run now, and other jobs none', () => {
    const manual: JobView = { ...JOB, id: 'answer', trigger: 'manual', triggerText: 'When you press Run now' };
    expect(render(<AgentJobs jobs={[manual]} canManage />)).toContain('aria-label="What should Morning check look at? (optional)"');
    expect(render(<AgentJobs jobs={[JOB]} canManage />)).not.toContain('What should Morning check look at?');
  });

  it('is hidden when the agent has no jobs', () => {
    expect(render(<AgentJobs jobs={[]} canManage />)).toBe('');
  });

  it('switching a job that is on asks the API to switch it off', async () => {
    const api = { jobs: { switch: vi.fn().mockResolvedValue({ ...JOB, enabled: false }) } };
    await switchJob(api, JOB);
    expect(api.jobs.switch).toHaveBeenCalledWith('morning-check', { enabled: false });
    await switchJob(api, { ...JOB, enabled: false });
    expect(api.jobs.switch).toHaveBeenLastCalledWith('morning-check', { enabled: true });
  });

  it('only managers get the controls', () => {
    const html = render(<AgentJobs jobs={[JOB]} canManage={false} />);
    expect(html).toContain('Every Mon–Sat at 09:00');
    expect(html).toMatch(/role="switch"[^>]*disabled=""|disabled=""[^>]*role="switch"/);
    expect(html).not.toContain('Run now');
  });
});
