import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from './proxy';
import { publicBuckets } from '../cases/intake.service';

describe('client address behind a proxy', () => {
  it('trusts no proxy unless told, so the address cannot be spoofed', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('takes a hop count, true, or a list of trusted addresses', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });
});

describe('public rate limits', () => {
  it('give each company its own window, so one noisy caller cannot block every company', () => {
    const a = publicBuckets('form', '11111111-1111-4111-8111-111111111111', '203.0.113.9');
    const b = publicBuckets('form', '22222222-2222-4222-8222-222222222222', '203.0.113.9');
    expect(a.ip).not.toBe(b.ip);
  });
});
