import type { AssignPart, ClassifyPart, ClosePart, RequestPart, ResolvedLifecycle, ReviewPart } from '@onehuman/schemas';
import { extractAmountInr, phraseIn } from './extract';
import type { TeamMember } from './offline';
import type { ModelStageOutput } from './prompts';
import { isUntrusted } from './text';

/**
 * The model suggests; the rules keep the floors. Each function takes the
 * model's answer (or null when there is no model) and the rule-based answer,
 * and returns what goes in the case file.
 */

/** A case type chosen up front by a trusted person narrows the lifecycle to it. */
export function withPreset(lc: ResolvedLifecycle, request: RequestPart): ResolvedLifecycle {
  if (!request.presetCategory || isUntrusted(request.source)) return lc;
  const preset = lc.categories.find((c) => c.id === request.presetCategory);
  return preset ? { ...lc, categories: [preset], fallback_category: preset.id } : lc;
}

export function mergeReview(lc: ResolvedLifecycle, request: RequestPart, model: ModelStageOutput<'review'> | null, offline: ReviewPart): ReviewPart {
  if (!model) return offline;
  const scoped = withPreset(lc, request);
  const category = scoped.categories.find((c) => c.id === model.category) ?? scoped.categories.find((c) => c.id === offline.provisionalCategory);
  if (!category) return offline;
  if (model.outcome === 'needs_info' && model.missing.length === 0) return offline;
  const keyed = new Map(category.required_details.map((d) => [d.label.toLowerCase(), d.key]));
  return {
    outcome: model.outcome,
    provisionalCategory: category.id,
    checks: model.checks.map((c) => ({ name: c.name, ok: c.ok, ...(c.note && { note: c.note }) })),
    missing: model.missing.map((m) => ({ key: m.key || keyed.get(m.label.toLowerCase()) || 'detail', label: m.label })),
    toConfirm: category.required_checks,
    ...(model.outcome !== 'complete' && model.reason && { reason: model.reason }),
  };
}

const PRIORITY_RANK = { P1: 0, P2: 1, P3: 2, P4: 3 } as const;
const RISK_RANK = { low: 0, medium: 1, high: 2 } as const;

export function mergeClassify(
  lc: ResolvedLifecycle,
  request: RequestPart,
  now: Date,
  model: ModelStageOutput<'classify'> | null,
  offline: ClassifyPart,
): ClassifyPart {
  if (!model) return offline;
  const scoped = withPreset(lc, request);
  const category = scoped.categories.find((c) => c.id === model.category);
  if (!category) return offline;

  const reasons = model.reasons.filter((r) => r.trim().length > 0);
  // The case type's floor: the model may raise priority and risk, never lower them below the type's own,
  // because approval rules (high_risk_or_p1) key on them.
  let priority = PRIORITY_RANK[model.priority] > PRIORITY_RANK[category.priority] ? category.priority : model.priority;
  let risk = RISK_RANK[model.risk] < RISK_RANK[category.risk] ? category.risk : model.risk;
  const urgent = lc.urgent_keywords.filter((k) => phraseIn(request.text, k));
  // The urgent-word floor: a model can never make a fire or an injury routine.
  if (urgent.length && PRIORITY_RANK[priority] > PRIORITY_RANK.P1) {
    priority = 'P1';
    reasons.push(`Kept at P1 because it mentions ${urgent.map((u) => `“${u}”`).join(', ')}.`);
  }
  if (priority === 'P1') risk = 'high';

  const extracted = extractAmountInr(request.text);
  const readAmounts = [model.amount_inr, extracted].filter((n): n is number => n !== null);
  // A trusted person's stated amount wins. From outside, a stated amount may raise the gate amount but never lower it.
  const amountInr =
    request.amountInr !== undefined && !isUntrusted(request.source)
      ? request.amountInr
      : [request.amountInr, ...readAmounts].some((n) => n !== undefined)
        ? Math.max(...[request.amountInr, ...readAmounts].filter((n): n is number => n !== undefined))
        : null;

  const p = lc.priorities.find((x) => x.id === priority)!;
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  return {
    category: category.id,
    categoryName: category.name,
    priority,
    risk,
    department: category.department,
    amountInr,
    respondBy: at(p.respond_within_hours),
    resolveBy: at(p.resolve_within_hours),
    reasons: reasons.length ? reasons : offline.reasons,
  };
}

export function mergeAssign(model: ModelStageOutput<'assign'> | null, offline: AssignPart, team: TeamMember[], classify: ClassifyPart): AssignPart {
  if (!model?.staff_id) return offline;
  const member = team.find((m) => m.id === model.staff_id);
  if (!member) return offline;
  return {
    assignee: { staffId: member.id, name: member.name, title: member.title },
    team: classify.department,
    deadline: classify.resolveBy,
    reason: model.reason || offline.reason,
  };
}

export function mergeVerify(
  model: ModelStageOutput<'close'> | null,
  offline: Pick<ClosePart, 'verified' | 'findings' | 'outcome'>,
): Pick<ClosePart, 'verified' | 'findings' | 'outcome'> {
  if (!model) return offline;
  // The model may refuse a result the rules accept, never the other way round.
  const verified = offline.verified && model.verified;
  const findings = model.findings.filter((f) => f.trim().length > 0);
  return { verified, findings: findings.length ? findings : offline.findings, outcome: verified ? 'resolved' : 'not_resolved' };
}
