import { describe, expect, it } from 'vitest';
import type { PolicyRule, ResolvedPack } from '@onehuman/schemas';
import { resolveTool } from '@onehuman/agent-kit';
import { PolicyEngine, type PolicyAgent, type PolicyRequest } from './engine';

const pack = {
  id: 'gates', version: '1.0.0', name: 'Gates', description: 'Gate tests', kind: 'industry', extends: [], labels: {},
  entities: [], agents: [], tools: [], workflows: [], routines: [], policies: [], kpis: [], connectors: [], playbooks: [], other_org_types: [],
  lineage: ['gates'], source: 'registry',
} satisfies ResolvedPack;

const rules: PolicyRule[] = [
  { id: 'lifecycle-breakdown-approve-p1', action: 'case.proceed', approver: 'safety-officer', require_approval: true, when: { category: ['breakdown'], priority: ['P1'] }, reason: 'Breakdown repair: P1 needs the safety officer' },
  { id: 'lifecycle-business-loan-approve', action: 'case.proceed', approver: 'credit-committee', require_approval_above: { amount: 500000, currency: 'INR' }, when: { category: ['business-loan'] } },
  { id: 'lifecycle-breakdown-signoff', action: 'case.close', approver: 'maintenance-head', require_approval: true, when: { category: ['breakdown'] } },
  { id: 'lifecycle-customer-guard', action: 'case.proceed', approver: 'owner', require_approval: true, when: { source: ['customer'], risk: ['high'] } },
];
const engine = new PolicyEngine({ version: 1, packRules: rules });

const coordinator: PolicyAgent = {
  id: 'coordinator', role: 'case-coordinator', status: 'active', autonomy: 3,
  tools: ['case.proceed', 'case.close', 'records.search'], dataClass: 'internal', moneyBudgetInr: 0,
};

function gate(tool: 'case.proceed' | 'case.close', ctx: NonNullable<PolicyRequest['caseContext']>, amount?: number, extra: Partial<PolicyRequest> = {}) {
  return engine.decide({
    tool: resolveTool(pack, tool)!,
    args: { caseId: 'c1', category: ctx.category, priority: ctx.priority, risk: ctx.risk, summary: 's', ...(amount !== undefined && { amount }) },
    agent: coordinator,
    workspace: { id: 'ws', status: 'active' },
    tenant: { id: 't', status: 'active' },
    trackRecord: { approved: 0, rejected: 0, edited: 0 },
    caseContext: ctx,
    ...extra,
  });
}

const breakdownP1 = { category: 'breakdown', priority: 'P1', risk: 'high', source: 'system' } as const;

describe('case gates', () => {
  it('routes a P1 breakdown to the safety officer', () => {
    const d = gate('case.proceed', breakdownP1);
    expect(d.level).toBe(4);
    expect(d.approver).toBe('safety-officer');
    expect(d.reasons).toContain('Breakdown repair: P1 needs the safety officer');
  });

  it('lets a P3 breakdown through without approval', () => {
    expect(gate('case.proceed', { ...breakdownP1, priority: 'P3', risk: 'medium' }).level).toBe(3);
  });

  it('decides amount rules on the case amount', () => {
    const loan = { category: 'business-loan', priority: 'P3', risk: 'medium', source: 'partner' } as const;
    expect(gate('case.proceed', loan, 300000).level).toBe(3);
    const big = gate('case.proceed', loan, 4500000);
    expect(big.level).toBe(4);
    expect(big.approver).toBe('credit-committee');
    expect(gate('case.proceed', loan).level).toBe(3);
  });

  it('asks for sign-off with case.close', () => {
    const d = gate('case.close', breakdownP1);
    expect(d.level).toBe(4);
    expect(d.approver).toBe('maintenance-head');
  });

  it('matches on source and risk', () => {
    const d = gate('case.proceed', { category: 'general', priority: 'P3', risk: 'high', source: 'customer' });
    expect(d.level).toBe(4);
    expect(d.approver).toBe('owner');
  });

  it('never lets earned autonomy lift a gate', () => {
    expect(gate('case.proceed', breakdownP1, undefined, { override: { level: 3 } }).level).toBe(4);
  });

  it('does not match case rules for ordinary actions', () => {
    const agent: PolicyAgent = { ...coordinator, role: 'ops', tools: ['records.search'] };
    const d = engine.decide({
      tool: resolveTool(pack, 'records.search')!, args: { entity: 'X' }, agent,
      workspace: { id: 'ws', status: 'active' }, tenant: { id: 't', status: 'active' },
      trackRecord: { approved: 0, rejected: 0, edited: 0 },
    });
    expect(d.level).toBe(1);
  });

  it('blocks gates on the kill switch', () => {
    expect(gate('case.proceed', breakdownP1, undefined, { tenant: { id: 't', status: 'paused' } }).level).toBe(5);
  });

  it('needs approval when an amount rule cannot see the amount', () => {
    const strict = new PolicyEngine({
      version: 1,
      packRules: [{ id: 'lifecycle-loan-approve', action: 'case.proceed', approver: 'credit-manager', require_approval_above: { amount: 50000, currency: 'INR', unknown_needs_approval: true }, when: { category: ['loan'] } }],
    });
    const ctx = { category: 'loan', priority: 'P3', risk: 'medium', source: 'customer' } as const;
    const decide = (amount?: number) =>
      strict.decide({
        tool: resolveTool(pack, 'case.proceed')!,
        args: { caseId: 'c1', category: 'loan', priority: 'P3', risk: 'medium', summary: 's', ...(amount !== undefined && { amount }) },
        agent: coordinator, workspace: { id: 'ws', status: 'active' }, tenant: { id: 't', status: 'active' },
        trackRecord: { approved: 0, rejected: 0, edited: 0 }, caseContext: ctx,
      });
    expect(decide().level).toBe(4);
    expect(decide().approver).toBe('credit-manager');
    expect(decide(20000).level).toBe(3);
    expect(decide(80000).level).toBe(4);
    expect(strict.cedarText).toContain('(!context.hasAmount || context.amount > 50000)');
  });

  it('blocks a gate evaluated without its case', () => {
    const d = gate('case.proceed', breakdownP1, undefined, { caseContext: null });
    expect(d.level).toBe(5);
    expect(d.reasons).toContain('A stage gate needs its case');
  });

  it('asks the role named by the matching category rule before a generic owner rule', () => {
    const both = new PolicyEngine({
      version: 1,
      packRules: [
        { id: 'a-owner-guard', action: 'case.proceed', approver: 'owner', require_approval: true, when: { risk: ['high'] } },
        { id: 'lifecycle-breakdown-approve-p1', action: 'case.proceed', approver: 'safety-officer', require_approval: true, when: { category: ['breakdown'], priority: ['P1'] } },
      ],
    });
    const d = both.decide({
      tool: resolveTool(pack, 'case.proceed')!, args: { caseId: 'c1', category: 'breakdown', priority: 'P1', risk: 'high', summary: 's' },
      agent: coordinator, workspace: { id: 'ws', status: 'active' }, tenant: { id: 't', status: 'active' },
      trackRecord: { approved: 0, rejected: 0, edited: 0 }, caseContext: breakdownP1,
    });
    expect(d.level).toBe(4);
    expect(d.approver).toBe('safety-officer');
  });

  it('writes readable Cedar for when conditions', () => {
    expect(engine.cedarText).toContain('["breakdown"].contains(context.caseCategory)');
    expect(engine.cedarText).toContain('["P1"].contains(context.casePriority)');
  });
});
