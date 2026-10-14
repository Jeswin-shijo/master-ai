/**
 * Google Gemini as a second model provider: the request and response mapping,
 * shared by the backend's LLM gateway and `pnpm evals:live` (like the prices).
 * Plain objects, so agent-kit needs no Google SDK; callers hand these to
 * `@google/genai`. Claude stays the default (ADR 0011).
 */
import type { ModelTier } from '@onehuman/schemas';
import type { Usage } from './pricing';
import type { LlmToolDefinition } from './tools';

/** Default model per tier. The -latest aliases follow Google's current Pro, Flash and Flash-Lite. */
export const GEMINI_DEFAULT_MODELS: Record<ModelTier, string> = {
  frontier: 'gemini-pro-latest',
  standard: 'gemini-flash-latest',
  small: 'gemini-flash-lite-latest',
};

/**
 * Options for `new GoogleGenAI(…)`. The SDK retries only when given retryOptions, so ask for a
 * few short retries on 408, 429 and 5xx (its defaults); Temporal's activity retries come after.
 */
export function geminiClientOptions(apiKey: string) {
  return { apiKey, httpOptions: { retryOptions: { attempts: 3, initialDelay: 2, maxDelay: 20 } } };
}

export interface GeminiRequest {
  system: string;
  user: string;
  tools?: LlmToolDefinition[];
  jsonSchema?: Record<string, unknown>;
  maxTokens: number;
}

/** What `models.generateContent` and `models.generateContentStream` take: one turn, like every gateway call. */
export function geminiParams(model: string, req: GeminiRequest) {
  return {
    model,
    contents: req.user,
    config: {
      systemInstruction: req.system,
      maxOutputTokens: req.maxTokens,
      ...(req.jsonSchema && { responseMimeType: 'application/json', responseJsonSchema: req.jsonSchema }),
      ...(req.tools?.length && {
        tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema })) }],
      }),
    },
  };
}

/** The parts of a Gemini response the gateway reads. The SDK's `GenerateContentResponse` fits this shape. */
export interface GeminiResponseLike {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean; functionCall?: { name?: string; args?: Record<string, unknown> } }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
}

/** Streamed chunks as one response: every part in order, and the last finish reason, usage and model seen. */
export function mergeGeminiChunks(chunks: GeminiResponseLike[]): GeminiResponseLike {
  const lastWith = <T>(pick: (c: GeminiResponseLike) => T | undefined): T | undefined => {
    for (let i = chunks.length - 1; i >= 0; i--) {
      const v = pick(chunks[i]!);
      if (v !== undefined) return v;
    }
    return undefined;
  };
  const finishReason = lastWith((c) => c.candidates?.[0]?.finishReason);
  return {
    candidates: [{ content: { parts: chunks.flatMap((c) => c.candidates?.[0]?.content?.parts ?? []) }, ...(finishReason && { finishReason }) }],
    promptFeedback: chunks.find((c) => c.promptFeedback?.blockReason)?.promptFeedback,
    usageMetadata: lastWith((c) => c.usageMetadata),
    modelVersion: lastWith((c) => c.modelVersion),
  };
}

export interface GeminiReading {
  text: string;
  toolCalls: { name: string; input: Record<string, unknown> }[];
  json: unknown;
  /** In the gateway's words: end_turn, tool_use, max_tokens, malformed_tool_call or refusal. */
  stopReason: string;
  usage: Usage;
  /** The model that answered, or the one asked for. */
  model: string;
  /** Why Gemini blocked the prompt or the answer (lower case), or null. */
  refused: string | null;
}

const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION']);

export function readGemini(res: GeminiResponseLike, asked: { model: string; jsonSchema?: boolean }): GeminiReading {
  const candidate = res.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const finish = candidate?.finishReason;
  const blocked = res.promptFeedback?.blockReason ?? (finish && BLOCKED.has(finish) ? finish : undefined);
  const cut = finish === 'MAX_TOKENS';
  const malformed = finish === 'MALFORMED_FUNCTION_CALL';

  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join('');
  const calls = parts.flatMap((p) => (p.functionCall?.name ? [{ name: p.functionCall.name, input: p.functionCall.args ?? {} }] : []));
  const toolCalls = blocked || cut || malformed ? [] : calls.slice(0, 1);

  let json: unknown = null;
  if (asked.jsonSchema && text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  const u = res.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  const usage: Usage = {
    inputTokens: Math.max(0, (u.promptTokenCount ?? 0) - cached),
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
  const stopReason = blocked ? 'refusal' : cut ? 'max_tokens' : malformed ? 'malformed_tool_call' : toolCalls.length ? 'tool_use' : 'end_turn';
  return { text, toolCalls, json, stopReason, usage, model: res.modelVersion ?? asked.model, refused: blocked ? blocked.toLowerCase() : null };
}
