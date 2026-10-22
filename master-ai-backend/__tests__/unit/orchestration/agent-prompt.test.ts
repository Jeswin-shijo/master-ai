import { describe, expect, it } from 'vitest';
import { STANDARD_RULES, CUSTOMER_MESSAGE_RULE, escalationsFor } from '@onehuman/agent-kit';
import type { ResolvedPack } from '@onehuman/schemas';
import type { TaskContext } from '../../../src/orchestration/context';
import { agentSystemPrompt, agentUserPrompt } from '../../../src/orchestration/agent-runtime.service';

type Job = { mission: string; never: string[]; customer_facing: boolean; escalate: never[] };

function fixture(job?: Job, role = 'helper') {
  const pack = {
    name: 'Travel agency',
    entities: [{ name: 'enquiry', label: 'Enquiry', fields: [{ name: 'name', type: 'text', required: true }] }],
    escalations: [{ id: 'angry', label: 'The customer is angry', words: ['angry', 'furious'], alert: true, for: 'all' }],
    agents: [{ role, job }],
  } as unknown as ResolvedPack;
  const ctx = {
    agent: { name: 'Asha', role, spec: { description: 'Helps with enquiries', instructions: 'Be kind.', job } },
    tenant: { name: 'Acme Travels' },
    goal: { text: 'Follow up' },
    task: { title: 'Call Priya', description: 'Ring her.' },
  } as unknown as TaskContext;
  return { pack, ctx, esc: escalationsFor(pack, role) };
}

const card: Job = { mission: 'Keep enquiries moving.', never: ['Approving anything itself'], customer_facing: false, escalate: [] };

describe('agent prompt', () => {
  it('has the four system parts in order and keeps the old rules', () => {
    const { pack, ctx, esc } = fixture(card);
    const s = agentSystemPrompt(ctx, pack, [], esc);
    const at = ['ROLE.', 'RULES.', 'OUTPUT.', 'ESCALATE WHEN.'].map((p) => s.indexOf(p));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    for (const r of STANDARD_RULES) expect(s).toContain(r);
    expect(s).toContain('Never invent records, prices, amounts or policies');
    expect(s).toContain('Keep enquiries moving.');
    expect(s).toContain('Never handle: Approving anything itself');
    expect(s).not.toContain(CUSTOMER_MESSAGE_RULE);
    expect(s.indexOf('call task__finish')).toBeGreaterThan(at[2]!);
  });

  it('uses the description when there is no card, and still lists the shared labels', () => {
    const { pack, ctx, esc } = fixture(undefined);
    const s = agentSystemPrompt(ctx, pack, [], esc);
    expect(s).toContain('Helps with enquiries');
    expect(s).toContain('ESCALATE WHEN.');
    expect(s).toContain('The customer is angry');
    expect(s).toContain('When any of these comes up, call human__handoff.');
  });

  it('with no escalation sets still tells the agent to hand off', () => {
    const { pack, ctx } = fixture(card);
    const s = agentSystemPrompt(ctx, pack, [], []);
    expect(s).toContain('ESCALATE WHEN.\n- When something needs a person, call human__handoff.');
  });

  it('adds the customer message rule for a customer-facing agent, after the standard rules', () => {
    const f = fixture({ ...card, customer_facing: true });
    const s = agentSystemPrompt(f.ctx, f.pack, [], f.esc);
    expect(s).toContain(CUSTOMER_MESSAGE_RULE);
    expect(s.indexOf(CUSTOMER_MESSAGE_RULE)).toBeGreaterThan(s.indexOf(STANDARD_RULES[1]!));
  });

  it('puts the goal and feedback in TASK and the steps in fenced DATA', () => {
    const { ctx } = fixture(card);
    const u = agentUserPrompt(
      ctx,
      [{ tool: 'records__search', status: 'executed', args: { q: 'x' }, result: { a: 1 }, error: null, notes: null }],
      [{ source: 'owner', text: 'Be brief', at: '' }] as never,
    );
    expect(u).toContain('TASK.');
    expect(u.indexOf('Goal from the owner: "Follow up"')).toBeGreaterThan(u.indexOf('TASK.'));
    expect(u).toContain('Be brief');
    expect(u).toContain('DATA START');
    expect(u).toContain('<untrusted_data>');
    expect(u.indexOf('records__search')).toBeGreaterThan(u.indexOf('DATA START'));
    expect(u).toContain('call exactly one tool');
  });
});
