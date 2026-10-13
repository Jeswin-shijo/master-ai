import { describe, expect, it } from 'vitest';
import { normalizeText, resolvePack } from '@onehuman/agent-kit';
import { formatScorecard, loadPackRegistry, loadSuites, runSuite, THRESHOLDS } from './runner';

const registry = loadPackRegistry(new URL('../../packs', import.meta.url).pathname);
const suites = loadSuites(new URL('../suites', import.meta.url).pathname);

describe('pack eval suites', () => {
  it('has at least one suite', () => expect(suites.length).toBeGreaterThan(0));

  it('every ready-made pack has a test set', () => {
    const withSuite = new Set(suites.map((s) => s.pack));
    const missing = [...registry.values()].filter((p) => p.kind === 'industry' && p.sector && !withSuite.has(p.id)).map((p) => p.id);
    expect(missing).toEqual([]);
  });

  it.each(suites.map((s) => [s.pack, s] as const))('%s keeps its examples out of the test set', (packId, suite) => {
    const resolved = resolvePack(registry.get(packId)!, (id) => registry.get(id));
    const examples = new Set((resolved.lifecycle?.examples ?? []).map((e) => normalizeText(e.request)));
    expect(suite.cases.filter((c) => examples.has(normalizeText(c.request))).map((c) => c.id)).toEqual([]);
  });

  it.each(suites.map((s) => [s.pack, s] as const))('%s meets the thresholds', (packId, suite) => {
    const pack = registry.get(packId);
    expect(pack, `suite refers to unknown pack ${packId}`).toBeDefined();
    const card = runSuite(resolvePack(pack!, (id) => registry.get(id)), suite);
    console.log(formatScorecard(card));
    for (const [stage, min] of Object.entries(THRESHOLDS)) {
      const s = card.stages[stage as keyof typeof THRESHOLDS];
      if (s.total === 0) continue;
      expect(s.correct / s.total, `${packId} ${stage}\n${formatScorecard(card)}`).toBeGreaterThanOrEqual(min);
    }
  });
});
