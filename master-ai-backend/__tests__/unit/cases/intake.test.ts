import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../../../src/common/rate-limit';
import { bearerKey, hashIntakeKey, newIntakeKey } from '../../../src/cases/intake.service';

describe('intake keys', () => {
  it('makes long random keys and keeps only their hash', () => {
    const a = newIntakeKey();
    const b = newIntakeKey();
    expect(a.key).toMatch(/^ohk_[A-Za-z0-9_-]{32}$/);
    expect(a.key).not.toBe(b.key);
    expect(a.hash).toBe(hashIntakeKey(a.key));
    expect(a.hash).not.toContain(a.key);
    expect(a.hint).toBe(a.key.slice(0, 8));
  });

  it('reads a bearer key and nothing else', () => {
    expect(bearerKey('Bearer ohk_abc')).toBe('ohk_abc');
    expect(bearerKey('bearer ohk_abc')).toBe('ohk_abc');
    expect(bearerKey('Basic xyz')).toBeNull();
    expect(bearerKey(undefined)).toBeNull();
  });
});

describe('rate limiter', () => {
  it('allows up to the limit in a window, then resets', () => {
    let now = 0;
    const limiter = new RateLimiter(() => now);
    expect([1, 2, 3].map(() => limiter.take('ip:1', 3, 60_000))).toEqual([true, true, true]);
    expect(limiter.take('ip:1', 3, 60_000)).toBe(false);
    expect(limiter.take('ip:2', 3, 60_000)).toBe(true);
    now = 60_001;
    expect(limiter.take('ip:1', 3, 60_000)).toBe(true);
  });
});
