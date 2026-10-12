import { isAuthorized, type AuthorizationAnswer } from '@cedar-policy/cedar-wasm/nodejs';
import type { AutonomyLevel, DataClass, PolicyDecision, PolicyRule, RiskFactor } from '@onehuman/schemas';
import { amountOf, type ResolvedTool } from '@onehuman/agent-kit';
import { BASE_POLICIES, compileRules, INVOKE, INVOKE_UNATTENDED, type CedarPolicy } from './cedar';
import { bandLevel, DEFAULT_RISK_BANDS, scoreRisk, type RiskBands, type TrackRecord } from './risk';

export interface PolicyAgent {
  id: string;
  role: string;
  status: 'active' | 'paused' | 'retired';
  /** Clearance: highest level the agent may run without approval. */
  autonomy: 1 | 2 | 3 | 4;
  tools: string[];
  dataClass: DataClass;
  moneyBudgetInr: number;
}

export interface PolicyRequest {
  tool: ResolvedTool;
  args: Record<string, unknown>;
  agent: PolicyAgent;
  workspace: { id: string; status: 'active' | 'paused' };
  tenant: { id: string; status: 'active' | 'paused' };
  trackRecord: TrackRecord;
  /** Owner-approved earned autonomy for this agent + tool. */
  override?: { level: 1 | 2 | 3 } | null;
  /** Money this agent already spent in the current task. */
  moneySpentInr?: number;
  /** The task came from outside (inbound email, webhook), not from the owner. */
  untrustedOrigin?: boolean;
}

export interface PolicySetInput {
  version: number;
  packRules: PolicyRule[];
  tenantRules?: PolicyRule[];
  bands?: RiskBands;
}

/**
 * Decides every proposed agent action. The LLM never decides: the engine
 * scores risk, asks Cedar whether the action may run at all and whether it may
 * run unattended, then applies the agent's clearance.
 */
export class PolicyEngine {
  private readonly policies: CedarPolicy[];
  private readonly byId: Map<string, CedarPolicy>;
  private readonly staticPolicies: Record<string, string>;
  readonly version: number;
  private readonly bands: RiskBands;

  constructor(input: PolicySetInput) {
    this.version = input.version;
    this.bands = input.bands ?? DEFAULT_RISK_BANDS;
    this.policies = [
      ...BASE_POLICIES,
      ...compileRules(input.packRules, 'pack'),
      ...compileRules(input.tenantRules ?? [], 'tenant'),
    ];
    this.byId = new Map(this.policies.map((p) => [p.id, p]));
    this.staticPolicies = Object.fromEntries(this.policies.map((p) => [p.id, p.text]));
  }

  /** The compiled Cedar source, for the policy viewer and audit exports. */
  get cedarText(): string {
    return this.policies.map((p) => `@id(${JSON.stringify(p.id)})\n${p.text}`).join('\n\n');
  }

  decide(req: PolicyRequest): PolicyDecision {
    const amount = amountOf(req.tool, req.args);
    const { score, factors } = scoreRisk({
      risk: req.tool.risk,
      amount,
      dataClass: req.agent.dataClass,
      trackRecord: req.trackRecord,
    });
    const reasons: string[] = [];
    const decision = (level: AutonomyLevel, approver: string | null = null): PolicyDecision => ({
      level,
      riskScore: score,
      factors,
      reasons,
      approver,
      policyVersion: this.version,
    });

    // 1. May this action run at all?
    const invoke = this.authorize(INVOKE, req, amount);
    if (invoke.decision === 'deny') {
      reasons.push(...invoke.reasons);
      return decision(5);
    }

    // 2. Risk-based level, never below the tool's own floor.
    let level = Math.max(req.tool.baseLevel, bandLevel(score, this.bands)) as AutonomyLevel;
    if (level === 4) reasons.push(`Risk score ${score} is in the approval band`);
    if (req.override && req.override.level < level) {
      level = Math.max(req.override.level, 1) as AutonomyLevel;
      reasons.push(`Earned autonomy: owner lowered ${req.tool.name} to Level ${req.override.level}`);
    }

    // 3. May it run without a human?
    const unattended = this.authorize(INVOKE_UNATTENDED, req, amount);
    if (unattended.decision === 'deny') {
      reasons.push(...unattended.reasons);
      return decision(4, unattended.approver ?? 'owner');
    }
    if (level === 4) return decision(4, 'owner');

    // 4. Agent clearance.
    if (level > req.agent.autonomy) {
      reasons.push(`Level ${level} action is above this agent's clearance (Level ${req.agent.autonomy})`);
      return decision(4, 'owner');
    }
    return decision(level);
  }

  private authorize(
    action: string,
    req: PolicyRequest,
    amount: number | null,
  ): { decision: 'allow' | 'deny'; reasons: string[]; approver?: string } {
    const answer: AuthorizationAnswer = isAuthorized({
      principal: { type: 'OneHuman::Agent', id: req.agent.id },
      action: { type: 'OneHuman::Action', id: action },
      resource: { type: 'OneHuman::Workspace', id: req.workspace.id },
      context: {
        tool: req.tool.name,
        toolAllowed: req.agent.tools.includes(req.tool.name),
        hasAmount: amount !== null,
        amount: Math.round(amount ?? 0),
        spendsMoney: req.tool.risk.spendsMoney,
        moneySpent: Math.round(req.moneySpentInr ?? 0),
        moneyBudget: Math.round(req.agent.moneyBudgetInr),
        externalReach: req.tool.risk.externalReach,
        untrustedOrigin: req.untrustedOrigin ?? false,
        overridden: !!req.override,
        workspaceStatus: req.workspace.status,
        tenantStatus: req.tenant.status,
      },
      policies: { staticPolicies: this.staticPolicies },
      entities: [
        {
          uid: { type: 'OneHuman::Agent', id: req.agent.id },
          attrs: { role: req.agent.role, status: req.agent.status },
          parents: [],
        },
      ],
    });

    if (answer.type === 'failure') {
      // Fail closed: a broken policy set blocks the action rather than allowing it.
      return { decision: 'deny', reasons: [`Policy evaluation failed: ${answer.errors.map((e) => e.message).join('; ')}`] };
    }
    const { decision, diagnostics } = answer.response;
    if (diagnostics.errors.length) {
      return {
        decision: 'deny',
        reasons: diagnostics.errors.map((e) => `Policy ${e.policyId} errored: ${e.error.message}`),
      };
    }
    if (decision === 'allow') return { decision, reasons: [] };
    const matched = diagnostics.reason.map((id) => this.byId.get(id)).filter((p): p is CedarPolicy => !!p);
    return {
      decision,
      reasons: matched.length ? matched.map((p) => p.reason) : ['No policy permits this action'],
      approver: matched.find((p) => p.approver)?.approver,
    };
  }
}

export function levelLabel(level: AutonomyLevel): string {
  return ['', 'Observe', 'Draft', 'Act', 'Approval', 'Blocked'][level]!;
}

export type { RiskFactor };
