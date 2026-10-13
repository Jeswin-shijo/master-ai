import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { costUsd, resolvePack } from '@onehuman/agent-kit';
import type { ModelTier } from '@onehuman/schemas';
import { formatLiveScorecard, runLiveSuite, type LiveComplete } from './live-lib.ts';
import { loadPackRegistry, loadSuites } from './runner.ts';

/**
 * pnpm evals:live [--pack <id>]
 * Scores the test sets with the model answering review and classification.
 */
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.log('pnpm evals:live needs ANTHROPIC_API_KEY. Without a key, `pnpm evals` scores the rules alone.');
  process.exit(0);
}
const only = process.argv.includes('--pack') ? process.argv[process.argv.indexOf('--pack') + 1] : undefined;
const models: Record<ModelTier, string> = {
  frontier: process.env.LLM_MODEL_FRONTIER ?? 'claude-opus-5-5',
  standard: process.env.LLM_MODEL_STANDARD ?? 'claude-sonnet-5-5',
  small: process.env.LLM_MODEL_SMALL ?? 'claude-haiku-5-5',
};
const client = new Anthropic();

const complete: LiveComplete = async (req) => {
  const model = models[req.tier];
  const message = await client.beta.messages.create({
    model,
    max_tokens: 4000,
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: req.user }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: req.schema } },
  });
  const text = message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  const usage = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
  };
  return { json, costUsd: costUsd(message.model ?? model, usage) };
};

const registry = loadPackRegistry(fileURLToPath(new URL('../../packs/', import.meta.url)));
let total = 0;
for (const suite of loadSuites(fileURLToPath(new URL('../suites/', import.meta.url)))) {
  if (only && suite.pack !== only) continue;
  const base = registry.get(suite.pack);
  if (!base) continue;
  const card = await runLiveSuite(resolvePack(base, (id) => registry.get(id)), suite, complete);
  total += card.costUsd;
  console.log(formatLiveScorecard(card));
}
console.log(`\nTotal cost: $${total.toFixed(4)}`);
