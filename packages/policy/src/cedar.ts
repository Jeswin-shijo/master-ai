import type { PolicyRule } from '@onehuman/schemas';

/**
 * Policies are Cedar. Two questions are asked for every proposed action:
 *
 *   OneHuman::Action::"invoke"            denied → Level 5 (blocked)
 *   OneHuman::Action::"invoke_unattended" denied → Level 4 (needs approval)
 *
 * The principal is the agent (OneHuman::Agent), the resource is its workspace.
 * Everything else arrives in `context`, so rules stay readable and testable.
 */

export const INVOKE = 'invoke';
export const INVOKE_UNATTENDED = 'invoke_unattended';

export interface CedarPolicy {
  id: string;
  text: string;
  /** Shown to the owner when this policy decides an action. */
  reason: string;
  /** Approver for rules that require approval. */
  approver?: string;
}

const A = (name: string) => `OneHuman::Action::"${name}"`;

export const BASE_POLICIES: CedarPolicy[] = [
  {
    id: 'base.permit-invoke',
    text: `permit(principal, action == ${A(INVOKE)}, resource);`,
    reason: 'Agents may act by default',
  },
  {
    id: 'base.permit-unattended',
    text: `permit(principal, action == ${A(INVOKE_UNATTENDED)}, resource);`,
    reason: 'Actions run without approval unless a rule says otherwise',
  },
  {
    id: 'guard.tool-allow-list',
    text: `forbid(principal, action, resource) unless { context.toolAllowed };`,
    reason: "Tool is not on this agent's allow-list",
  },
  {
    id: 'guard.agent-paused',
    text: `forbid(principal, action, resource) when { principal.status != "active" };`,
    reason: 'Agent is paused',
  },
  {
    id: 'guard.workspace-paused',
    text: `forbid(principal, action, resource) when { context.workspaceStatus != "active" };`,
    reason: 'Workspace is paused',
  },
  {
    id: 'guard.tenant-paused',
    text: `forbid(principal, action, resource) when { context.tenantStatus != "active" };`,
    reason: 'Company-wide kill switch is on',
  },
  {
    id: 'guard.untrusted-instructions',
    text: `forbid(principal, action == ${A(INVOKE_UNATTENDED)}, resource) when { context.untrustedOrigin && context.externalReach };`,
    reason: 'Action was suggested by untrusted content (email, web page or document)',
  },
  {
    id: 'guard.money-budget',
    text: `forbid(principal, action == ${A(INVOKE_UNATTENDED)}, resource) when { context.spendsMoney && context.amount + context.moneySpent > context.moneyBudget };`,
    reason: "Spend is over this agent's money budget for the task",
  },
];

/** Turn pack and tenant rules into Cedar policies. */
export function compileRules(rules: PolicyRule[], prefix: string): CedarPolicy[] {
  return rules.flatMap((rule, index) => {
    const id = `${prefix}.${rule.id ?? `rule-${index}`}`;
    const conditions: string[] = [];
    if (rule.action !== '*') conditions.push(`context.tool == ${cedarString(rule.action)}`);
    if (rule.agent) conditions.push(`principal.role == ${cedarString(rule.agent)}`);
    if (rule.when?.category) conditions.push(`${cedarSet(rule.when.category)}.contains(context.caseCategory)`);
    if (rule.when?.priority) conditions.push(`${cedarSet(rule.when.priority)}.contains(context.casePriority)`);
    if (rule.when?.risk) conditions.push(`${cedarSet(rule.when.risk)}.contains(context.caseRisk)`);
    if (rule.when?.source) conditions.push(`${cedarSet(rule.when.source)}.contains(context.caseSource)`);
    const reason = rule.reason ?? describeRule(rule);
    const out: CedarPolicy[] = [];

    const policy = (suffix: string, action: string, extra: string[], approver?: string) => {
      const all = [...conditions, ...extra];
      out.push({
        id: `${id}.${suffix}`,
        text: `forbid(principal, action == ${A(action)}, resource)${all.length ? ` when { ${all.join(' && ')} }` : ''};`,
        reason,
        approver,
      });
    };

    // Earned autonomy (an owner-approved override) lifts blanket approval rules,
    // never amount thresholds or forbids.
    if (rule.require_approval) policy('approval', INVOKE_UNATTENDED, ['!context.overridden'], rule.approver);
    if (rule.require_approval_above) {
      const limit = Math.round(rule.require_approval_above.amount);
      // Gates read the amount from free text; when it is missing they fail closed.
      const condition = rule.require_approval_above.unknown_needs_approval
        ? [`(!context.hasAmount || context.amount > ${limit})`]
        : ['context.hasAmount', `context.amount > ${limit}`];
      policy('approval-above', INVOKE_UNATTENDED, condition, rule.approver);
    }
    if (rule.forbid) policy('forbid', INVOKE, []);
    if (rule.forbid_above) {
      policy('forbid-above', INVOKE, ['context.hasAmount', `context.amount > ${Math.round(rule.forbid_above.amount)}`]);
    }
    return out;
  });
}

function describeRule(rule: PolicyRule): string {
  const what = rule.action === '*' ? 'every action' : rule.action;
  if (rule.forbid) return `${what} is forbidden`;
  if (rule.forbid_above) return `${what} above ₹${rule.forbid_above.amount.toLocaleString('en-IN')} is forbidden`;
  if (rule.require_approval_above) {
    const unknown = rule.require_approval_above.unknown_needs_approval ? ' (or with no amount given)' : '';
    return `${what} above ₹${rule.require_approval_above.amount.toLocaleString('en-IN')}${unknown} needs approval`;
  }
  return `${what} needs approval`;
}

function cedarString(s: string): string {
  return JSON.stringify(s);
}

function cedarSet(items: readonly string[]): string {
  return `[${items.map(cedarString).join(', ')}]`;
}
