import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { Pack } from '@onehuman/schemas';
import { checkPackQuality, checkSectorPack, normalizeText, parsePack, resolvePack, validatePackRefs } from '@onehuman/agent-kit';
import { EvalSuiteSchema, runSuite, THRESHOLDS, type Scorecard } from './runner.ts';

export interface DraftCheck {
  packId: string | null;
  issues: string[];
  scorecard: Scorecard | null;
  ok: boolean;
}

/**
 * The registry for checking a draft. Packs that fail to parse are skipped
 * (another author may be mid-edit); `pnpm evals` stays strict.
 */
function loadRegistryLenient(dir: string, skipId: string): Map<string, Pack> {
  const registry = new Map<string, Pack>();
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry, 'pack.yaml');
    if (!existsSync(file)) continue;
    try {
      const pack = parsePack(parse(readFileSync(file, 'utf8')));
      if (pack.id !== skipId) registry.set(pack.id, pack);
    } catch {
      // skipped on purpose
    }
  }
  return registry;
}

const message = (err: unknown) => (err as Error).message.replace(/\s+/g, ' ').trim();

/** Check a draft pack (and optionally its test set) against the packs on disk. */
export function checkDraft(input: { packYaml: string; suiteYaml?: string; packsDir: string }): DraftCheck {
  const fail = (packId: string | null, issues: string[]): DraftCheck => ({ packId, issues, scorecard: null, ok: false });

  let pack: Pack;
  try {
    pack = parsePack(parse(input.packYaml));
  } catch (err) {
    return fail(null, [`pack: ${message(err)}`]);
  }
  const registry = loadRegistryLenient(input.packsDir, pack.id);
  registry.set(pack.id, pack);

  let resolved;
  try {
    resolved = resolvePack(pack, (id) => registry.get(id));
  } catch (err) {
    return fail(pack.id, [`resolve: ${message(err)}`]);
  }

  const issues = [...validatePackRefs(resolved)];
  if (pack.kind === 'base' && pack.sector) issues.push(...checkSectorPack(pack));
  if (pack.kind === 'industry' && pack.sector) issues.push(...checkPackQuality(resolved));

  let scorecard: Scorecard | null = null;
  if (input.suiteYaml !== undefined) {
    try {
      const suite = EvalSuiteSchema.parse(parse(input.suiteYaml));
      if (suite.pack !== pack.id) issues.push(`suite: written for ${suite.pack}, not ${pack.id}`);
      const examples = new Set((resolved.lifecycle?.examples ?? []).map((e) => normalizeText(e.request)));
      for (const c of suite.cases) {
        if (examples.has(normalizeText(c.request))) issues.push(`test case ${c.id}: its request is also a worked example in the pack`);
      }
      scorecard = runSuite(resolved, suite);
      for (const [stage, min] of Object.entries(THRESHOLDS)) {
        const s = scorecard.stages[stage as keyof typeof THRESHOLDS];
        if (s.total > 0 && s.correct / s.total < min) issues.push(`${stage} ${Math.round((100 * s.correct) / s.total)}% is below ${min * 100}%`);
      }
    } catch (err) {
      issues.push(`suite: ${message(err)}`);
    }
  }
  return { packId: pack.id, issues, scorecard, ok: issues.length === 0 };
}
