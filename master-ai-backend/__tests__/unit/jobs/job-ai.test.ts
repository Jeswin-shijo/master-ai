import { describe, expect, it, vi } from 'vitest';
import { JobStepSchema, PackAgentSchema } from '@onehuman/schemas';
import { askJobAi } from '../../../src/jobs/job-ai';
import type { LlmRequest, LlmResult } from '../../../src/llm/llm.service';

const step = JobStepSchema.parse({
  ai: { as: 'draft', task: 'Write a short reply to the customer.', output: [{ name: 'reply', type: 'text', required: true }] },
}).ai!;
const agent = PackAgentSchema.parse({ role: 'front-desk', name: 'Front desk', description: 'Answers customers.', tools: ['message.draft'] });
const prompt = { system: 'ROLE.\nYou are the front desk.', user: 'TASK.\nWrite a short reply.' };
const req = { tenantId: 't1', goalId: 'g1', taskId: 'k1', agent, step, prompt };

const answer = (json: unknown): LlmResult => ({
  text: '',
  toolCalls: [],
  json,
  provider: 'anthropic',
  model: 'stub',
  stopReason: 'end_turn',
  usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costInr: 0.5,
  tokens: 100,
});

/** An online model that hands back the queued answers in turn (an Error is thrown). */
function stub(mode: 'online' | 'offline', ...queue: (LlmResult | Error)[]) {
  const complete = vi.fn(async (_r: LlmRequest): Promise<LlmResult> => {
    const next = queue.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  });
  return { llm: { mode, complete }, complete };
}

const valid = { reply: 'Thank you, we will call you back today.', needs_person: false, needs_person_reason: null };

describe('askJobAi: one structured model call for an AI step', () => {
  it('asks again once when the answer does not fit, and keeps the second answer', async () => {
    const { llm, complete } = stub('online', answer({ reply: 42 }), answer(valid));
    const got = await askJobAi(llm, req);
    expect(got.output).toEqual(valid);
    expect(complete).toHaveBeenCalledTimes(2);
    const second = complete.mock.calls[1]![0];
    expect(second.user).toContain('did not match the format');
    expect(second.user.startsWith(prompt.user)).toBe(true);
    expect(got.tokens).toBe(200);
    expect(got.costInr).toBe(1);
  });

  it('sends the step as a job step at the agent tier, with the output schema', async () => {
    const { llm, complete } = stub('online', answer(valid));
    await askJobAi(llm, { ...req, redactPii: false });
    const sent = complete.mock.calls[0]![0];
    expect(sent).toMatchObject({
      tenantId: 't1',
      goalId: 'g1',
      taskId: 'k1',
      purpose: 'job_step',
      tier: agent.model.tier,
      fallbackTier: agent.model.fallback,
      dataClass: agent.model.data_class,
      redactPii: false,
      system: prompt.system,
      user: prompt.user,
      effort: 'low',
      maxTokens: 4000,
    });
    expect(sent.jsonSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['reply', 'needs_person']) });
    expect(await sent.offline()).toEqual({});
  });

  it('gives no answer after two answers that do not fit', async () => {
    const { llm, complete } = stub('online', answer({ reply: 42 }), answer({ wrong: true }));
    const got = await askJobAi(llm, req);
    expect(got.output).toBeNull();
    expect(complete).toHaveBeenCalledTimes(2);
    expect(got.tokens).toBe(200);
  });

  it('gives no answer when the call throws', async () => {
    const { llm, complete } = stub('online', new Error('provider down'));
    const got = await askJobAi(llm, req);
    expect(got).toEqual({ output: null, tokens: 0, costInr: 0 });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('makes no call in offline mode', async () => {
    const { llm, complete } = stub('offline', answer(valid));
    expect(await askJobAi(llm, req)).toEqual({ output: null, tokens: 0, costInr: 0 });
    expect(complete).not.toHaveBeenCalled();
  });
});
