import {
  lifecycleOf,
  mergeClassify,
  mergeReview,
  MODEL_STAGE_SCHEMAS,
  MODEL_STAGE_TIERS,
  modelStageJsonSchema,
  offlineClassify,
  offlineRequest,
  offlineReview,
  stageSystemPrompt,
  stageUserPrompt,
  withPreset,
  type ModelStage,
  type ModelStageOutput,
} from '@onehuman/agent-kit';
import type { ModelTier, RequestPart, ResolvedPack } from '@onehuman/schemas';
import { formatScorecard, runSuite, THRESHOLDS, type EvalSuite, type Scorecard } from './runner.ts';

export interface LiveRequest {
  stage: ModelStage;
  tier: ModelTier;
  system: string;
  user: string;
  schema: Record<string, unknown>;
}

export type LiveComplete = (req: LiveRequest) => Promise<{ json: unknown; costUsd: number }>;

/** A model error no retry fixes (a refused key, an unknown model): the run stops at once. */
export class LiveFatalError extends Error {}

export interface LiveScorecard extends Scorecard {
  costUsd: number;
  /** Answers that matched the stage schema. */
  modelAnswers: number;
  /** Answers that did not, where the rules answered instead. */
  fallbacks: number;
  /** Calls that failed (overloaded, timed out), where the rules answered instead. */
  errors: number;
}

type Stage = keyof typeof THRESHOLDS;
const empty = () => ({ correct: 0, total: 0 });

/**
 * The suite scored with the model for review and classification, merged under
 * the same safety rules as the backend. Gates are rules, so their scores come
 * from the offline run.
 */
export async function runLiveSuite(pack: ResolvedPack, suite: EvalSuite, complete: LiveComplete, now = new Date('2026-01-01T09:00:00Z')): Promise<LiveScorecard> {
  const lc = lifecycleOf(pack);
  const offline = runSuite(pack, suite, now);
  const card: LiveScorecard = {
    pack: pack.id,
    total: suite.cases.length,
    stages: { ...offline.stages, category: empty(), priority: empty(), review: empty() },
    failures: offline.failures.filter((f) => f.stage === 'approval' || f.stage === 'signoff'),
    costUsd: 0,
    modelAnswers: 0,
    fallbacks: 0,
    errors: 0,
  };
  const score = (caseId: string, stage: Stage, expected: string, got: string) => {
    card.stages[stage].total++;
    if (expected === got) card.stages[stage].correct++;
    else card.failures.push({ caseId, stage, expected, got });
  };
  const system = (stage: ModelStage) => stageSystemPrompt(stage, { orgName: `A ${pack.name.toLowerCase()} organization`, packName: pack.name, lc });
  const ask = async <S extends ModelStage>(stage: S, user: string): Promise<ModelStageOutput<S> | null> => {
    let answer: Awaited<ReturnType<LiveComplete>>;
    try {
      answer = await complete({ stage, tier: MODEL_STAGE_TIERS[stage], system: system(stage), user, schema: modelStageJsonSchema(stage) });
    } catch (err) {
      if (err instanceof LiveFatalError) throw err;
      card.errors++;
      card.fallbacks++;
      return null;
    }
    card.costUsd += answer.costUsd;
    const parsed = MODEL_STAGE_SCHEMAS[stage].safeParse(answer.json);
    if (parsed.success) {
      card.modelAnswers++;
      return parsed.data as ModelStageOutput<S>;
    }
    card.fallbacks++;
    return null;
  };

  for (const c of suite.cases) {
    const request: RequestPart = {
      ...offlineRequest({ text: c.request, requester: { name: 'Eval' }, source: c.source, receivedAt: now.toISOString() }),
      ...(c.amount_inr !== undefined && { amountInr: c.amount_inr }),
    };
    const iso = now.toISOString();
    const review = mergeReview(lc, request, await ask('review', stageUserPrompt('review', { file: { request }, now: iso })), offlineReview(withPreset(lc, request), request, request.amountInr));
    const classify = mergeClassify(
      lc,
      request,
      now,
      await ask('classify', stageUserPrompt('classify', { file: { request, review }, now: iso })),
      offlineClassify(withPreset(lc, request), request, now, request.amountInr),
    );
    score(c.id, 'review', c.expect.review, review.outcome);
    score(c.id, 'category', c.expect.category, classify.category);
    score(c.id, 'priority', c.expect.priority, classify.priority);
  }
  return card;
}

export function formatLiveScorecard(card: LiveScorecard): string {
  const failed = card.errors > 0 ? ` (${card.errors} calls failed)` : '';
  return `${formatScorecard(card)}\n  model answers ${card.modelAnswers}, fell back to rules ${card.fallbacks}${failed}, cost $${card.costUsd.toFixed(4)}`;
}

/** Spaces calls out to stay under a rate limit (a free Gemini key allows only a few requests a minute). 0 means no limit. */
export function paced(
  complete: LiveComplete,
  rpm: number,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => number = Date.now,
): LiveComplete {
  if (rpm <= 0) return complete;
  const gap = 60_000 / rpm;
  let next = -Infinity;
  return async (req) => {
    const wait = next - now();
    if (wait > 0) await sleep(wait);
    next = now() + gap;
    return complete(req);
  };
}
