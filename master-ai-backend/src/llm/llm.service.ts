import { Global, Injectable, Logger, Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
// @google/genai is an ES module to TypeScript's node16 resolution and this backend is CommonJS: its types come in
// with resolution-mode, and the module itself loads with import() the first time Gemini is used.
import type { GoogleGenAI } from '@google/genai' with { 'resolution-mode': 'import' };
import type { DataClass, ModelTier } from '@onehuman/schemas';
import { geminiClientOptions, geminiParams, mergeGeminiChunks, readGemini, type GeminiResponseLike, type LlmToolDefinition } from '@onehuman/agent-kit';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { llmCalls } from '../db/schema';
import { costUsd, supportsServerFallback, type Usage } from './pricing';
import { Redactor } from './redaction';
import { rateLimiter } from './rate-limit';

export type LlmPurpose = 'agent_step' | 'plan' | 'pack_generate' | 'quality' | 'summary' | 'call' | 'case_stage';

export interface LlmToolCall {
  name: string;
  input: Record<string, unknown>;
}

/** What a deterministic offline strategy returns for one call. */
export interface OfflineResult {
  text?: string;
  toolCalls?: LlmToolCall[];
  json?: unknown;
}

/**
 * One model call. Requests are single-turn by design: agents keep their state
 * in the database and every step rebuilds its context, so a crash, deploy or
 * multi-day approval wait never depends on in-memory conversation history.
 */
export interface LlmRequest {
  tenantId: string;
  goalId?: string | null;
  taskId?: string | null;
  purpose: LlmPurpose;
  tier: ModelTier;
  fallbackTier?: ModelTier;
  dataClass: DataClass;
  redactPii?: boolean;
  /** Stable instructions (cached). Keep per-request details out of it. */
  system: string;
  user: string;
  tools?: LlmToolDefinition[];
  /** Ask for JSON matching this schema (structured outputs). */
  jsonSchema?: Record<string, unknown>;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
  onText?: (delta: string) => void;
  /** Deterministic fallback used when no model is configured. */
  offline: () => OfflineResult | Promise<OfflineResult>;
}

export interface LlmResult {
  text: string;
  toolCalls: LlmToolCall[];
  json: unknown;
  provider: 'anthropic' | 'google' | 'offline';
  model: string;
  stopReason: string | null;
  usage: Usage;
  costInr: number;
  tokens: number;
}

export class LlmRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`The model declined this request${category ? ` (${category})` : ''}`);
  }
}

/**
 * LLM gateway: every model call in the platform goes through here. It routes
 * by tier, redacts PII, caches the stable prompt prefix, falls back on errors
 * and refusals, and meters tokens and cost per tenant, goal and task. Business
 * logic never names a model.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly anthropic = config.llmProvider === 'anthropic' ? new Anthropic() : null;
  private googleClient: Promise<GoogleGenAI> | null = null;
  private readonly nextSlot = rateLimiter(config.LLM_MAX_RPM);

  get mode(): 'online' | 'offline' {
    return config.llmOffline ? 'offline' : 'online';
  }

  /** Which provider answers: anthropic (the default), google, or offline. */
  get provider(): 'anthropic' | 'google' | 'offline' {
    return config.llmProvider;
  }

  async complete(req: LlmRequest): Promise<LlmResult> {
    const started = Date.now();
    const redactor = new Redactor();
    const shouldRedact = req.redactPii !== false && (req.dataClass === 'confidential' || req.dataClass === 'restricted');
    const user = shouldRedact ? redactor.redact(req.user) : req.user;

    let result: LlmResult;
    if (config.llmOffline) {
      result = await this.runOffline(req);
    } else {
      try {
        result = await this.call(req, config.models[req.tier], user);
      } catch (err) {
        if (err instanceof LlmRefusalError || !req.fallbackTier || !isRetryable(err)) throw err;
        this.logger.warn(`${config.models[req.tier]} failed (${(err as Error).message}); falling back to ${req.fallbackTier}`);
        result = await this.call(req, config.models[req.fallbackTier], user);
      }
      result = {
        ...result,
        text: redactor.restore(result.text),
        toolCalls: redactor.restore(result.toolCalls),
        json: redactor.restore(result.json),
      };
    }

    await this.meter(req, result, Date.now() - started, redactor.size);
    return result;
  }

  private async call(req: LlmRequest, model: string, user: string): Promise<LlmResult> {
    await this.nextSlot();
    if (config.llmProvider !== 'google') return this.callAnthropic(this.anthropic!, req, model, user);
    this.googleClient ??= import('@google/genai').then(({ GoogleGenAI }) => new GoogleGenAI(geminiClientOptions(config.GEMINI_API_KEY!)));
    return this.callGoogle(await this.googleClient, req, model, user);
  }

  /** Gemini, mapped so it behaves like the Claude path: one step at a time, thinking hidden, blocks as refusals. */
  private async callGoogle(ai: GoogleGenAI, req: LlmRequest, model: string, user: string): Promise<LlmResult> {
    const chunks: GeminiResponseLike[] = [];
    const stream = await ai.models.generateContentStream(
      geminiParams(model, { system: req.system, user, tools: req.tools, jsonSchema: req.jsonSchema, maxTokens: req.maxTokens ?? 16000 }),
    );
    for await (const chunk of stream) {
      chunks.push(chunk);
      if (req.onText) for (const part of chunk.candidates?.[0]?.content?.parts ?? []) if (part.text && !part.thought) req.onText(part.text);
    }
    const read = readGemini(mergeGeminiChunks(chunks), { model, jsonSchema: !!req.jsonSchema });
    if (read.refused) throw new LlmRefusalError(read.refused);
    return {
      text: read.text,
      toolCalls: read.toolCalls,
      json: read.json,
      provider: 'google',
      model: read.model,
      stopReason: read.stopReason,
      usage: read.usage,
      costInr: costUsd(read.model, read.usage) * config.USD_INR_RATE,
      tokens: read.usage.inputTokens + read.usage.outputTokens + read.usage.cacheReadTokens,
    };
  }

  private async callAnthropic(client: Anthropic, req: LlmRequest, model: string, user: string): Promise<LlmResult> {
    const fallback = supportsServerFallback(model);
    const stream = client.beta.messages.stream({
      model,
      max_tokens: req.maxTokens ?? 16000,
      // Tools render before system, so this one breakpoint caches tools + instructions.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
      ...(req.tools?.length && {
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
        })),
        tool_choice: { type: 'auto' as const, disable_parallel_tool_use: true },
      }),
      output_config: {
        effort: req.effort ?? 'medium',
        ...(req.jsonSchema && { format: { type: 'json_schema' as const, schema: req.jsonSchema } }),
      },
      ...(fallback && { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    });
    if (req.onText) stream.on('text', (delta) => req.onText!(delta));
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      throw new LlmRefusalError(message.stop_details?.category ?? null);
    }

    let text = '';
    const toolCalls: LlmToolCall[] = [];
    for (const block of message.content) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') toolCalls.push({ name: block.name, input: (block.input ?? {}) as Record<string, unknown> });
    }
    // A tool input cut off by max_tokens may parse as a valid partial object; never run it.
    if (message.stop_reason === 'max_tokens' && toolCalls.length) toolCalls.length = 0;

    let json: unknown = null;
    if (req.jsonSchema) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    const usage: Usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
    };
    const servedBy = message.model ?? model;
    return {
      text,
      toolCalls,
      json,
      provider: 'anthropic',
      model: servedBy,
      stopReason: message.stop_reason,
      usage,
      costInr: costUsd(servedBy, usage) * config.USD_INR_RATE,
      tokens: usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
    };
  }

  private async runOffline(req: LlmRequest): Promise<LlmResult> {
    const out = await req.offline();
    const text = out.text ?? '';
    if (req.onText && text) {
      for (const word of text.split(/(?<=\s)/)) req.onText(word);
    }
    return {
      text,
      toolCalls: out.toolCalls ?? [],
      json: out.json ?? null,
      provider: 'offline',
      model: 'offline-deterministic',
      stopReason: out.toolCalls?.length ? 'tool_use' : 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      costInr: 0,
      tokens: 0,
    };
  }

  private async meter(req: LlmRequest, result: LlmResult, latencyMs: number, redactions: number) {
    await this.db.tenant(req.tenantId, (tx) =>
      tx.insert(llmCalls).values({
        tenantId: req.tenantId,
        goalId: req.goalId ?? null,
        taskId: req.taskId ?? null,
        purpose: req.purpose,
        provider: result.provider,
        model: result.model,
        tier: req.tier,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cacheReadTokens: result.usage.cacheReadTokens,
        costInr: result.costInr,
        latencyMs,
        redactions,
      }),
    );
  }

  constructor(private readonly db: DbService) {}
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.APIConnectionError) return true;
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.InternalServerError) return true;
  if (err instanceof Anthropic.APIError) return (err.status ?? 0) >= 500;
  const gemini = geminiStatus(err);
  if (gemini !== null) return gemini === 429 || gemini >= 500;
  if (err instanceof TypeError) return true; // fetch failed: the network, not the request
  return false;
}

/** The HTTP status of a Gemini ApiError (recognised by name: its class lives in the lazily loaded ES module), or null. */
function geminiStatus(err: unknown): number | null {
  if (!(err instanceof Error) || err.name !== 'ApiError') return null;
  const status = (err as { status?: unknown }).status;
  return typeof status === 'number' ? status : null;
}

@Global()
@Module({ providers: [LlmService], exports: [LlmService] })
export class LlmModule {}
