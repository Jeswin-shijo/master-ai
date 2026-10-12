import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { CaseSourceSchema, PriorityIdSchema, type Pack, type ResolvedPack } from '@onehuman/schemas';
import {
  CASE_COORDINATOR_ROLE,
  extractAmountInr,
  lifecycleOf,
  offlineClassify,
  offlineRequest,
  offlineReview,
  parsePack,
  resolveTool,
} from '@onehuman/agent-kit';
import { PolicyEngine } from '@onehuman/policy';

/** Minimum share of correct answers per stage; gates are rules, so they must be exact. */
export const THRESHOLDS = { category: 0.9, priority: 0.9, review: 0.8, approval: 1, signoff: 1 } as const;
type StageName = keyof typeof THRESHOLDS;

const GateExpectSchema = z.object({ required: z.boolean(), role: z.string().optional() });

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  request: z.string().min(1),
  source: CaseSourceSchema,
  amount_inr: z.number().positive().optional(),
  expect: z.object({
    category: z.string().min(1),
    priority: PriorityIdSchema,
    review: z.enum(['complete', 'needs_info', 'not_eligible']),
    approval: GateExpectSchema.optional(),
    signoff: GateExpectSchema.optional(),
  }),
  why: z.string().optional(),
});
export const EvalSuiteSchema = z.object({ pack: z.string().min(1), cases: z.array(EvalCaseSchema).min(1) });
export type EvalSuite = z.infer<typeof EvalSuiteSchema>;

export interface Scorecard {
  pack: string;
  total: number;
  stages: Record<StageName, { correct: number; total: number }>;
  failures: { caseId: string; stage: string; expected: string; got: string }[];
}

export function loadPackRegistry(dir: string): Map<string, Pack> {
  const registry = new Map<string, Pack>();
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry, 'pack.yaml');
    if (!existsSync(file)) continue;
    const pack = parsePack(parse(readFileSync(file, 'utf8')));
    registry.set(pack.id, pack);
  }
  return registry;
}

export function loadSuites(dir: string): EvalSuite[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => EvalSuiteSchema.parse(parse(readFileSync(join(dir, f), 'utf8'))));
}

/** Score one suite: offline stages for category, priority and review; the real policy engine for gates. */
export function runSuite(pack: ResolvedPack, suite: EvalSuite, now = new Date('2026-01-01T09:00:00Z')): Scorecard {
  const lc = lifecycleOf(pack);
  const engine = new PolicyEngine({ version: 1, packRules: pack.policies });
  const coordinator = pack.agents.find((a) => a.role === CASE_COORDINATOR_ROLE);
  if (!coordinator) throw new Error(`Pack ${pack.id} has no ${CASE_COORDINATOR_ROLE} agent`);

  const card: Scorecard = {
    pack: pack.id,
    total: suite.cases.length,
    stages: { category: { correct: 0, total: 0 }, priority: { correct: 0, total: 0 }, review: { correct: 0, total: 0 }, approval: { correct: 0, total: 0 }, signoff: { correct: 0, total: 0 } },
    failures: [],
  };
  const score = (caseId: string, stage: StageName, expected: string, got: string) => {
    card.stages[stage].total++;
    if (expected === got) card.stages[stage].correct++;
    else card.failures.push({ caseId, stage, expected, got });
  };

  const gate = (tool: 'case.proceed' | 'case.close', c: z.infer<typeof EvalCaseSchema>, amount: number | null) => {
    const category = lc.categories.find((x) => x.id === c.expect.category);
    const risk = c.expect.priority === 'P1' ? 'high' : (category?.risk ?? 'medium');
    const decision = engine.decide({
      tool: resolveTool(pack, tool)!,
      args: { caseId: c.id, category: c.expect.category, priority: c.expect.priority, risk, summary: c.request, ...(amount !== null && { amount }) },
      agent: {
        id: 'eval-coordinator',
        role: coordinator.role,
        status: 'active',
        autonomy: coordinator.autonomy as 1 | 2 | 3 | 4,
        tools: coordinator.tools,
        dataClass: coordinator.model.data_class,
        moneyBudgetInr: coordinator.budgets.money_per_task_inr,
      },
      workspace: { id: 'eval', status: 'active' },
      tenant: { id: 'eval', status: 'active' },
      trackRecord: { approved: 0, rejected: 0, edited: 0 },
      caseContext: { category: c.expect.category, priority: c.expect.priority, risk, source: c.source },
    });
    return decision.level === 4 ? `required by ${decision.approver}` : decision.level === 5 ? 'blocked' : 'not required';
  };

  for (const c of suite.cases) {
    const request = offlineRequest({ text: c.request, requester: { name: 'Eval' }, source: c.source, receivedAt: now.toISOString() });
    const amount = c.amount_inr ?? extractAmountInr(c.request);
    const review = offlineReview(lc, request, amount);
    const classify = offlineClassify(lc, request, now, amount);
    score(c.id, 'review', c.expect.review, review.outcome);
    score(c.id, 'category', c.expect.category, classify.category);
    score(c.id, 'priority', c.expect.priority, classify.priority);

    // Gates are scored given the expected category and priority, so a
    // classification miss does not hide (or excuse) a rule mistake.
    if (c.expect.review === 'complete') {
      const fmt = (g?: { required: boolean; role?: string }) => (!g ? undefined : g.required ? `required by ${g.role ?? 'owner'}` : 'not required');
      const approval = fmt(c.expect.approval);
      if (approval) score(c.id, 'approval', approval, gate('case.proceed', c, amount));
      const signoff = fmt(c.expect.signoff);
      if (signoff) score(c.id, 'signoff', signoff, gate('case.close', c, amount));
    }
  }
  return card;
}

export function formatScorecard(card: Scorecard): string {
  const pct = (s: { correct: number; total: number }) => (s.total ? `${Math.round((100 * s.correct) / s.total)}% (${s.correct}/${s.total})` : 'n/a');
  const lines = [`${card.pack}: ${card.total} cases`, ...Object.entries(card.stages).map(([k, v]) => `  ${k.padEnd(9)} ${pct(v)}`)];
  for (const f of card.failures) lines.push(`  ✗ ${f.caseId} ${f.stage}: expected ${f.expected}, got ${f.got}`);
  return lines.join('\n');
}
