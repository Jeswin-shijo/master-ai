import { describe, expect, it } from 'vitest';
import { rateLimiter } from '../../../src/llm/rate-limit';

describe('the model call rate limit (LLM_MAX_RPM)', () => {
  const clock = () => {
    let now = 0;
    const waits: number[] = [];
    return { now: () => now, waits, sleep: async (ms: number) => void waits.push(ms), advance: (ms: number) => (now += ms) };
  };

  it('gives calls made at the same moment their own slots, a minute divided by the limit apart', async () => {
    const c = clock();
    const wait = rateLimiter(30, c.sleep, c.now);
    await Promise.all([wait(), wait(), wait()]);
    expect(c.waits).toEqual([2000, 4000]);
  });

  it('lets a call through at once when its slot has already passed', async () => {
    const c = clock();
    const wait = rateLimiter(30, c.sleep, c.now);
    await wait();
    c.advance(5000);
    await wait();
    expect(c.waits).toEqual([]);
  });

  it('does nothing when no limit is set', async () => {
    const c = clock();
    const wait = rateLimiter(0, c.sleep, c.now);
    await Promise.all([wait(), wait(), wait()]);
    expect(c.waits).toEqual([]);
  });
});
