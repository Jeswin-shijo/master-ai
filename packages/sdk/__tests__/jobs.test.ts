import { describe, expect, it } from 'vitest';
import { JobCardEditSchema, UpdateAgentInputSchema } from '@onehuman/schemas';
import { createClient } from '../src/client';

function recording() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const api = createClient({
    baseUrl: 'http://api.test',
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? 'GET', url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch,
  });
  return { api, calls };
}

describe('jobs client', () => {
  it('lists, switches, runs and reads the runs of a job', async () => {
    const { api, calls } = recording();
    await api.jobs.list();
    await api.jobs.switch('morning-check', { enabled: false });
    await api.jobs.switch('morning-check', { dailyCap: 20 });
    await api.jobs.run('answer', { input: 'Is the boiler inspection due?' });
    await api.jobs.run('morning-check');
    await api.jobs.runs('morning-check');
    expect(calls).toEqual([
      { method: 'GET', url: 'http://api.test/jobs', body: undefined },
      { method: 'PATCH', url: 'http://api.test/jobs/morning-check', body: { enabled: false } },
      { method: 'PATCH', url: 'http://api.test/jobs/morning-check', body: { dailyCap: 20 } },
      { method: 'POST', url: 'http://api.test/jobs/answer/run', body: { input: 'Is the boiler inspection due?' } },
      { method: 'POST', url: 'http://api.test/jobs/morning-check/run', body: {} },
      { method: 'GET', url: 'http://api.test/jobs/morning-check/runs', body: undefined },
    ]);
  });
});

describe('a job card edit', () => {
  const set = { id: 'emergency', label: 'Emergencies', words: ['fire', 'sparking'] };

  it('may leave out a set’s alert and reply, so they keep what the set had', () => {
    expect(JobCardEditSchema.parse({ escalate: [set] }).escalate).toEqual([set]);
  });

  it('takes only what an owner edits: no inherited or pack marks, no empty words', () => {
    expect(JobCardEditSchema.safeParse({ escalate: [{ ...set, inherited: true }] }).success).toBe(false);
    expect(JobCardEditSchema.safeParse({ escalate: [{ ...set, words: [] }] }).success).toBe(false);
    expect(JobCardEditSchema.safeParse({ escalate: [{ ...set, words: ['  '] }] }).success).toBe(false);
    expect(JobCardEditSchema.safeParse({ mission: ' ' }).success).toBe(false);
    expect(UpdateAgentInputSchema.parse({ job: { mission: ' Answer every enquiry. ', never: ['Refunds'] } })).toEqual({
      job: { mission: 'Answer every enquiry.', never: ['Refunds'] },
    });
  });
});
