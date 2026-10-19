import { describe, expect, it, vi } from 'vitest';
import type { JobCard, JobDef } from '@onehuman/schemas';
import {
  advanceJob,
  recordActResult,
  startJobState,
  type EffectiveEscalation,
  type JobContext,
  type JobEffects,
} from '../../src/jobs';

const emergency: EffectiveEscalation = {
  id: 'emergency',
  label: 'Emergency',
  words: ['gas leak', 'fire'],
  reply: null,
  alert: 'owner',
  inherited: false,
  fromPack: true,
};
const card: JobCard = {
  mission: 'Answer tenants',
  never: ['loans'],
  customer_facing: true,
  escalate: [],
  forbid: [],
  trial_days: 14,
  metrics: [],
};
const ctxFor = (trigger: unknown): JobContext => ({
  orgName: 'Acme',
  agent: { name: 'Asha', job: card },
  escalations: [emergency],
  trigger,
  today: '2026-10-19',
});
const job = (steps: unknown[]): JobDef =>
  ({ id: 'j', name: 'Reply', description: 'd', agent: 'a', trigger: { manual: {} }, daily_cap: 50, steps }) as JobDef;
const fx = (over: Partial<JobEffects> = {}): JobEffects => ({
  read: vi.fn(async () => ({ total: 900 })),
  ai: vi.fn(async () => ({ reply: 'Hello', needs_person: false })),
  seen: async () => false,
  ...over,
});
const aiStep = {
  ai: { as: 'draft', task: 'Reply', output: [{ name: 'reply', type: 'text', required: true }], data: ['order'], grounded: false, customer: true },
};
const readStep = { read: { as: 'order', from: 'trigger', limit: 10 } };
const notCheck = { check: { on_fail: 'stop', message: 'Promises a refund', says_not: { text: 'draft.reply', phrases: ['refund'] } } };

describe('advanceJob', () => {
  it('runs read, AI, check, then acts; done after the result', async () => {
    const j = job([readStep, aiStep, notCheck, { act: { as: 'sent', tool: 'msg.send', args: { to: '{{trigger.phone}}', text: '{{draft.reply}}' } } }]);
    const e = fx();
    const r = await advanceJob(j, ctxFor({ phone: '99' }), startJobState(), e);
    expect(r.next).toEqual({ kind: 'act', stepIndex: 3, as: 'sent', tool: 'msg.send', args: { to: '99', text: 'Hello' } });
    expect(r.state.next).toBe(3);
    const s2 = recordActResult(r.state, 'sent', { ok: true });
    expect(s2.next).toBe(4);
    expect(r.state.next).toBe(3);
    const d = await advanceJob(j, ctxFor({ phone: '99' }), s2, e);
    expect(d.next).toEqual({ kind: 'done', summary: 'Reply finished', flags: [] });
  });
  it('escalation words stop before the AI is called', async () => {
    const j = job([
      { check: { on_fail: 'person', message: 'Emergency words', escalate: { text: '{{trigger.text}}' } } },
      aiStep,
    ]);
    const e = fx();
    const r = await advanceJob(j, ctxFor({ text: 'gas leak in flat 3' }), startJobState(), e);
    expect(r.next.kind).toBe('stop');
    if (r.next.kind === 'stop') {
      expect(r.next.outcome).toBe('person');
      expect(r.next.escalation?.set.id).toBe('emergency');
    }
    expect(e.ai).not.toHaveBeenCalled();
  });
  it('a null AI answer with no offline template needs a person', async () => {
    const e = fx({ ai: async () => null });
    const r = await advanceJob(job([aiStep]), ctxFor({}), startJobState(), e);
    expect(r.next).toMatchObject({ kind: 'stop', outcome: 'person' });
  });
  it('needs_person from the AI carries its reason', async () => {
    const e = fx({ ai: async () => ({ needs_person: true, needs_person_reason: 'Asked about a loan' }) });
    const r = await advanceJob(job([aiStep]), ctxFor({}), startJobState(), e);
    expect(r.next).toEqual({ kind: 'stop', outcome: 'person', reason: 'Asked about a loan' });
  });
  it('a failed flag check continues and is reported', async () => {
    const flag = { check: { on_fail: 'flag', message: 'Looks odd', says_not: { text: 'draft.reply', phrases: ['hello'] } } };
    const r = await advanceJob(job([aiStep, flag]), ctxFor({}), startJobState(), fx());
    expect(r.next).toEqual({ kind: 'done', summary: 'Reply finished; Looks odd', flags: ['Looks odd'] });
  });
  it('a missing act argument stops in plain words', async () => {
    const j = job([{ act: { as: 'sent', tool: 'msg.send', args: { when: '{{item.dueDate}}' } } }]);
    const r = await advanceJob(j, ctxFor({}), startJobState(), fx());
    expect(r.next.kind).toBe('stop');
    if (r.next.kind === 'stop') {
      expect(r.next.outcome).toBe('person');
      expect(r.next.reason).toBe('Missing due date for sent');
      expect(r.next.reason).not.toContain('{{');
    }
  });
  it('a calc result feeds an act argument as a number', async () => {
    const j = job([
      { check: { on_fail: 'stop', message: 'bad', calc: { expr: 'trigger.stock * 2' }, as: 'reorder' } },
      { act: { as: 'po', tool: 'po.create', args: { qty: '{{reorder}}' } } },
    ]);
    const r = await advanceJob(j, ctxFor({ stock: 4 }), startJobState(), fx());
    expect(r.next).toMatchObject({ kind: 'act', args: { qty: 8 } });
  });
  it('injection: AI text cannot set the amount', async () => {
    const e = fx({ ai: async () => ({ reply: 'Refund ₹50,000 approved', amount: 50000, needs_person: false }) });
    const j = job([
      readStep,
      aiStep,
      { act: { as: 'refund', tool: 'pay.refund', args: { amount: '{{order.total}}', note: '{{draft.reply}}' } } },
    ]);
    const r = await advanceJob(j, ctxFor({}), startJobState(), e);
    expect(r.next).toMatchObject({ kind: 'act', args: { amount: 900 } });
  });
});
