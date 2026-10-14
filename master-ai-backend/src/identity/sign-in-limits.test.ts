import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../common/rate-limit';
import { SignInLimits } from './sign-in-limits';

function limits() {
  let t = 0;
  const clock = { advance: (ms: number) => (t += ms) };
  return { limits: new SignInLimits(new RateLimiter(() => t)), clock };
}

const tooMany = (f: () => void) => {
  try {
    f();
  } catch (err) {
    return err instanceof HttpException && err.getStatus() === 429;
  }
  return false;
};

describe('SignInLimits', () => {
  it('stops guessing one email’s password after 10 wrong tries, for 15 minutes', () => {
    const { limits: l, clock } = limits();
    for (let i = 0; i < 10; i++) {
      expect(tooMany(() => l.beforeLogin(`10.0.0.${i}`, 'asha@example.com'))).toBe(false);
      l.loginFailed('asha@example.com');
    }
    expect(tooMany(() => l.beforeLogin('10.0.1.1', 'asha@example.com'))).toBe(true);
    expect(tooMany(() => l.beforeLogin('10.0.1.1', 'ravi@example.com'))).toBe(false);
    clock.advance(15 * 60_000);
    expect(tooMany(() => l.beforeLogin('10.0.1.1', 'asha@example.com'))).toBe(false);
  });

  it('counts only wrong passwords against an email, so signing in often is fine', () => {
    const { limits: l } = limits();
    for (let i = 0; i < 15; i++) expect(tooMany(() => l.beforeLogin(`10.0.0.${i}`, 'asha@example.com'))).toBe(false);
  });

  it('allows 20 sign-in tries a minute from one address, enough for an office behind one connection', () => {
    const { limits: l, clock } = limits();
    for (let i = 0; i < 20; i++) expect(tooMany(() => l.beforeLogin('10.0.0.1', `person${i}@example.com`))).toBe(false);
    expect(tooMany(() => l.beforeLogin('10.0.0.1', 'one-more@example.com'))).toBe(true);
    clock.advance(60_000);
    expect(tooMany(() => l.beforeLogin('10.0.0.1', 'one-more@example.com'))).toBe(false);
  });

  it('allows 20 new organizations a minute from one address', () => {
    const { limits: l } = limits();
    for (let i = 0; i < 20; i++) expect(tooMany(() => l.beforeSignup('10.0.0.1'))).toBe(false);
    expect(tooMany(() => l.beforeSignup('10.0.0.1'))).toBe(true);
    expect(tooMany(() => l.beforeSignup('10.0.0.2'))).toBe(false);
  });

  it('treats an email the same whatever its case', () => {
    const { limits: l } = limits();
    for (let i = 0; i < 10; i++) l.loginFailed('Asha@Example.com');
    expect(tooMany(() => l.beforeLogin('10.0.0.1', 'asha@example.com'))).toBe(true);
  });
});
