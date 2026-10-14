import { describe, expect, it } from 'vitest';
import { costUsd, GEMINI_DEFAULT_MODELS, geminiParams, mergeGeminiChunks, readGemini, type GeminiResponseLike } from './index';

const TOOL = { name: 'records__update', description: 'Update a record', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } };
const USAGE = { promptTokenCount: 1200, cachedContentTokenCount: 200, candidatesTokenCount: 80, thoughtsTokenCount: 40 };
const answer = (parts: object[], finishReason = 'STOP', extra: object = {}): GeminiResponseLike => ({
  candidates: [{ content: { parts }, finishReason }],
  usageMetadata: USAGE,
  modelVersion: 'gemini-2.5-flash',
  ...extra,
});

describe('geminiParams', () => {
  it('sends the instructions, the one user turn and the token limit', () => {
    expect(geminiParams('gemini-flash-latest', { system: 'You review requests.', user: 'Pump B tripped.', maxTokens: 4000 })).toEqual({
      model: 'gemini-flash-latest',
      contents: 'Pump B tripped.',
      config: { systemInstruction: 'You review requests.', maxOutputTokens: 4000 },
    });
  });

  it('asks for JSON matching the schema', () => {
    const p = geminiParams('m', { system: 's', user: 'u', maxTokens: 10, jsonSchema: { type: 'object' } });
    expect(p.config).toMatchObject({ responseMimeType: 'application/json', responseJsonSchema: { type: 'object' } });
  });

  it('offers tools as function declarations with their JSON schemas', () => {
    const p = geminiParams('m', { system: 's', user: 'u', maxTokens: 10, tools: [TOOL] });
    expect(p.config.tools).toEqual([{ functionDeclarations: [{ name: 'records__update', description: 'Update a record', parametersJsonSchema: TOOL.input_schema }] }]);
  });

  it('has a model for every tier', () => {
    expect(Object.keys(GEMINI_DEFAULT_MODELS).sort()).toEqual(['frontier', 'small', 'standard']);
  });
});

describe('readGemini', () => {
  it("reads the text without the model's thinking, and counts tokens the way they are billed", () => {
    const r = readGemini(answer([{ text: 'Weighing it up…', thought: true }, { text: 'Done.' }]), { model: 'gemini-flash-latest' });
    expect(r).toMatchObject({ text: 'Done.', toolCalls: [], json: null, stopReason: 'end_turn', model: 'gemini-2.5-flash', refused: null });
    expect(r.usage).toEqual({ inputTokens: 1000, cacheReadTokens: 200, outputTokens: 120, cacheWriteTokens: 0 });
  });

  it('parses JSON when a schema was asked for, and gives null for broken JSON', () => {
    expect(readGemini(answer([{ text: '{"category":"breakdown"}' }]), { model: 'm', jsonSchema: true }).json).toEqual({ category: 'breakdown' });
    expect(readGemini(answer([{ text: '{"category":' }]), { model: 'm', jsonSchema: true }).json).toBeNull();
    expect(readGemini(answer([{ text: '{"category":"breakdown"}' }]), { model: 'm' }).json).toBeNull();
  });

  it('takes only the first tool call, one step at a time like the Claude path', () => {
    const r = readGemini(answer([{ text: 'Marking it done.' }, { functionCall: { name: 'records__update', args: { id: 'a' } } }, { functionCall: { name: 'task__finish', args: {} } }]), { model: 'm' });
    expect(r.toolCalls).toEqual([{ name: 'records__update', input: { id: 'a' } }]);
    expect(r.stopReason).toBe('tool_use');
  });

  it('never runs a tool call cut off at the token limit, or a malformed one', () => {
    const call = { functionCall: { name: 'records__update', args: { id: 'a' } } };
    expect(readGemini(answer([call], 'MAX_TOKENS'), { model: 'm' })).toMatchObject({ toolCalls: [], stopReason: 'max_tokens' });
    expect(readGemini(answer([call], 'MALFORMED_FUNCTION_CALL'), { model: 'm' })).toMatchObject({ toolCalls: [], stopReason: 'malformed_tool_call' });
  });

  it('treats a blocked prompt or a blocked answer as a refusal', () => {
    expect(readGemini({ promptFeedback: { blockReason: 'SAFETY' } }, { model: 'm' })).toMatchObject({ refused: 'safety', stopReason: 'refusal', toolCalls: [] });
    expect(readGemini(answer([{ text: 'partial' }], 'PROHIBITED_CONTENT'), { model: 'm' }).refused).toBe('prohibited_content');
  });

  it('names the model asked for when the response does not say which one answered', () => {
    expect(readGemini({ candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }, { model: 'gemini-flash-latest' }).model).toBe('gemini-flash-latest');
  });
});

describe('mergeGeminiChunks', () => {
  it('joins streamed parts in order and keeps the last finish reason, usage and model', () => {
    const merged = mergeGeminiChunks([
      { candidates: [{ content: { parts: [{ text: 'Hel' }] } }] },
      { candidates: [{ content: { parts: [{ text: 'lo.' }] } }] },
      { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }], usageMetadata: USAGE, modelVersion: 'gemini-2.5-flash' },
    ]);
    expect(readGemini(merged, { model: 'm' })).toMatchObject({ text: 'Hello.', stopReason: 'end_turn', model: 'gemini-2.5-flash' });
    expect(readGemini(merged, { model: 'm' }).usage.outputTokens).toBe(120);
  });
});

describe('Gemini prices', () => {
  const million = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  it('prices Gemini by family, Flash-Lite before Flash', () => {
    expect(costUsd('gemini-flash-lite-latest', million)).toBeCloseTo(0.1);
    expect(costUsd('gemini-flash-latest', million)).toBeCloseTo(0.3);
    expect(costUsd('gemini-3-pro-preview', million)).toBeCloseTo(2);
  });
});
