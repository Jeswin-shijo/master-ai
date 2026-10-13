import { describe, expect, it } from 'vitest';
import { resolvePack } from '@onehuman/agent-kit';
import { runLiveSuite, type LiveComplete } from './live-lib.ts';
import { loadPackRegistry, loadSuites, runSuite } from './runner.ts';

const registry = loadPackRegistry(new URL('../../packs', import.meta.url).pathname);
const suite = loadSuites(new URL('../suites', import.meta.url).pathname).find((s) => s.pack === 'power-plant')!;
const pack = resolvePack(registry.get('power-plant')!, (id) => registry.get(id));

describe('live evals', () => {
  it('asks the model for review and classification, and counts the cost', async () => {
    // A perfect model: answers with what each case expects.
    const perfect: LiveComplete = async (req) => {
      const c = suite.cases.find((x) => req.user.includes(x.request))!;
      const json =
        req.stage === 'review'
          ? { outcome: c.expect.review, category: c.expect.category, checks: [], missing: c.expect.review === 'needs_info' ? [{ key: 'detail', label: 'A missing detail' }] : [], reason: c.expect.review === 'complete' ? '' : 'Rule' }
          : { category: c.expect.category, priority: c.expect.priority, risk: c.expect.priority === 'P1' ? 'high' : 'medium', amount_inr: c.amount_inr ?? null, reasons: ['Fits.'] };
      return { json, costUsd: 0.001 };
    };
    const card = await runLiveSuite(pack, suite, perfect);
    expect(card.stages.category.correct).toBe(card.stages.category.total);
    expect(card.stages.review.correct).toBe(card.stages.review.total);
    expect(card.modelAnswers).toBe(suite.cases.length * 2);
    expect(card.costUsd).toBeCloseTo(suite.cases.length * 2 * 0.001, 6);
  });

  it('falls back to the rules when the model answers nonsense', async () => {
    const nonsense: LiveComplete = async () => ({ json: { nope: true }, costUsd: 0 });
    const card = await runLiveSuite(pack, suite, nonsense);
    const offline = runSuite(pack, suite);
    expect(card.fallbacks).toBe(suite.cases.length * 2);
    expect(card.stages.category).toEqual(offline.stages.category);
    expect(card.stages.approval).toEqual(offline.stages.approval);
  });
});
