import type {
  AssignPart,
  CaseCategory,
  CaseRisk,
  CaseSource,
  ClassifyPart,
  ClosePart,
  PriorityId,
  ReportPart,
  RequestPart,
  Requester,
  ResolvedLifecycle,
  ReviewPart,
  StageKey,
} from '@onehuman/schemas';
import { extractAmountInr, hasDetail, normalizeText, phraseIn } from './extract';

/**
 * Deterministic stand-ins for the stage model calls. They run when no model
 * key is set, in tests and in evals, under the same output contracts.
 */

const PRIORITY_RANK: Record<PriorityId, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };

function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`;
}

export function offlineRequest(input: { text: string; requester: Requester; source: CaseSource; receivedAt: string; title?: string }): RequestPart {
  const clean = input.text.replace(/\s+/g, ' ').trim();
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return {
    title: input.title?.trim() || truncateWords(firstSentence, 80),
    summary: truncateWords(clean, 400),
    requester: input.requester,
    source: input.source,
    receivedAt: input.receivedAt,
    text: input.text,
  };
}

/** Best category by keyword strength; null when no keyword matches. */
export function matchCategory(lc: ResolvedLifecycle, text: string): { category: CaseCategory; matched: string[]; score: number } | null {
  let best: { category: CaseCategory; matched: string[]; score: number } | null = null;
  // Pack order breaks the final tie: an earlier category is only replaced by a strictly better one.
  for (const category of lc.categories) {
    const matched = category.keywords.filter((k) => phraseIn(text, k));
    const score = matched.reduce((sum, k) => sum + normalizeText(k).split(' ').length, 0);
    if (score === 0) continue;
    const better =
      best === null ||
      score > best.score ||
      (score === best.score && PRIORITY_RANK[category.priority] < PRIORITY_RANK[best.category.priority]);
    if (better) best = { category, matched, score };
  }
  return best;
}

function categoryOrFallback(lc: ResolvedLifecycle, text: string): { category: CaseCategory; matched: string[] } {
  const hit = matchCategory(lc, text);
  if (hit) return hit;
  const fallback = lc.categories.find((c) => c.id === lc.fallback_category) ?? lc.categories[0]!;
  return { category: fallback, matched: [] };
}

export function offlineReview(lc: ResolvedLifecycle, request: RequestPart, amountInr?: number | null): ReviewPart {
  const { category } = categoryOrFallback(lc, request.text);
  const amount = amountInr ?? extractAmountInr(request.text);

  for (const rule of category.not_eligible) {
    // A rule with both words and a limit means both: "personal purchases above ₹1 lakh".
    const byWord = rule.keywords.length === 0 || rule.keywords.some((k) => phraseIn(request.text, k));
    const byAmount = rule.amount_above_inr === undefined || (amount !== null && amount > rule.amount_above_inr);
    if (byWord && byAmount) {
      return { outcome: 'not_eligible', provisionalCategory: category.id, checks: [], missing: [], toConfirm: [], reason: rule.reason };
    }
  }

  const checks = category.required_details.map((d) => ({ name: d.label, ok: hasDetail(d, request.text, request.requester, amount) }));
  const missing = category.required_details.filter((_, i) => !checks[i]!.ok).map((d) => ({ key: d.key, label: d.label }));
  return {
    outcome: missing.length ? 'needs_info' : 'complete',
    provisionalCategory: category.id,
    checks,
    missing,
    toConfirm: category.required_checks,
    ...(missing.length ? { reason: `Missing: ${missing.map((m) => m.label.toLowerCase()).join(', ')}.` } : {}),
  };
}

const RISK_RANK: Record<CaseRisk, number> = { low: 0, medium: 1, high: 2 };

export function offlineClassify(lc: ResolvedLifecycle, request: RequestPart, now: Date, amountInr?: number | null): ClassifyPart {
  const { category, matched } = categoryOrFallback(lc, request.text);
  const reasons = [
    matched.length
      ? `Matched ${matched.map((m) => `“${m}”`).join(', ')}, so it is a ${category.name.toLowerCase()}.`
      : `No category matched, so it is a ${category.name.toLowerCase()}.`,
  ];

  let priority: PriorityId = category.priority;
  let risk: CaseRisk = category.risk;
  const urgent = lc.urgent_keywords.filter((k) => phraseIn(request.text, k));
  if (urgent.length) {
    if (priority !== 'P1') reasons.push(`Raised to P1 because it mentions ${urgent.map((u) => `“${u}”`).join(', ')}.`);
    priority = 'P1';
    if (RISK_RANK[risk] < RISK_RANK.high) risk = 'high';
  }

  const p = lc.priorities.find((x) => x.id === priority)!;
  const at = (hours: number) => new Date(now.getTime() + hours * 3_600_000).toISOString();
  return {
    category: category.id,
    categoryName: category.name,
    priority,
    risk,
    department: category.department,
    amountInr: amountInr ?? extractAmountInr(request.text),
    respondBy: at(p.respond_within_hours),
    resolveBy: at(p.resolve_within_hours),
    reasons,
  };
}

/** Words too common to tell people apart when matching responsibilities. */
const FILLER = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'all', 'any', 'our', 'your', 'their', 'its', 'also', 'other', 'others', 'etc', 'work', 'general']);

export interface TeamMember {
  id: string;
  name: string;
  title: string;
  responsibilities: string[];
}

export function offlineAssign(lc: ResolvedLifecycle, classify: ClassifyPart, team: TeamMember[]): AssignPart {
  const category = lc.categories.find((c) => c.id === classify.category);
  const topic = [classify.categoryName, classify.department, ...(category?.keywords ?? [])].join(' ');
  const deadline = classify.resolveBy;

  if (team.length === 1) {
    const only = team[0]!;
    return { assignee: { staffId: only.id, name: only.name, title: only.title }, team: classify.department, deadline, reason: `${only.name} is the only person on the team.` };
  }
  let best: { member: TeamMember; score: number } | null = null;
  for (const member of team) {
    const words = [member.title, ...member.responsibilities].join(' ');
    const score = new Set(normalizeText(words).split(' ').filter((w) => w.length > 2 && !FILLER.has(w) && phraseIn(topic, w))).size;
    if (score > 0 && (!best || score > best.score)) best = { member, score };
  }
  if (!best) {
    return {
      assignee: null,
      team: classify.department,
      deadline,
      reason: `Nobody on the team covers ${classify.department.toLowerCase()} yet, so it is with the ${classify.department} team.`,
    };
  }
  const m = best.member;
  return { assignee: { staffId: m.id, name: m.name, title: m.title }, team: classify.department, deadline, reason: `${m.name} (${m.title}) is in charge of ${classify.department.toLowerCase()}.` };
}

export function offlineVerify(input: { goalStatus: string; escalatedTasks: number; summary: string }): Pick<ClosePart, 'verified' | 'findings' | 'outcome'> {
  const verified = input.goalStatus === 'completed' && input.escalatedTasks === 0;
  return { verified, findings: [input.summary], outcome: verified ? 'resolved' : 'not_resolved' };
}

export interface ReportInput {
  caseLabel: string;
  number: string;
  title: string;
  categoryName?: string;
  outcome: string;
  stages: { key: StageKey; name: string; status: string; startedAt?: string | null; completedAt?: string | null }[];
  createdAt: string;
  resolveBy?: string | null;
  closedAt: string;
  sameCategoryLast30Days: number;
}

function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
}

export function offlineReport(input: ReportInput): ReportPart {
  const minutesPerStage = input.stages
    .filter((s) => s.startedAt && s.completedAt)
    .map((s) => ({ stage: s.key, minutes: Math.round((Date.parse(s.completedAt!) - Date.parse(s.startedAt!)) / 60_000) }));
  const total = Math.round((Date.parse(input.closedAt) - Date.parse(input.createdAt)) / 60_000);
  const slaMet = input.resolveBy ? Date.parse(input.closedAt) <= Date.parse(input.resolveBy) : null;
  const target = input.resolveBy ? Math.round((Date.parse(input.resolveBy) - Date.parse(input.createdAt)) / 60_000) : null;

  const recurring =
    input.categoryName && input.sameCategoryLast30Days >= 3
      ? { count: input.sameCategoryLast30Days, note: `${input.sameCategoryLast30Days} ${input.categoryName.toLowerCase()}s in the last 30 days. Worth looking for a root cause.` }
      : null;

  const sla = slaMet === null ? '' : slaMet ? `, inside its ${duration(target!)} target` : `, past its ${duration(target!)} target`;
  const text = `${input.number} ${input.title} was ${input.outcome} in ${duration(total)}${sla}.${recurring ? ` ${recurring.note}` : ''}`;
  return { text, slaMet, minutesPerStage, recurring };
}
