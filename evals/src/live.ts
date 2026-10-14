import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { ApiError, GoogleGenAI } from '@google/genai';
import { costUsd, GEMINI_DEFAULT_MODELS, geminiClientOptions, geminiParams, readGemini, resolvePack } from '@onehuman/agent-kit';
import type { ModelTier } from '@onehuman/schemas';
import { formatLiveScorecard, LiveFatalError, paced, runLiveSuite, type LiveComplete } from './live-lib.ts';
import { loadPackRegistry, loadSuites } from './runner.ts';

/**
 * pnpm evals:live [--pack <id>] [--rpm <n>]
 * Scores the test sets with the model answering review and classification:
 * Claude when its key is set, else Gemini (ADR 0011). --rpm paces calls for a free key.
 */
const claudeKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
const geminiKey = process.env.GEMINI_API_KEY;
if (!claudeKey && !geminiKey) {
  console.log('pnpm evals:live needs ANTHROPIC_API_KEY or GEMINI_API_KEY (in your shell or master-ai-backend/.env). Without one, `pnpm evals` scores the rules alone.');
  process.exit(0);
}
const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const only = arg('--pack');
const rpm = Number(arg('--rpm') ?? 0);

const models: Record<ModelTier, string> = {
  frontier: process.env.LLM_MODEL_FRONTIER ?? 'claude-opus-5-5',
  standard: process.env.LLM_MODEL_STANDARD ?? 'claude-sonnet-5-5',
  small: process.env.LLM_MODEL_SMALL ?? 'claude-haiku-5-5',
};
const client = claudeKey ? new Anthropic() : null;

/** Key and model errors stop the run; anything else is one failed call. */
function fatal(err: unknown, model: string): unknown {
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new LiveFatalError(`The model refused the key (${err.message}). Check ANTHROPIC_API_KEY.`);
  }
  if (err instanceof Anthropic.NotFoundError) return new LiveFatalError(`No model called ${model} (${err.message}). Check LLM_MODEL_* in your environment.`);
  return err;
}

const claudeComplete: LiveComplete = async (req) => {
  const model = models[req.tier];
  const message = await client!.beta.messages
    .create({
      model,
      max_tokens: 4000,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: req.schema } },
    })
    .catch((err: unknown) => {
      throw fatal(err, model);
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

const geminiModels: Record<ModelTier, string> = {
  frontier: process.env.GEMINI_MODEL_FRONTIER ?? GEMINI_DEFAULT_MODELS.frontier,
  standard: process.env.GEMINI_MODEL_STANDARD ?? GEMINI_DEFAULT_MODELS.standard,
  small: process.env.GEMINI_MODEL_SMALL ?? GEMINI_DEFAULT_MODELS.small,
};

/** A refused Google key comes back as 400 "API key not valid", 401 or 403; an unknown model as 404. */
function geminiFatal(err: unknown, model: string): unknown {
  if (err instanceof ApiError && (err.status === 401 || err.status === 403 || (err.status === 400 && /api key/i.test(err.message)))) {
    return new LiveFatalError(`Google refused the key (${err.status} ${err.message.slice(0, 160)}). Check GEMINI_API_KEY.`);
  }
  if (err instanceof ApiError && err.status === 404) return new LiveFatalError(`No Gemini model called ${model}. Set GEMINI_MODEL_* to one your key can use.`);
  return err;
}

function geminiComplete(apiKey: string): LiveComplete {
  const ai = new GoogleGenAI(geminiClientOptions(apiKey));
  return async (req) => {
    const model = geminiModels[req.tier];
    const res = await ai.models.generateContent(geminiParams(model, { system: req.system, user: req.user, jsonSchema: req.schema, maxTokens: 4000 })).catch((err: unknown) => {
      throw geminiFatal(err, model);
    });
    const read = readGemini(res, { model, jsonSchema: true });
    return { json: read.json, costUsd: costUsd(read.model, read.usage) };
  };
}

const complete = paced(claudeKey ? claudeComplete : geminiComplete(geminiKey!), rpm);
console.log(`Scoring with ${claudeKey ? 'Claude' : 'Gemini'}${rpm ? `, at most ${rpm} calls a minute` : ''}.`);

const registry = loadPackRegistry(fileURLToPath(new URL('../../packs/', import.meta.url)));
let total = 0;
try {
  for (const suite of loadSuites(fileURLToPath(new URL('../suites/', import.meta.url)))) {
    if (only && suite.pack !== only) continue;
    const base = registry.get(suite.pack);
    if (!base) continue;
    const card = await runLiveSuite(resolvePack(base, (id) => registry.get(id)), suite, complete);
    total += card.costUsd;
    console.log(formatLiveScorecard(card));
  }
} catch (err) {
  if (!(err instanceof LiveFatalError)) throw err;
  console.error(err.message);
  process.exit(1);
}
console.log(`\nTotal cost: $${total.toFixed(4)}`);
