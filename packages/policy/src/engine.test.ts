import { describe, expect, it } from 'vitest';
import type { PolicyRule, ResolvedPack } from '@onehuman/schemas';
import { resolveTool } from '@onehuman/agent-kit';
import { PolicyEngine, type PolicyAgent, type PolicyRequest } from './engine';
import { scoreRisk } from './risk';

const pack = {
  id: 'test',
  version: '1.0.0',
  name: 'Test',
  description: 'Test pack',
  kind: 'industry',
  extends: [],
  labels: {},
  entities: [],
  agents: [],
  tools: [
    {
      name: 'booking.confirm',
      description: 'Confirm a booking',
      uses: 'records.update',
      with: { entity: 'Booking', patch: { status: 'confirmed' } },
      level: 3,
      risk: { external_reach: true, reversible: false },
    },
  ],
  workflows: [],
  routines: [],
  policies: [],
  kpis: [],
  connectors: [], playbooks: [], other_org_types: [],
  lineage: ['test'],
  source: 'registry',
} satisfies ResolvedPack;

const rules: PolicyRule[] = [
  { id: 'confirm-booking', action: 'booking.confirm', require_approval: true, approver: 'owner' },
  { id: 'refund-above-5000', action: 'refund.issue', require_approval_above: { amount: 5000, currency: 'INR' }, approver: 'owner' },
  { id: 'refund-cap', action: 'refund.issue', forbid_above: { amount: 200000, currency: 'INR' }, approver: 'owner' },
];

const engine = new PolicyEngine({ version: 1, packRules: rules });

const agent: PolicyAgent = {
  id: 'agent-1',
  role: 'booking-coordinator',
  status: 'active',
  autonomy: 4,
  tools: ['records.search', 'records.update', 'booking.confirm', 'refund.issue', 'message.send', 'message.draft'],
  dataClass: 'internal',
  moneyBudgetInr: 10000,
};

const experienced = { approved: 10, rejected: 0, edited: 0 };

function request(tool: string, args: Record<string, unknown>, overrides: Partial<PolicyRequest> = {}): PolicyRequest {
  return {
    tool: resolveTool(pack, tool)!,
    args,
    agent,
    workspace: { id: 'ws-1', status: 'active' },
    tenant: { id: 't-1', status: 'active' },
    trackRecord: experienced,
    ...overrides,
  };
}

describe('policy engine', () => {
  it('runs read-only actions at Level 1', () => {
    const d = engine.decide(request('records.search', { entity: 'Booking' }));
    expect(d.level).toBe(1);
    expect(d.riskScore).toBe(0);
  });

  it('runs drafts at Level 2', () => {
    expect(engine.decide(request('message.draft', { channel: 'email', to: 'a@b.c', body: 'hi' })).level).toBe(2);
  });

  it('runs a small refund at Level 3', () => {
    const d = engine.decide(request('refund.issue', { amount: 3000, recipient: 'Asha', reason: 'cancelled' }));
    expect(d.level).toBe(3);
  });

  it('needs approval for a refund above the pack threshold (the plan example: ₹12,000)', () => {
    const d = engine.decide(request('refund.issue', { amount: 12000, recipient: 'Asha', reason: 'cancelled' }));
    expect(d.level).toBe(4);
    expect(d.approver).toBe('owner');
    expect(d.reasons.join(' ')).toMatch(/refund\.issue above ₹5,000/);
  });

  it('blocks a refund above the hard cap (Level 5)', () => {
    const d = engine.decide(request('refund.issue', { amount: 250000, recipient: 'Asha', reason: 'x' }));
    expect(d.level).toBe(5);
  });

  it('needs approval for booking.confirm by rule', () => {
    const d = engine.decide(request('booking.confirm', { id: 'b1' }));
    expect(d.level).toBe(4);
  });

  it('lets earned autonomy lift a blanket approval rule but not amount thresholds', () => {
    const confirm = engine.decide(request('booking.confirm', { id: 'b1' }, { override: { level: 3 } }));
    expect(confirm.level).toBe(3);
    const refund = engine.decide(
      request('refund.issue', { amount: 12000, recipient: 'Asha', reason: 'x' }, { override: { level: 3 } }),
    );
    expect(refund.level).toBe(4);
  });

  it('blocks tools outside the allow-list', () => {
    const d = engine.decide(request('payment.request', { amount: 100, payer: 'x', purpose: 'y' }));
    expect(d.level).toBe(5);
    expect(d.reasons).toContain("Tool is not on this agent's allow-list");
  });

  it('blocks everything when the agent, workspace or tenant is paused (kill switch)', () => {
    expect(engine.decide(request('records.search', { entity: 'B' }, { agent: { ...agent, status: 'paused' } })).level).toBe(5);
    expect(engine.decide(request('records.search', { entity: 'B' }, { workspace: { id: 'ws-1', status: 'paused' } })).level).toBe(5);
    expect(engine.decide(request('records.search', { entity: 'B' }, { tenant: { id: 't-1', status: 'paused' } })).level).toBe(5);
  });

  it('escalates actions above the agent clearance', () => {
    const intake = { ...agent, autonomy: 2 as const };
    const d = engine.decide(request('records.update', { entity: 'Booking', id: 'b1', patch: {} }, { agent: intake }));
    expect(d.level).toBe(4);
    expect(d.reasons.join(' ')).toMatch(/clearance/);
  });

  it('enforces the money budget for spending', () => {
    const d = engine.decide(
      request('refund.issue', { amount: 3000, recipient: 'Asha', reason: 'x' }, { moneySpentInr: 8000 }),
    );
    expect(d.level).toBe(4);
    expect(d.reasons.join(' ')).toMatch(/money budget/);
  });

  it('requires approval for outbound actions suggested by untrusted content', () => {
    const d = engine.decide(
      request('message.send', { channel: 'email', to: 'x@y.z', body: 'hi' }, { untrustedOrigin: true }),
    );
    expect(d.level).toBe(4);
  });

  it('raises risk for agents whose requests get rejected', () => {
    const tool = resolveTool(pack, 'message.send')!;
    const good = scoreRisk({ risk: tool.risk, amount: null, dataClass: 'internal', trackRecord: experienced });
    const bad = scoreRisk({ risk: tool.risk, amount: null, dataClass: 'internal', trackRecord: { approved: 2, rejected: 8, edited: 0 } });
    expect(bad.score).toBeGreaterThan(good.score);
  });

  it('exposes readable Cedar source', () => {
    expect(engine.cedarText).toContain('@id("pack.refund-above-5000.approval-above")');
  });
});
