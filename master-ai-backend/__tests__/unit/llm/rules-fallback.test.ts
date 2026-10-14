import { describe, expect, it } from 'vitest';
import { RulesFallback, rulesPauseMs } from '../../../src/llm/rules-fallback';

const geminiDaily = Object.assign(
  new Error('{"error":{"code":429,"details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"},{"retryDelay":"62557s"}]}}'),
  { name: 'ApiError', status: 429 },
);
const geminiMinute = Object.assign(new Error('{"error":{"code":429,"details":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"},{"retryDelay":"6s"}]}}'), {
  name: 'ApiError',
  status: 429,
});
const retryable = (err: unknown) => (err as { status?: number }).status === 429 || err instanceof TypeError;

describe('how long the built-in rules answer after the AI provider fails', () => {
  it('waits out a daily quota, at most six hours at a time', () => {
    expect(rulesPauseMs(geminiDaily)).toBe(6 * 3_600_000);
  });

  it('tries the provider again after a minute for anything else', () => {
    expect(rulesPauseMs(geminiMinute)).toBe(60_000);
    expect(rulesPauseMs(new TypeError('fetch failed'))).toBe(60_000);
  });
});

describe('falling back to the built-in rules (LLM_RULES_WHEN_UNAVAILABLE)', () => {
  it('passes the error on when the setting is off', async () => {
    const fallback = new RulesFallback(false);
    await expect(fallback.run(() => Promise.reject(geminiDaily), async () => 'rules', retryable)).rejects.toBe(geminiDaily);
  });

  it('answers with the rules when the provider is out of quota, and keeps doing so without calling it', async () => {
    let now = 0;
    let calls = 0;
    const fallback = new RulesFallback(true, () => now);
    const provider = async () => {
      calls++;
      throw geminiDaily;
    };
    expect(await fallback.run(provider, async () => 'rules', retryable)).toEqual({ value: 'rules', fellBack: true });
    now += 60_000;
    expect(await fallback.run(provider, async () => 'rules', retryable)).toEqual({ value: 'rules', fellBack: true });
    expect(calls).toBe(1);
  });

  it('tries the provider again once the pause is over', async () => {
    let now = 0;
    const fallback = new RulesFallback(true, () => now);
    await fallback.run(() => Promise.reject(geminiMinute), async () => 'rules', retryable);
    now += 61_000;
    expect(await fallback.run(async () => 'model', async () => 'rules', retryable)).toEqual({ value: 'model', fellBack: false });
  });

  it('still passes on errors the rules should not hide, like a bad request', async () => {
    const bad = Object.assign(new Error('400 bad schema'), { status: 400 });
    const fallback = new RulesFallback(true);
    await expect(fallback.run(() => Promise.reject(bad), async () => 'rules', retryable)).rejects.toBe(bad);
  });
});
