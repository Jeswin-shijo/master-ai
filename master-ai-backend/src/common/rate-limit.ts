/**
 * In-process fixed-window rate limiter for public routes. One API process
 * today; replace with Redis when there are several.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  /** True when this call is within `limit` calls per `windowMs` for `key`. */
  take(key: string, limit: number, windowMs: number): boolean {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      this.windows.set(key, { count: 1, resetAt: t + windowMs });
      if (this.windows.size > 10_000) this.sweep(t);
      return true;
    }
    if (w.count >= limit) return false;
    w.count++;
    return true;
  }

  private sweep(t: number) {
    for (const [key, w] of this.windows) if (w.resetAt <= t) this.windows.delete(key);
  }
}
