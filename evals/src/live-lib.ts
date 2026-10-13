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

export interface LiveScorecard extends Scorecard {
  costUsd: number;
  /** Answers that matched the stage schema. */
  modelAnswers: number;
  /** Answers that did not, where the rules answered instead. */
  fallbacks: number;
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
  };
  const score = (caseId: string, stage: Stage, expected: string, got: string) => {
    card.stages[stage].total++;
    if (expected === got) card.stages[stage].correct++;
    else card.failures.push({ caseId, stage, expected, got });
  };
  const system = (stage: ModelStage) => stageSystemPrompt(stage, { orgName: `A ${pack.name.toLowerCase()} organization`, packName: pack.name, lc });
  const ask = async <S extends ModelStage>(stage: S, user: string): Promise<ModelStageOutput<S> | null> => {
    const answer = await complete({ stage, tier: MODEL_STAGE_TIERS[stage], system: system(stage), user, schema: modelStageJsonSchema(stage) });
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
  return `${formatScorecard(card)}\n  model answers ${card.modelAnswers}, fell back to rules ${card.fallbacks}, cost $${card.costUsd.toFixed(4)}`;
}
