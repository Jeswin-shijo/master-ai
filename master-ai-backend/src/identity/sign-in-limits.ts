import { HttpException, HttpStatus } from '@nestjs/common';
import { RateLimiter } from '../common/rate-limit';

const MINUTE = 60_000;

/**
 * Limits on signing in and signing up, so passwords can't be guessed and
 * organizations can't be created in bulk. Wrong passwords count against the
 * email (10 per 15 minutes, from anywhere); every try counts against the
 * address (20 a minute, enough for an office behind one connection).
 */
export class SignInLimits {
  constructor(private readonly limiter = new RateLimiter()) {}

  beforeLogin(ip: string, email: string) {
    if (this.limiter.exhausted(failures(email), 10)) throw tooMany('Too many wrong passwords for this email. Try again in 15 minutes.');
    if (!this.limiter.take(`login:${ip}`, 20, MINUTE)) throw tooMany('Too many sign-in attempts. Try again in a minute.');
  }

  loginFailed(email: string) {
    this.limiter.take(failures(email), Number.POSITIVE_INFINITY, 15 * MINUTE);
  }

  beforeSignup(ip: string) {
    if (!this.limiter.take(`signup:${ip}`, 10, MINUTE)) throw tooMany('Too many new organizations from this connection. Try again in a minute.');
  }
}

const failures = (email: string) => `login-failed:${email.trim().toLowerCase()}`;
const tooMany = (message: string) => new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
