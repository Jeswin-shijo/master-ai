import {
  PRIORITY_IDS,
  STAGE_KEYS,
  type CaseCategory,
  type Lifecycle,
  type LifecycleExample,
  type LifecyclePriority,
  type LifecycleRole,
  type PolicyRule,
  type ResolvedLifecycle,
  type ResolvedPack,
  type ResolvedStage,
  type StageKey,
} from '@onehuman/schemas';
import { CASE_COORDINATOR_ROLE } from '../catalog';
import { GENERIC_LIFECYCLE } from './generic';

/** Merge lifecycle parts from the most basic pack to the most specific; later parts win. */
export function mergeLifecycles(parts: Lifecycle[]): ResolvedLifecycle {
  const stages = new Map<StageKey, ResolvedStage>(GENERIC_LIFECYCLE.stages.map((s) => [s.key, s]));
  const priorities = new Map<string, LifecyclePriority>(GENERIC_LIFECYCLE.priorities.map((p) => [p.id, p]));
  const roles = new Map<string, LifecycleRole>(GENERIC_LIFECYCLE.roles.map((r) => [r.id, r]));
  const categories = new Map<string, CaseCategory>(GENERIC_LIFECYCLE.categories.map((c) => [c.id, c]));
  const urgent = new Set(GENERIC_LIFECYCLE.urgent_keywords);
  const examples: LifecycleExample[] = [...GENERIC_LIFECYCLE.examples];
  let caseLabel = GENERIC_LIFECYCLE.case;
  let fallback = GENERIC_LIFECYCLE.fallback_category;

  for (const part of parts) {
    if (part.case) caseLabel = part.case;
    for (const key of STAGE_KEYS) {
      const own = part.stages[key];
      if (!own) continue;
      const prev = stages.get(key)!;
      stages.set(key, { key, name: own.name, description: own.description ?? prev.description, checks: own.checks ?? prev.checks });
    }
    part.priorities.forEach((p) => priorities.set(p.id, p));
    part.roles.forEach((r) => roles.set(r.id, r));
    part.categories.forEach((c) => categories.set(c.id, c));
    part.urgent_keywords.forEach((k) => urgent.add(k));
    examples.push(...part.examples);
    if (part.fallback_category) fallback = part.fallback_category;
  }

  return {
    case: caseLabel,
    stages: STAGE_KEYS.map((k) => stages.get(k)!),
    priorities: PRIORITY_IDS.map((id) => priorities.get(id)!),
    roles: [...roles.values()],
    urgent_keywords: [...urgent],
    categories: [...categories.values()],
    fallback_category: fallback,
    examples,
  };
}

/** The lifecycle a workspace runs. Older snapshots without one get the generic lifecycle. */
export function lifecycleOf(pack: ResolvedPack): ResolvedLifecycle {
  return pack.lifecycle ?? GENERIC_LIFECYCLE;
}

/**
 * Category approval and sign-off rules, as ordinary pack policies on the gate
 * tools. They show in the policy viewer and compile to Cedar like any rule.
 */
export function lifecyclePolicies(lc: ResolvedLifecycle): PolicyRule[] {
  const roleName = (id: string) => (lc.roles.find((r) => r.id === id)?.name ?? id).toLowerCase();
  const rules: PolicyRule[] = [];
  for (const c of lc.categories) {
    const role = c.approval.role ?? 'owner';
    const base = { action: 'case.proceed', approver: role } as const;
    switch (c.approval.required) {
      case 'always':
        rules.push({ ...base, id: `lifecycle-${c.id}-approve`, require_approval: true, when: { category: [c.id] }, reason: `${c.name} needs approval by the ${roleName(role)}` });
        break;
      case 'above_amount':
        rules.push({
          ...base,
          id: `lifecycle-${c.id}-approve`,
          require_approval_above: { amount: c.approval.amount_inr!, currency: 'INR' },
          when: { category: [c.id] },
          reason: `${c.name} above ₹${c.approval.amount_inr!.toLocaleString('en-IN')} needs approval by the ${roleName(role)}`,
        });
        break;
      case 'high_risk_or_p1':
        rules.push(
          { ...base, id: `lifecycle-${c.id}-approve-p1`, require_approval: true, when: { category: [c.id], priority: ['P1'] }, reason: `${c.name}: P1 cases need approval by the ${roleName(role)}` },
          { ...base, id: `lifecycle-${c.id}-approve-high-risk`, require_approval: true, when: { category: [c.id], risk: ['high'] }, reason: `${c.name}: high-risk cases need approval by the ${roleName(role)}` },
        );
        break;
      case 'never':
        break;
    }
    if (c.signoff.required) {
      const signer = c.signoff.role!;
      rules.push({ id: `lifecycle-${c.id}-signoff`, action: 'case.close', approver: signer, require_approval: true, when: { category: [c.id] }, reason: `${c.name} needs final sign-off by the ${roleName(signer)}` });
    }
  }
  return rules;
}

/** Cross-reference checks for a resolved lifecycle. */
export function validateLifecycle(lc: ResolvedLifecycle, pack: ResolvedPack): string[] {
  const issues: string[] = [];
  const roles = new Set(lc.roles.map((r) => r.id));
  const workflows = new Set(pack.workflows.map((w) => w.id));
  const categories = new Set(lc.categories.map((c) => c.id));

  if (lc.stages.length !== 8) issues.push('lifecycle: needs exactly 8 stages');
  if (!roles.has('owner')) issues.push('lifecycle: the owner role is missing');
  if (lc.categories.length === 0) issues.push('lifecycle: needs at least one category');
  if (lc.fallback_category && !categories.has(lc.fallback_category)) issues.push(`lifecycle: unknown fallback category ${lc.fallback_category}`);
  for (const c of lc.categories) {
    if (c.workflow && !workflows.has(c.workflow)) issues.push(`lifecycle category ${c.id}: unknown workflow ${c.workflow}`);
    if (c.approval.role && !roles.has(c.approval.role)) issues.push(`lifecycle category ${c.id}: unknown approval role ${c.approval.role}`);
    if (c.signoff.role && !roles.has(c.signoff.role)) issues.push(`lifecycle category ${c.id}: unknown sign-off role ${c.signoff.role}`);
  }
  for (const ex of lc.examples) {
    if (!categories.has(ex.category)) issues.push(`lifecycle example "${ex.request.slice(0, 40)}": unknown category ${ex.category}`);
  }
  if (!pack.agents.some((a) => a.role === CASE_COORDINATOR_ROLE)) issues.push('lifecycle: the case-coordinator agent is missing');
  return issues;
}
